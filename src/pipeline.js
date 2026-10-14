// Tijek obrade jednog upita:
//   opis -> razrada (Claude) -> pretraživanje izvora -> dohvat odluka ->
//   analiza svake odluke (Claude) + deterministička ekstrakcija referenci ->
//   provjera citata i EU akata -> povezivanje predmeta -> sinteza (Claude).
import { config } from './config.js';
import * as llm from './llm.js';
import * as odluke from './sources/odluke.js';
import * as local from './sources/local.js';
import { extractCaseNumbers, extractEuReferences, quoteInText } from './extract.js';
import { verifyAll } from './eu.js';

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

export function linkRelated(items) {
  const byNo = new Map(items.filter((d) => d.meta?.poslovniBroj).map((d) => [d.meta.poslovniBroj, d]));
  for (const d of items) {
    d.povezaniURezultatima = [];
    for (const c of d.citiraniPredmeti) {
      const other = byNo.get(c);
      if (other && other !== d) d.povezaniURezultatima.push({ poslovniBroj: c, url: other.url, odnos: 'citira' });
    }
  }
  for (const d of items) {
    for (const rel of d.povezaniURezultatima) {
      const other = byNo.get(rel.poslovniBroj);
      if (other && !other.povezaniURezultatima.some((r) => r.url === d.url)) {
        other.povezaniURezultatima.push({ poslovniBroj: d.meta.poslovniBroj ?? d.naslov, url: d.url, odnos: 'citiran u' });
      }
    }
  }
  // Odluke koje citiraju iste predmete
  for (const a of items) {
    for (const b of items) {
      if (a === b) continue;
      const shared = a.citiraniPredmeti.filter((c) => b.citiraniPredmeti.includes(c));
      if (shared.length && !a.povezaniURezultatima.some((r) => r.url === b.url)) {
        a.povezaniURezultatima.push({ poslovniBroj: b.meta?.poslovniBroj ?? b.naslov, url: b.url, odnos: `isti citirani predmeti: ${shared.join(', ')}` });
      }
    }
  }
  return items;
}

export async function runQuery({ opis, filters = {}, sources = config.sources, deps = {} }, progress = () => {}) {
  const L = deps.llm ?? llm;
  const S = deps.sources ?? SOURCES;
  const upozorenja = [];

  progress({ korak: 'razrada', poruka: 'Razrađujem opis i pripremam upite za tražilicu…' });
  const plan = await L.planQuery(opis);

  progress({ korak: 'pretrazivanje', poruka: `Pretražujem (${plan.upiti.length} upita)…` });
  const refs = new Map();
  for (const name of sources) {
    const src = S[name];
    if (!src) continue;
    for (const q of plan.upiti) {
      try {
        for (const r of await src.search(q, { filters, limit: config.maxDecisions })) {
          if (!refs.has(r.url)) refs.set(r.url, { ...r, upiti: [q], src: name });
          else refs.get(r.url).upiti.push(q);
        }
      } catch (e) {
        upozorenja.push(`Izvor "${name}", upit "${q}": ${e.message}`);
        break; // isti izvor vjerojatno neće raditi ni za ostale upite
      }
    }
  }
  // Prednost odlukama koje je pronašlo više upita
  const candidates = [...refs.values()].sort((a, b) => b.upiti.length - a.upiti.length).slice(0, config.maxDecisions);
  if (!candidates.length) {
    return { opis, plan, odluke: [], sinteza: null, upozorenja: [...upozorenja, 'Nije pronađena nijedna odluka.'] };
  }

  let done = 0;
  const analyzed = await mapLimit(candidates, config.analysisConcurrency, async (ref) => {
    try {
      const d = await S[ref.src].fetchDecision(ref);
      if (!d.tekst || d.tekst.length < 200) throw new Error('tekst odluke nije pronađen na stranici');
      const skraceno = d.tekst.length > config.maxDecisionChars;
      const tekst = skraceno ? d.tekst.slice(0, config.maxDecisionChars) : d.tekst;
      const analiza = await L.assessDecision(opis, plan, d, tekst);
      analiza.relevantnost = Math.max(0, Math.min(100, Math.round(analiza.relevantnost)));

      const { eu, ekljp } = extractEuReferences(d.tekst);
      const own = d.meta?.poslovniBroj;
      const result = {
        url: d.url,
        naslov: d.naslov,
        izvor: d.izvor,
        meta: d.meta,
        upiti: ref.upiti,
        skraceno,
        analiza,
        citatProvjeren: analiza.citat ? quoteInText(analiza.citat, d.tekst) : null,
        primijenjeniPropisiUTekstu: analiza.primijenjeni_propisi,
        citiraniPredmeti: extractCaseNumbers(d.tekst).filter((c) => c !== own),
        euReference: await verifyAll(eu),
        ekljp,
      };
      progress({ korak: 'analiza', poruka: `Analizirano ${++done}/${candidates.length}` });
      return result;
    } catch (e) {
      upozorenja.push(`${ref.url}: ${e.message}`);
      progress({ korak: 'analiza', poruka: `Analizirano ${++done}/${candidates.length}` });
      return null;
    }
  });

  const items = linkRelated(analyzed.filter(Boolean))
    .sort((a, b) => b.analiza.relevantnost - a.analiza.relevantnost);
  const relevant = items.filter((d) => d.analiza.podudaranje !== 'ne');

  let sinteza = null;
  if (relevant.length) {
    progress({ korak: 'sinteza', poruka: 'Izrađujem sintezu prakse…' });
    sinteza = await L.synthesize(opis, relevant);
  }
  return { opis, plan, odluke: items, sinteza, upozorenja };
}
