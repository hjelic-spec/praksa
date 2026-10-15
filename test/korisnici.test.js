// Registracija uz odobrenje administratora, ovlasti i odvojeni podaci korisnika.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'praksa-korisnici-'));
process.env.PRAKSA_DATA_DIR = tmp;
process.env.PRAKSA_BUNDLED_AUTH = path.join(tmp, 'nema.json');
process.env.PRAKSA_PRICING_REFRESH = '0';
process.env.ANTHROPIC_API_KEY = '';
// Predmet iz verzije s jednim korisnikom: mora prijeći administratoru.
await fs.mkdir(path.join(tmp, 'predmeti'), { recursive: true });
await fs.writeFile(path.join(tmp, 'predmeti', 'stari01.json'), JSON.stringify({ id: 'stari01', naziv: 'Stari predmet', pretrage: [], odluke: {} }));

const { start } = await import('../src/server.js');
const { server, port } = await start({ port: 0 });

async function call(p, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, {
    method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, cookie: res.headers.get('set-cookie')?.split(';')[0], data: await res.json().catch(() => null) };
}
const login = async (korisnik, lozinka) => call('/api/auth/prijava', { method: 'POST', body: { korisnik, lozinka } });

let admin;
let ana;

test('administrator, registracija i čekanje na odobrenje', async () => {
  assert.equal((await call('/api/auth/registracija', { method: 'POST', body: { ime: 'Ana', email: 'ana@ured.hr', lozinka: 'ana-lozinka' } })).status, 409, 'prije administratora nema registracije');
  admin = (await call('/api/auth/postavljanje', { method: 'POST', body: { korisnik: 'admin@ured.hr', lozinka: 'admin-lozinka' } })).cookie;
  assert.ok(admin);
  assert.deepEqual((await call('/api/predmeti', { cookie: admin })).data.map((p) => p.naziv), ['Stari predmet'], 'stari predmeti prelaze administratoru');

  assert.equal((await call('/api/auth/registracija', { method: 'POST', body: { ime: 'Ana', email: 'nije-email', lozinka: 'ana-lozinka' } })).status, 400);
  assert.equal((await call('/api/auth/registracija', { method: 'POST', body: { ime: 'Ana Anić', email: 'ana@ured.hr', lozinka: 'ana-lozinka' } })).status, 201);
  assert.equal((await call('/api/auth/registracija', { method: 'POST', body: { ime: 'Ana 2', email: 'ANA@ured.hr', lozinka: 'ana-lozinka' } })).status, 409, 'ista e-pošta');
  const r = await login('ana@ured.hr', 'ana-lozinka');
  assert.equal(r.status, 403);
  assert.match(r.data.greska, /čeka odobrenje/);
  assert.equal((await call('/api/info', { cookie: admin })).data.naCekanju, 1);
});

test('samo administrator vidi korisnike i postavke', async () => {
  const list = (await call('/api/admin/korisnici', { cookie: admin })).data;
  const a = list.find((u) => u.email === 'ana@ured.hr');
  assert.equal(a.status, 'ceka');
  assert.deepEqual(a.ovajMjesec, { pretrage: 0, usd: 0 });
  assert.ok(!('hash' in a) && !('salt' in a), 'bez sažetka lozinke');

  assert.equal((await call(`/api/admin/korisnici/${a.id}`, { method: 'POST', cookie: admin, body: { akcija: 'odobri' } })).status, 200);
  ana = (await login('ana@ured.hr', 'ana-lozinka')).cookie;
  assert.ok(ana);
  const info = (await call('/api/info', { cookie: ana })).data;
  assert.deepEqual([info.uloga, info.ime, info.naCekanju], ['korisnik', 'Ana Anić', undefined]);
  for (const p of ['/api/admin/korisnici', '/api/postavke', '/api/cjenik']) assert.equal((await call(p, { cookie: ana })).status, 403, p);
  assert.equal((await call('/api/postavke', { method: 'POST', cookie: ana, body: { maxOdluka: 30 } })).status, 403);
  assert.equal((await call(`/api/admin/korisnici/${list.find((u) => u.uloga === 'admin').id}`, { method: 'POST', cookie: admin, body: { akcija: 'blokiraj' } })).status, 400, 'administrator ne blokira sebe');
});

test('korisnici ne vide tuđe predmete', async () => {
  const p = (await call('/api/predmeti', { method: 'POST', cookie: ana, body: { naziv: 'Anin predmet' } })).data;
  assert.deepEqual((await call('/api/predmeti', { cookie: ana })).data.map((x) => x.naziv), ['Anin predmet']);
  assert.ok(!(await call('/api/predmeti', { cookie: admin })).data.some((x) => x.naziv === 'Anin predmet'));
  assert.equal((await call(`/api/predmeti/${p.id}`, { cookie: admin })).status, 404);
  assert.equal((await call('/api/predmeti/stari01', { cookie: ana })).status, 404);
});

test('blokiran korisnik odmah gubi pristup; brisanje uklanja i predmete', async () => {
  const a = (await call('/api/admin/korisnici', { cookie: admin })).data.find((u) => u.email === 'ana@ured.hr');
  await call(`/api/admin/korisnici/${a.id}`, { method: 'POST', cookie: admin, body: { akcija: 'blokiraj' } });
  assert.equal((await call('/api/predmeti', { cookie: ana })).status, 401);
  assert.match((await login('ana@ured.hr', 'ana-lozinka')).data.greska, /blokiran/);
  await call(`/api/admin/korisnici/${a.id}`, { method: 'POST', cookie: admin, body: { akcija: 'obrisi' } });
  assert.ok(!(await call('/api/admin/korisnici', { cookie: admin })).data.some((u) => u.email === 'ana@ured.hr'));
  await assert.rejects(fs.access(path.join(tmp, 'predmeti', a.id)));
});

test.after(async () => {
  server.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test('nemoguće radnje nad računom i neispravan JSON odbijeni', async () => {
  await call('/api/auth/registracija', { method: 'POST', body: { ime: 'Ivo', email: 'ivo@ured.hr', lozinka: 'ivo-lozinka' } });
  const ivo = (await call('/api/admin/korisnici', { cookie: admin })).data.find((u) => u.email === 'ivo@ured.hr');
  assert.equal((await call(`/api/admin/korisnici/${ivo.id}`, { method: 'POST', cookie: admin, body: { akcija: 'deblokiraj' } })).status, 400, 'čekanje se ne može „deblokirati“');
  assert.equal((await call(`/api/admin/korisnici/${ivo.id}`, { method: 'POST', cookie: admin, body: { akcija: 'obrisi' } })).status, 400);
  const res = await fetch(`http://127.0.0.1:${port}/api/auth/prijava`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{neispravno' });
  assert.equal(res.status, 400);
});
