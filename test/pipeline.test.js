// Test tijeka obrade s lažnim (mock) modelom i izvorom. Tekstovi odluka su IZMIŠLJENI
// i služe samo za provjeru logike: predselekcija, provjera citata, EU reference,
// povezivanje predmeta, prag relevantnosti, navod i trošak.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.PRAKSA_VERIFY_EU = '0';
process.env.PRAKSA_MAX_DECISIONS = '4';
process.env.PRAKSA_RELEVANCE_THRESHOLD = '50';
const { runQuery } = await import('../src/pipeline.js');

const DOCS = {
  'x:1': 'Vrhovni sud Republike Hrvatske, poslovni broj Rev 100/2020-2. '.padEnd(250, '.') +
    ' Sud smatra da štrajk vlastitog osoblja prijevoznika nije izvanredna okolnost u smislu Uredbe (EZ) br. 261/2004, ' +
    'u skladu s presudom Suda EU C-28/20. Vidi i Gž-55/2019.',
  'x:2': 'Županijski sud u Splitu, poslovni broj Gž-55/2019. '.padEnd(250, '.') + ' Odluka o otkazanom letu, Uredba (EZ) br. 261/2004.',
  'x:3': 'Općinski sud u Puli, poslovni broj P-9/2022. '.padEnd(250, '.') + ' Spor o najmu stana.',
  // Citira x:1 drukčijim zapisom ("Rev-100/20" umjesto "Rev 100/2020-2")
  'x:4': 'Općinski sud u Splitu, poslovni broj P-1/2023. '.padEnd(250, '.') + ' Vidi Rev-100/20.',
};

const source = (docs = DOCS) => ({
  async search() {
    return Object.keys(docs).map((url) => ({ url, naslov: url, izvor: 'test', isjecak: docs[url].slice(0, 80) }));
  },
  async fetchDecision(ref) {
    const tekst = docs[ref.url];
    const m = tekst.match(/broj (.+?)\.(?: |\.)/);
    return { ...ref, tekst, meta: { poslovniBroj: m[1], sud: tekst.split(',')[0], datum: '1.2.2021.', vrsta: 'Presuda' } };
  },
});

const PLAN = {
  pravno_pitanje: 'Je li štrajk osoblja izvanredna okolnost?', trazeno_stajaliste: 'prijevoznik odgovara',
  kljucne_cinjenice: [], upiti: ['otkazan let štrajk'], relevantni_propisi_hr: [], datum_od: '2020-01-01', datum_do: '',
};

const llm = {
  async planQuery() { return { ...PLAN }; },
  async assessDecision(opis, plan, d) {
    const rel = ['x:3', 'x:4'].includes(d.url) ? 'ne' : 'da';
    return {
      relevantnost: rel === 'da' ? (d.url === 'x:1' ? 90 : 70) : 5, podudaranje: rel,
      odgovor_na_upit: '', pravno_pitanje: '', pravno_shvacanje: 'shvaćanje', bitne_cinjenice: '', razlike_od_upita: '', ishod: '',
      citati: d.url === 'x:1'
        ? [{ tekst: 'štrajk vlastitog osoblja prijevoznika nije izvanredna okolnost', znacaj: 'shvaćanje' }, { tekst: 'izmišljena rečenica', znacaj: '' }]
        : (d.url === 'x:2' ? [{ tekst: 'ova rečenica ne postoji u odluci', znacaj: '' }] : []),
      primijenjeni_propisi: [], smjer: 'u prilog', kako_iskoristiti: '', primjenjivost: { upozorenje: false, razlog: '' }, moguce_eu_poveznice: [],
    };
  },
  async answerQuery(opis, plan, items) {
    return { kratki_odgovor: `n=${items.map((d) => d.br).join(',')}`, vodeca_praksa: '', suprotna_praksa: '', upozorenja: [], dalje_provjeriti: [], veza_s_pravom_eu: '' };
  },
};

