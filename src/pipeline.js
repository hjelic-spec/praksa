// Tijek obrade jednog upita:
//   upit -> razumijevanje (Claude) -> pretraživanje izvora (širi skup kandidata) ->
//   predselekcija po isječcima (Claude) -> dohvat i analiza odabranih odluka kao presedana (Claude)
//   + deterministička ekstrakcija referenci -> provjera citata i EU akata -> povezivanje predmeta ->
//   odgovor na upit (Claude).
import { config } from './config.js';
import * as llm from './llm.js';
import * as odluke from './sources/odluke.js';
import * as local from './sources/local.js';
import { caseKey, extractCaseNumbers, extractEuReferences, quoteInText } from './extract.js';
import { verifyAll } from './eu.js';
import { weigh, citationLine } from './authority.js';
import { createCostTracker } from './pricing.js';

const SOURCES = { odluke, local };

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

function uniqueByCaseKey(caseNos) {
  const seen = new Map();
  for (const c of caseNos) if (!seen.has(caseKey(c))) seen.set(caseKey(c), c);
  return [...seen.values()];
}

export function linkRelated(items) {
  // Poslovni brojevi uspoređuju se po ključu (caseKey) jer ista oznaka u tekstovima
  // dolazi u različitim zapisima ("Rev 12/2019-2", "Rev-12/19").
  const byKey = new Map(items.filter((d) => d.meta?.poslovniBroj).map((d) => [caseKey(d.meta.poslovniBroj), d]));
  const label = (d) => d.meta?.poslovniBroj ?? d.naslov;
  for (const d of items) {
    d.povezaniURezultatima = [];
    for (const c of d.citiraniPredmeti) {
      const other = byKey.get(caseKey(c));
      if (other && other !== d && !d.povezaniURezultatima.some((r) => r.url === other.url)) {
        d.povezaniURezultatima.push({ poslovniBroj: label(other), url: other.url, odnos: 'citira' });
      }
    }
  }
  for (const d of items) {
    for (const rel of d.povezaniURezultatima.filter((r) => r.odnos === 'citira')) {
      const other = items.find((x) => x.url === rel.url);
      if (other && !other.povezaniURezultatima.some((r) => r.url === d.url)) {
        other.povezaniURezultatima.push({ poslovniBroj: label(d), url: d.url, odnos: 'citiran u' });
      }
    }
  }
  // Odluke koje citiraju iste predmete
  const keysOf = new Map(items.map((d) => [d, new Map(d.citiraniPredmeti.map((c) => [caseKey(c), c]))]));
  for (const a of items) {
    for (const b of items) {
      if (a === b) continue;
      const kb = keysOf.get(b);
      const shared = [...keysOf.get(a)].filter(([k]) => kb.has(k)).map(([, c]) => c);
      if (shared.length && !a.povezaniURezultatima.some((r) => r.url === b.url)) {
        a.povezaniURezultatima.push({ poslovniBroj: label(b), url: b.url, odnos: `isti citirani predmeti: ${shared.join(', ')}` });
      }
    }
  }
  return items;
}

// Datumski filtar: ručno zadani ima prednost, inače onaj koji je model izveo iz upita.
function mergeFilters(filters = {}, plan) {
  const out = { ...filters };
  // Model ponekad vrati datum u drugom obliku; tražilici ide samo ispravan YYYY-MM-DD.
  const iso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v ?? '') ? v : '');
  if (!out.datumOd && iso(plan.datum_od)) out.datumOd = plan.datum_od;
  if (!out.datumDo && iso(plan.datum_do)) out.datumDo = plan.datum_do;
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v));
}

// Viši sud i veća relevantnost prvo.
const byRelevance = (a, b) => b.analiza.relevantnost - a.analiza.relevantnost || (a.tezina?.razina ?? 9) - (b.tezina?.razina ?? 9);

// opcije (kvadratići iznad tražilice): pravoEu – reference na pravo EU i EKLJP, provjera u CELLAR-u
// i pretpostavke modela o vezi s pravom EU; lokalnaZbirka – pretražuje se i data/corpus.
// Europsko pravo je zadano isključeno: uključuje ga korisnik kad mu treba.
export const DEFAULT_OPCIJE = { pravoEu: false, lokalnaZbirka: true };

