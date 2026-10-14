// Test tijeka obrade s lažnim (mock) modelom i izvorom. Tekstovi odluka su IZMIŠLJENI
// i služe samo za provjeru logike: provjera citata, EU reference, povezivanje predmeta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runQuery } from '../src/pipeline.js';

process.env.PRAKSA_VERIFY_EU = '0';

const DOCS = {
  'x:1': 'Vrhovni sud Republike Hrvatske, poslovni broj Rev 100/2020-2. '.padEnd(250, '.') +
    ' Sud smatra da štrajk vlastitog osoblja prijevoznika nije izvanredna okolnost u smislu Uredbe (EZ) br. 261/2004, ' +
    'u skladu s presudom Suda EU C-28/20. Vidi i Gž-55/2019.',
  'x:2': 'Županijski sud u Splitu, poslovni broj Gž-55/2019. '.padEnd(250, '.') + ' Odluka o otkazanom letu, Uredba (EZ) br. 261/2004.',
  'x:3': 'Općinski sud u Puli, poslovni broj P-9/2022. '.padEnd(250, '.') + ' Spor o najmu stana.',
  // Citira x:1 drukčijim zapisom ("Rev-100/20" umjesto "Rev 100/2020-2")
  'x:4': 'Općinski sud u Splitu, poslovni broj P-1/2023. '.padEnd(250, '.') + ' Vidi Rev-100/20.',
};

const source = {
  async search(q) {
    return Object.keys(DOCS).map((url) => ({ url, naslov: url, izvor: 'test' }));
  },
  async fetchDecision(ref) {
    const tekst = DOCS[ref.url];
    const m = tekst.match(/broj (.+?)\.(?: |\.)/);
    return { ...ref, tekst, meta: { poslovniBroj: m[1] } };
  },
};

const llm = {
  async planQuery() {
    return { sazetak_problema: 's', pravna_pitanja: [], kljucne_cinjenice: [], upiti: ['otkazan let štrajk'], pravna_podrucja: [], relevantni_propisi_hr: [], moguce_eu_poveznice: [] };
  },
  async assessDecision(opis, plan, d) {
    const rel = ['x:3', 'x:4'].includes(d.url) ? 'ne' : 'da';
    return {
      relevantnost: rel === 'da' ? 90 : 5, podudaranje: rel, objasnjenje: '', cinjenice_predmeta: '', ishod: '', pravno_shvacanje: '', zasto_je_vazno: '',
      citat: d.url === 'x:1' ? 'štrajk vlastitog osoblja prijevoznika nije izvanredna okolnost' : (d.url === 'x:2' ? 'ova rečenica ne postoji u odluci' : ''),
      primijenjeni_propisi: [], moguce_eu_poveznice: [],
    };
  },
  async synthesize(opis, items) {
    return { pregled: `n=${items.length}`, prevladavajuce_stajaliste: '', razlike_u_praksi: '', veza_s_pravom_eu: '', preporuke_za_daljnje_istrazivanje: [] };
  },
};

test('tijek obrade: provjere i povezivanje', async () => {
  const r = await runQuery({ opis: 'otkazan let zbog štrajka', sources: ['t'], deps: { llm, sources: { t: source } } });
  assert.equal(r.odluke.length, 4);
  const [d1] = r.odluke.filter((d) => d.url === 'x:1');
  const [d2] = r.odluke.filter((d) => d.url === 'x:2');
  assert.equal(d1.citatProvjeren, true);
  assert.equal(d2.citatProvjeren, false, 'izmišljeni citat mora biti označen');
  assert.ok(d1.euReference.some((e) => e.celex === '32004R0261'));
  assert.ok(d1.euReference.some((e) => e.oznaka === 'C-28/20'));
  assert.ok(d1.citiraniPredmeti.includes('Gž-55/2019'));
  assert.ok(d1.povezaniURezultatima.some((p) => p.url === 'x:2' && p.odnos === 'citira'));
  assert.ok(d2.povezaniURezultatima.some((p) => p.url === 'x:1' && p.odnos === 'citiran u'));
  assert.equal(r.sinteza.pregled, 'n=2', 'sinteza samo iz relevantnih odluka');
  const [d4] = r.odluke.filter((d) => d.url === 'x:4');
  assert.ok(d4.povezaniURezultatima.some((p) => p.url === 'x:1' && p.odnos === 'citira'), 'veza unatoč različitom zapisu broja');
  assert.ok(d1.povezaniURezultatima.some((p) => p.url === 'x:4' && p.odnos === 'citiran u'));
  assert.equal(d1.povezaniURezultatima.filter((p) => p.url === 'x:2').length, 1, 'bez dvostrukih veza');
});

test('ista odluka iz više upita analizira se jednom', async () => {
  let analiza = 0;
  const src = {
    async search(q) { return [{ url: 'x:1', naslov: 'x:1', izvor: 'test', q }]; },
    fetchDecision: source.fetchDecision,
  };
  const l = { ...llm, async planQuery() { return { ...(await llm.planQuery()), upiti: ['a', 'b', 'c'] }; },
    async assessDecision(...a) { analiza++; return llm.assessDecision(...a); } };
  const r = await runQuery({ opis: 'otkazan let zbog štrajka', sources: ['t'], deps: { llm: l, sources: { t: src } } });
  assert.equal(analiza, 1);
  assert.deepEqual(r.odluke[0].upiti, ['a', 'b', 'c']);
});

test('stajalište ide u razradu, analizu i sintezu; težina se računa', async () => {
  const seen = [];
  const l = {
    async planQuery(o, s) { seen.push(['plan', s]); return llm.planQuery(); },
    async assessDecision(o, p, d, t, s) { seen.push(['analiza', s]); return llm.assessDecision(o, p, d, t); },
    async synthesize(o, items, s) { seen.push(['sinteza', s]); return llm.synthesize(o, items); },
  };
  const r = await runQuery({ opis: 'otkazan let zbog štrajka', stajaliste: 'prijevoznik odgovara', sources: ['t'], deps: { llm: l, sources: { t: source } } });
  assert.ok(seen.length >= 3 && seen.every(([, s]) => s === 'prijevoznik odgovara'));
  assert.equal(r.stajaliste, 'prijevoznik odgovara');
  assert.ok(r.odluke.every((d) => 'tezina' in d));
});

test('trošak se zbraja iz svih poziva modela', async () => {
  const usage = { input_tokens: 1000, output_tokens: 100 };
  const l = {
    async planQuery(o, s, track) { track('claude-opus-5-5', usage); return llm.planQuery(); },
    async assessDecision(o, p, d, t, s, track) { track('claude-opus-5-5', usage); return llm.assessDecision(o, p, d, t); },
    async synthesize(o, items, s, track) { track('claude-opus-5-5', usage); return llm.synthesize(o, items); },
  };
  const r = await runQuery({ opis: 'otkazan let zbog štrajka', sources: ['t'], deps: { llm: l, sources: { t: source } } });
  assert.equal(r.trosak.pozivi, 1 + 4 + 1);
  assert.equal(r.trosak.usd, Math.round(6 * (1000 * 4 + 100 * 20) / 1e6 * 10000) / 10000);
});