test('tijek obrade: provjere citata, povezivanje, prag, navod i filtar iz upita', async () => {
  let usedFilters;
  const src = { ...source(), async search(q, o) { usedFilters = o.filters; return source().search(q, o); } };
  const r = await runQuery({ opis: 'otkazan let zbog štrajka', sources: ['t'], opcije: { pravoEu: true }, deps: { llm, sources: { t: src } } });
  assert.deepEqual(usedFilters, { datumOd: '2020-01-01' }, 'datum izveden iz upita');
  assert.equal(r.odluke.length, 4);
  const byUrl = Object.fromEntries(r.odluke.map((d) => [d.url, d]));
  const [d1, d2, d4] = [byUrl['x:1'], byUrl['x:2'], byUrl['x:4']];
  assert.deepEqual(d1.analiza.citati.map((c) => c.provjeren), [true, false], 'svaki citat provjeren zasebno');
  assert.equal(d2.analiza.citati[0].provjeren, false, 'izmišljeni citat mora biti označen');
  assert.ok(d1.euReference.some((e) => e.celex === '32004R0261'));
  assert.ok(d1.euReference.some((e) => e.oznaka === 'C-28/20'));
  assert.ok(d1.povezaniURezultatima.some((p) => p.url === 'x:2' && p.odnos === 'citira'));
  assert.ok(d4.povezaniURezultatima.some((p) => p.url === 'x:1' && p.odnos === 'citira'), 'veza unatoč različitom zapisu broja');
  assert.equal(d1.navod, 'Vrhovni sud Republike Hrvatske, Rev 100/2020-2 od 1.2.2021. (presuda)');

  // Glavni popis: relevantne po redu, s brojevima za upute [n]; ostale iza.
  assert.deepEqual(r.odluke.map((d) => [d.url, d.istaknuta, d.br]), [['x:1', true, 1], ['x:2', true, 2], ['x:3', false, undefined], ['x:4', false, undefined]]);
  assert.equal(r.odgovor.kratki_odgovor, 'n=1,2', 'odgovor samo iz glavnih odluka');
  assert.equal(r.pregledano, 4);
});

test('predselekcija: kad je kandidata više od N, analiziraju se samo odabrani', async () => {
  const docs = { ...DOCS };
  for (let i = 5; i <= 9; i++) docs[`x:${i}`] = `Općinski sud u Zadru, poslovni broj P-${i}/2020. `.padEnd(300, '.');
  const analysed = [];
  let screened;
  const l = {
    ...llm,
    async screenCandidates(plan, pool, n) {
      screened = { pool: pool.length, n };
      return { odabrane: [{ id: pool.findIndex((c) => c.url === 'x:2'), ocjena: 90 }, { id: pool.findIndex((c) => c.url === 'x:1'), ocjena: 80 }, { id: 999, ocjena: 1 }] };
    },
    async assessDecision(...a) { analysed.push(a[2].url); return llm.assessDecision(...a); },
  };
  const r = await runQuery({ opis: 'otkazan let zbog štrajka', sources: ['t'], deps: { llm: l, sources: { t: source(docs) } } });
  assert.deepEqual(screened, { pool: 9, n: 4 });
  assert.deepEqual(analysed.sort(), ['x:1', 'x:2'], 'nepostojeći id se zanemaruje');
  assert.equal(r.pregledano, 9);
});

test('ista odluka iz više upita analizira se jednom', async () => {
  let analiza = 0;
  const src = { ...source(), async search() { return [{ url: 'x:1', naslov: 'x:1', izvor: 'test' }]; } };
  const l = { ...llm, async planQuery() { return { ...PLAN, upiti: ['a', 'b', 'c'] }; },
    async assessDecision(...a) { analiza++; return llm.assessDecision(...a); } };
  const r = await runQuery({ opis: 'otkazan let zbog štrajka', sources: ['t'], deps: { llm: l, sources: { t: src } } });
  assert.equal(analiza, 1);
  assert.deepEqual(r.odluke[0].upiti, ['a', 'b', 'c']);
});

test('trošak se zbraja iz svih poziva modela', async () => {
  const usage = { input_tokens: 1000, output_tokens: 100 };
  const l = {
    async planQuery(o, track) { track('claude-opus-5-5', usage); return llm.planQuery(); },
    async assessDecision(o, p, d, t, track) { track('claude-opus-5-5', usage); return llm.assessDecision(o, p, d, t); },
    async answerQuery(o, p, items, track) { track('claude-opus-5-5', usage); return llm.answerQuery(o, p, items); },
  };
  const r = await runQuery({ opis: 'otkazan let zbog štrajka', sources: ['t'], deps: { llm: l, sources: { t: source() } } });
  assert.equal(r.trosak.pozivi, 1 + 4 + 1);
  assert.equal(r.trosak.usd, Math.round(6 * (1000 * 4 + 100 * 20) / 1e6 * 10000) / 10000);
});

