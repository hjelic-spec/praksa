// Lokalna zbirka (data/corpus): pretraga, osvježavanje izmijenjenih i obrisanih datoteka,
// zaštita od putanja izvan zbirke. Odluke su IZMIŠLJENE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'praksa-zbirka-'));
process.env.PRAKSA_DATA_DIR = tmp;
const corpus = path.join(tmp, 'corpus');
await fs.mkdir(corpus);
const local = await import('../src/sources/local.js');

const write = (f, s) => fs.writeFile(path.join(corpus, f), s);

test('pretraga, izmjena i brisanje datoteke u zbirci', async () => {
  await write('a.txt', 'Vrhovni sud Republike Hrvatske, Rev 1/2020. Naknada nematerijalne štete putniku u autobusu.');
  await write('b.html', '<html><body><nav>Izbornik</nav><p>Županijski sud u Splitu, Gž-2/2021. Najam stana.</p></body></html>');
  assert.equal(await local.count(), 2);

  let r = await local.search('naknada štete putnik autobus');
  assert.deepEqual(r.map((x) => x.url), ['local:a.txt']);
  r = await local.search('najam stana');
  assert.deepEqual(r.map((x) => x.url), ['local:b.html']);
  const d = await local.fetchDecision(r[0]);
  assert.ok(d.tekst.includes('Najam stana') && !d.tekst.includes('Izbornik'));
  assert.equal(d.meta.poslovniBroj, 'Gž-2/2021');

  // Izmijenjena datoteka (drukčija veličina) čita se ponovno.
  await write('a.txt', 'Vrhovni sud Republike Hrvatske, Rev 1/2020. Ugovor o zakupu poslovnog prostora, otkaz zakupa.');
  assert.deepEqual((await local.search('zakup poslovnog prostora')).map((x) => x.url), ['local:a.txt']);
  assert.deepEqual(await local.search('naknada štete putnik autobus'), []);

  await fs.rm(path.join(corpus, 'b.html'));
  assert.deepEqual(await local.search('najam stana'), [], 'obrisana datoteka se više ne pronalazi');
});

test('dohvat odbija putanju izvan zbirke', async () => {
  await assert.rejects(local.fetchDecision({ url: 'local:../korisnici.json' }), /Neispravan naziv/);
});

test.after(() => fs.rm(tmp, { recursive: true, force: true }));
