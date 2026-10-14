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
    const rel = d.url === 'x:3' ? 'ne' : 'da';
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
  assert.equal(r.odluke.length, 3);
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
});
