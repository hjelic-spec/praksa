// Spremanje predmeta, težina odluke i izvoz u Word (u privremenoj mapi).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'praksa-'));
process.env.PRAKSA_PREDMETI_DIR = tmp;
const storeMod = await import('../src/store.js');
const store = { ...storeMod.forUser('korisnik1'), selectedDecisions: storeMod.selectedDecisions, DEFAULT_NAZIV: storeMod.DEFAULT_NAZIV };
const { buildDocx, citationLine } = await import('../src/export.js');
const { weigh } = await import('../src/authority.js');

const odluka = (url, smjer, meta) => ({
  url, naslov: url, meta, tezina: weigh(meta, new Date('2026-10-14')), citatProvjeren: true,
  analiza: { relevantnost: 80, smjer, citati: [{ tekst: 'doslovni citat', znacaj: 'shvaćanje', provjeren: true }], pravno_shvacanje: 'shvaćanje', pravno_pitanje: 'pitanje', bitne_cinjenice: 'činjenice', razlike_od_upita: 'razlika', ishod: 'ishod', primijenjeni_propisi: ['čl. 240. ZKP'], kako_iskoristiti: 'ovako', primjenjivost: { upozorenje: false, razlog: '' } },
});

test('težina odluke iz metapodataka', () => {
  const w = weigh({ sud: 'Vrhovni sud Republike Hrvatske', datum: '22.4.1992.', pravomocnost: 'Pravomoćna odluka' }, new Date('2026-10-14'));
  assert.deepEqual([w.razina, w.pravomocna, w.godina, w.stara], [1, true, 1992, true]);
  const z = weigh({ sud: 'Županijski sud u Splitu', datum: '1.2.2024.', pravomocnost: 'Nepravomoćna odluka' }, new Date('2026-10-14'));
  assert.deepEqual([z.razina, z.pravomocna, z.stara], [3, false, false]);
});

test('citat za podnesak', () => {
  assert.equal(
    citationLine({ meta: { sud: 'Vrhovni sud Republike Hrvatske', poslovniBroj: 'Rev-49/2024-2', datum: '5.6.2024.', vrsta: 'Presuda', ecli: 'ECLI:HR:VSRH:2024:1' } }),
    'Vrhovni sud Republike Hrvatske, Rev-49/2024-2 od 5.6.2024. (presuda), ECLI:HR:VSRH:2024:1',
  );
});

test('predmet: pretrage, bilješke, odabir i izvoz', async () => {
  const p = await store.createPredmet('K-1/2026 – test');
  const a = odluka('https://x/1', 'u prilog', { sud: 'Vrhovni sud Republike Hrvatske', poslovniBroj: 'Kž-1/2020', datum: '1.1.2020.' });
  const b = odluka('https://x/2', 'protiv', { sud: 'Županijski sud u Zagrebu', poslovniBroj: 'Kž-2/2021', datum: '1.1.2021.' });
  await store.addPretraga(p.id, { id: 's1', datum: '2026-10-14T10:00:00Z', opis: 'opis', stajaliste: 'teza', rezultat: { odluke: [a, b] } });
  // Istodobni upisi ne smiju se međusobno poništiti.
  await Promise.all([
    store.updateOdluka(p.id, a.url, { odabrano: true }),
    store.updateOdluka(p.id, a.url, { biljeska: 'ključna odluka' }),
    store.updateOdluka(p.id, b.url, { odabrano: true }),
  ]);
  const saved = await store.getPredmet(p.id);
  assert.deepEqual(saved.odluke[a.url], { biljeska: 'ključna odluka', odabrano: true });
  assert.equal((await store.listPredmeti())[0].brojPretraga, 1);

  const sel = store.selectedDecisions(saved);
  assert.equal(sel.length, 2);
  const buf = await buildDocx(saved, sel);
  assert.equal(buf.subarray(0, 2).toString(), 'PK', 'docx je zip arhiva');
  assert.ok(buf.length > 3000);

  await store.deletePretraga(p.id, 's1');
  assert.equal((await store.getPredmet(p.id)).pretrage.length, 0);
  await assert.rejects(store.getPredmet('../izvan'), /Neispravna oznaka/);
});

test.after(() => fs.rm(tmp, { recursive: true, force: true }));

test('trošak pretrage iz usage', async () => {
  const { createCostTracker, costOf } = await import('../src/pricing.js');
  assert.equal(costOf('claude-opus-5-5', { input_tokens: 1_000_000 }), 4);
  assert.equal(costOf('claude-opus-5-5', { output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 }), 20.2);
  const t = createCostTracker();
  t.add('claude-opus-5-5', { input_tokens: 10_000, output_tokens: 2_000 });
  t.add('claude-opus-4-8', { input_tokens: 10_000, output_tokens: 1_000 }); // zamjenski model
  t.add('nepoznat-model', { input_tokens: 5 });
  assert.deepEqual([t.summary.pozivi, t.summary.ulazniTokeni, t.summary.izlazniTokeni], [3, 20_005, 3_000]);
  assert.equal(t.summary.usd, 0.04 + 0.04 + 0.05 + 0.025);
  assert.deepEqual(t.summary.nepoznatiModeli, ['nepoznat-model']);
});

test('zadani predmet nastaje jednom i koristi se dalje', async () => {
  const [a, b] = await Promise.all([store.ensureDefaultPredmet(), store.ensureDefaultPredmet()]);
  assert.equal(a.id, b.id);
  assert.equal((await store.ensureDefaultPredmet()).id, a.id);
  assert.equal(a.naziv, store.DEFAULT_NAZIV);
  assert.ok((await store.listPredmeti()).find((p) => p.id === a.id).zadani);
});

test('izvoz prihvaća i stariji oblik spremljene analize (jedan citat)', async () => {
  const { quotesOf } = await import('../src/export.js');
  assert.deepEqual(quotesOf({ citatProvjeren: true, analiza: { citat: 'stari citat' } }), [{ tekst: 'stari citat', znacaj: '', provjeren: true }]);
  const p = { naziv: 'stari' };
  const buf = await buildDocx(p, [{ url: 'https://x/9', meta: { poslovniBroj: 'Rev-1/2019' }, citatProvjeren: true,
    analiza: { relevantnost: 60, smjer: 'neutralno', citat: 'stari citat', pravno_shvacanje: 'shvaćanje', cinjenice_predmeta: 'stare činjenice' } }]);
  assert.equal(buf.subarray(0, 2).toString(), 'PK');
});
