// Spremanje predmeta, težina odluke i izvoz u Word (u privremenoj mapi).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'praksa-'));
process.env.PRAKSA_PREDMETI_DIR = tmp;
const store = await import('../src/store.js');
const { buildDocx, citationLine } = await import('../src/export.js');
const { weigh } = await import('../src/authority.js');

const odluka = (url, smjer, meta) => ({
  url, naslov: url, meta, tezina: weigh(meta, new Date('2026-10-14')), citatProvjeren: true,
  analiza: { relevantnost: 80, smjer, citat: 'doslovni citat', pravno_shvacanje: 'shvaćanje', ishod: 'ishod', smjer_obrazlozenje: 'zato', kako_iskoristiti: 'ovako', primjenjivost: { upozorenje: false, razlog: '' } },
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
