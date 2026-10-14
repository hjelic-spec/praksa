// Ugrađena prijava: bez nje se nitko ne može postaviti kao korisnik, a otvara se samo s njom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'praksa-ugradena-'));
process.env.PRAKSA_DATA_DIR = path.join(tmp, 'data');
process.env.PRAKSA_BUNDLED_AUTH = path.join(tmp, 'prijava-ugradena.json');
process.env.PRAKSA_PRICING_REFRESH = '0';
const auth = await import('../src/auth.js');
await fs.writeFile(process.env.PRAKSA_BUNDLED_AUTH, JSON.stringify(await auth.makeCredentials('ured@primjer.hr', 'Tajna Lozinka!')));
const { start } = await import('../src/server.js');
const { server, port } = await start({ port: 0 });

const post = async (p, body, cookie) => {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body),
  });
  return { status: res.status, cookie: res.headers.get('set-cookie')?.split(';')[0] };
};

test('s ugrađenom prijavom nema prvog postavljanja ni drugih korisnika', async () => {
  const s = await fetch(`http://127.0.0.1:${port}/api/auth/stanje`).then((r) => r.json());
  assert.equal(s.postoji, true);
  assert.equal((await post('/api/auth/postavljanje', { korisnik: 'netko', lozinka: 'neka-lozinka' })).status, 409);
  assert.equal((await post('/api/auth/prijava', { korisnik: 'netko', lozinka: 'neka-lozinka' })).status, 401);
  assert.equal((await post('/api/auth/prijava', { korisnik: 'ured@primjer.hr', lozinka: 'tajna lozinka!' })).status, 401, 'lozinka razlikuje velika i mala slova');
  assert.equal((await post('/api/auth/prijava', { korisnik: 'Ured@Primjer.hr', lozinka: 'Tajna Lozinka!' })).status, 200, 'e-pošta bez obzira na velika slova');
});

test('promijenjena lozinka ima prednost; brisanjem se vraća ugrađena', async () => {
  const { cookie } = await post('/api/auth/prijava', { korisnik: 'ured@primjer.hr', lozinka: 'Tajna Lozinka!' });
  assert.equal((await post('/api/auth/lozinka', { stara: 'Tajna Lozinka!', nova: 'Nova Lozinka 2' }, cookie)).status, 200);
  assert.equal((await post('/api/auth/prijava', { korisnik: 'ured@primjer.hr', lozinka: 'Tajna Lozinka!' })).status, 401);
  assert.equal((await post('/api/auth/prijava', { korisnik: 'ured@primjer.hr', lozinka: 'Nova Lozinka 2' })).status, 200);
  await fs.rm(path.join(tmp, 'data', 'prijava.json'));
  assert.equal((await post('/api/auth/prijava', { korisnik: 'ured@primjer.hr', lozinka: 'Tajna Lozinka!' })).status, 200);
  assert.equal((await post('/api/auth/postavljanje', { korisnik: 'netko', lozinka: 'neka-lozinka' })).status, 409, 'ni nakon brisanja nema postavljanja');
});

test.after(async () => {
  server.close();
  await fs.rm(tmp, { recursive: true, force: true });
});