export async function runQuery({ opis, filters = {}, sources = config.sources, opcije = {}, deps = {} }, progress = () => {}) {
  const L = deps.llm ?? llm;
  const S = deps.sources ?? SOURCES;
  const opc = { ...DEFAULT_OPCIJE, ...opcije };
  if (!opc.lokalnaZbirka) sources = sources.filter((name) => name !== 'local');
  const upozorenja = [];
  const costs = createCostTracker();
  const track = (model, usage) => costs.add(model, usage);
  const usd = () => `trošak dosad ≈ $${costs.summary.usd.toFixed(3)}`;

  progress({ korak: 'razrada', poruka: 'Razumijem upit i pripremam pretragu…' });
  const plan = await L.planQuery(opis, track);
  const primijenjeniFilteri = mergeFilters(filters, plan);
  // Isti upit (drukčija velika slova ili razmaci) ne šalje se tražilici dvaput.
  const seenQ = new Set();
  plan.upiti = (plan.upiti ?? []).map((q) => q.trim()).filter((q) => {
    const k = q.toLowerCase().replace(/\s+/g, ' ');
    return q && !seenQ.has(k) && seenQ.add(k);
  });

  progress({ korak: 'pretrazivanje', poruka: `Pretražujem odluke (${plan.upiti.length} upita)…` });
  // Izvori se pretražuju paralelno, a upiti unutar izvora do searchConcurrency istovremeno.
  // Rezultati se spajaju redom upita, pa je ishod isti kao kod pretrage jednog po jednog.
  const perSource = await Promise.all(sources.filter((name) => S[name]).map(async (name) => {
    let failures = 0;
    let successes = 0;
    const results = await mapLimit(plan.upiti, config.searchConcurrency, async (q) => {
      // Tri neuspjela upita bez ijednog uspješnog znače da izvor ne radi: ostali se ne šalju.
      if (failures >= 3 && !successes) return null;
      try {
        const found = await S[name].search(q, { filters: primijenjeniFilteri, limit: config.resultsPerQuery });
        successes++;
        return found;
      } catch (e) {
        failures++;
        upozorenja.push(`Izvor "${name}", upit "${q}": ${e.message}`);
        return null;
      }
    });
    return { name, results };
  }));
  const refs = new Map();
  for (const { name, results } of perSource) {
    results.forEach((found, i) => {
      for (const r of found ?? []) {
        if (!refs.has(r.url)) refs.set(r.url, { ...r, upiti: [plan.upiti[i]], src: name });
        else refs.get(r.url).upiti.push(plan.upiti[i]);
      }
    });
  }
  // Prednost odlukama koje je pronašlo više upita.
  const pool = [...refs.values()].sort((a, b) => b.upiti.length - a.upiti.length).slice(0, config.maxCandidates);
  const base = { opis, plan, primijenjeniFilteri, opcije: opc, pregledano: pool.length };
  if (!pool.length) {
    return { ...base, odluke: [], odgovor: null, trosak: costs.summary, upozorenja: [...upozorenja, 'Nije pronađena nijedna odluka.'] };
  }

  // Predselekcija po isječcima: puna analiza samo za najvjerojatnije relevantne odluke.
  let candidates = pool.slice(0, config.maxDecisions);
  if (pool.length > config.maxDecisions && L.screenCandidates) {
    progress({ korak: 'predselekcija', poruka: `Odabirem najrelevantnije od ${pool.length} pronađenih odluka… (${usd()})` });
    try {
      const { odabrane } = await L.screenCandidates(plan, pool, config.maxDecisions, track);
      const picked = [...new Set(odabrane.map((o) => o.id))].filter((i) => pool[i]).slice(0, config.maxDecisions).map((i) => pool[i]);
      if (picked.length) candidates = picked;
    } catch (e) {
      upozorenja.push(`Predselekcija nije uspjela (${e.message}); analiziraju se odluke koje je pronašlo najviše upita.`);
    }
  }

  let done = 0;
  const analyzed = await mapLimit(candidates, config.analysisConcurrency, async (ref) => {
    try {
      const d = await S[ref.src].fetchDecision(ref);
      if (!d.tekst || d.tekst.length < 200) throw new Error('tekst odluke nije pronađen na stranici');
      const skraceno = d.tekst.length > config.maxDecisionChars;
      const tekst = skraceno ? d.tekst.slice(0, config.maxDecisionChars) : d.tekst;
      const analiza = await L.assessDecision(opis, plan, d, tekst, track, { pravoEu: opc.pravoEu });
      // Isključeno europsko pravo ne ovisi o tome posluša li model uputu.
      if (!opc.pravoEu) analiza.moguce_eu_poveznice = [];
      analiza.relevantnost = Math.max(0, Math.min(100, Math.round(analiza.relevantnost)));
      // Svaki citat provjerava se doslovno u tekstu odluke.
      analiza.citati = (analiza.citati ?? []).filter((c) => c.tekst?.trim()).slice(0, 3)
        .map((c) => ({ ...c, provjeren: quoteInText(c.tekst, d.tekst) }));

      const { eu, ekljp } = opc.pravoEu ? extractEuReferences(d.tekst) : { eu: [], ekljp: false };
      const own = d.meta?.poslovniBroj ? caseKey(d.meta.poslovniBroj) : null;
      const result = {
        url: d.url,
        naslov: d.naslov,
        izvor: d.izvor,
        meta: d.meta,
        tezina: weigh(d.meta),
        navod: citationLine(d),
        upiti: ref.upiti,
        skraceno,
        analiza,
        citiraniPredmeti: uniqueByCaseKey(extractCaseNumbers(d.tekst)).filter((c) => caseKey(c) !== own),
        euReference: await verifyAll(eu),
        ekljp,
      };
      progress({ korak: 'analiza', poruka: `Analizirano ${++done}/${candidates.length} (${usd()})` });
      return result;
    } catch (e) {
      upozorenja.push(`${ref.url}: ${e.message}`);
      progress({ korak: 'analiza', poruka: `Analizirano ${++done}/${candidates.length} (${usd()})` });
      return null;
    }
  });

  // Glavni popis (redoslijed odgovara uputama [n] u odgovoru) i ostale pronađene odluke.
  const items = linkRelated(analyzed.filter(Boolean));
  const isMain = (d) => d.analiza.podudaranje !== 'ne' && d.analiza.relevantnost >= config.relevanceThreshold;
  const glavne = items.filter(isMain).sort(byRelevance);
  const ostale = items.filter((d) => !isMain(d)).sort(byRelevance);
  glavne.forEach((d, i) => { d.br = i + 1; d.istaknuta = true; });
  ostale.forEach((d) => { d.istaknuta = false; });

  let odgovor = null;
  if (glavne.length) {
    progress({ korak: 'odgovor', poruka: `Sastavljam odgovor… (${usd()})` });
    odgovor = await L.answerQuery(opis, plan, glavne, track, { pravoEu: opc.pravoEu });
    if (!opc.pravoEu && odgovor) odgovor.veza_s_pravom_eu = '';
  }
  return { ...base, odluke: [...glavne, ...ostale], odgovor, trosak: costs.summary, upozorenja };
}