test('jedna greška tražilice ne prekida ostale upite; neispravan datum iz modela se ne šalje', async () => {
  const asked = [];
  let filters;
  const src = { ...source(), async search(q, o) { asked.push(q); filters = o.filters; if (q === 'b') throw new Error('istek vremena'); return source().search(q, o); } };
  const l = { ...llm, async planQuery() { return { ...PLAN, upiti: ['a', 'b', 'c'], datum_od: '2020', datum_do: '2024-12-31' }; } };
  const r = await runQuery({ opis: 'otkazan let zbog štrajka', sources: ['t'], deps: { llm: l, sources: { t: src } } });
  assert.deepEqual(asked, ['a', 'b', 'c']);
  assert.deepEqual(filters, { datumDo: '2024-12-31' });
  assert.ok(r.upozorenja.some((u) => u.includes('istek vremena')));
});

test('opcije: isključeno europsko pravo i lokalna zbirka', async () => {
  const seen = { assess: [], answer: [], searched: [] };
  const l = {
    ...llm,
    // Model "ne posluša" uputu i ipak vrati pretpostavke o pravu EU – pipeline ih mora ukloniti.
    async assessDecision(o, p, d, t, track, opc) {
      seen.assess.push(opc);
      return { ...(await llm.assessDecision(o, p, d)), moguce_eu_poveznice: [{ akt: 'Direktiva 93/13/EEZ', obrazlozenje: 'x' }] };
    },
    async answerQuery(o, p, items, track, opc) {
      seen.answer.push(opc);
      return { ...(await llm.answerQuery(o, p, items)), veza_s_pravom_eu: 'Uredba 261/2004' };
    },
  };
  const named = (name) => ({ ...source(), async search(q, o) { seen.searched.push(name); return source().search(q, o); } });
  const r = await runQuery({
    opis: 'otkazan let zbog štrajka', sources: ['t', 'local'], opcije: { pravoEu: false, lokalnaZbirka: false },
    deps: { llm: l, sources: { t: named('t'), local: named('local') } },
  });
  assert.deepEqual([...new Set(seen.searched)], ['t'], 'lokalna zbirka se ne pretražuje');
  assert.ok(seen.assess.every((o) => o.pravoEu === false) && seen.answer[0].pravoEu === false, 'model dobiva uputu');
  const d1 = r.odluke.find((d) => d.url === 'x:1');
  assert.deepEqual(d1.euReference, [], 'nema izvlačenja ni provjere EU referenci');
  assert.equal(d1.ekljp, false);
  assert.ok(r.odluke.every((d) => d.analiza.moguce_eu_poveznice.length === 0), 'pretpostavke modela uklonjene');
  assert.equal(r.odgovor.veza_s_pravom_eu, '');
  assert.deepEqual(r.opcije, { pravoEu: false, lokalnaZbirka: false });

  // Zadano: europsko pravo isključeno, lokalna zbirka uključena.
  seen.searched = [];
  seen.assess = [];
  const z = await runQuery({ opis: 'otkazan let zbog štrajka', sources: ['t', 'local'], deps: { llm: l, sources: { t: named('t'), local: named('local') } } });
  assert.deepEqual([...new Set(seen.searched)], ['t', 'local']);
  assert.deepEqual(z.odluke.find((d) => d.url === 'x:1').euReference, []);
  assert.ok(seen.assess.every((o) => o.pravoEu === false));
  assert.deepEqual(z.opcije, { pravoEu: false, lokalnaZbirka: true });

  // Izričito uključeno europsko pravo.
  const e = await runQuery({ opis: 'otkazan let zbog štrajka', sources: ['t'], opcije: { pravoEu: true }, deps: { llm, sources: { t: named('t') } } });
  assert.ok(e.odluke.find((d) => d.url === 'x:1').euReference.length > 0);
});

test('isti upit se tražilici ne šalje dvaput', async () => {
  const asked = [];
  const l = { ...llm, async planQuery() { return { ...PLAN, upiti: ['Otkazan let štrajk', 'otkazan  let štrajk ', 'izvanredna okolnost', ''] }; } };
  const src = { ...source(), async search(q, o) { asked.push(q); return source().search(q, o); } };
  const r = await runQuery({ opis: 'otkazan let zbog štrajka', sources: ['t'], deps: { llm: l, sources: { t: src } } });
  assert.deepEqual(asked, ['Otkazan let štrajk', 'izvanredna okolnost']);
  assert.deepEqual(r.plan.upiti, asked);
});
