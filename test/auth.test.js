// Prijava, postavke i zaštita API-ja (poslužitelj na slobodnom portu, podaci u privremenoj mapi).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'praksa-auth-'));
process.env.PRAKSA_DATA_DIR = tmp;
process.env.PRAKSA_BUNDLED_AUTH = path.join(tmp, 'nema-ugradene.json'); // test prvog postavljanja
process.env.ANTHROPIC_API_KEY = ''; // prazno, da ga ne postavi .env iz projekta
process.env.PRAKSA_PRICING_REFRESH = '0'; // bez mreže
const { start } = await import('../src/server.js');
const { server, port } = await start({ port: 0 });
const base = `http://127.0.0.1:${port}`;

async function call(p, { method = 'GET', body, cookie, headers = {} } = {}) {
  const res = await fetch(base + p, {
    method, redirect: 'manual',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const cookieOut = res.headers.get('set-cookie')?.split(';')[0];
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, cookie: cookieOut, data: type.includes('json') ? await res.json() : null, location: res.headers.get('location') };
}

test('bez prijave: API odbijen, stranica preusmjerena na prijavu', async () => {
  assert.equal((await call('/api/predmeti')).status, 401);
  const r = await call('/');
  assert.equal(r.status, 302);
  assert.equal(r.location, '/prijava.html');
  assert.equal((await call('/prijava.html')).status, 200);
  assert.deepEqual((await call('/api/auth/stanje')).data, { postoji: false, prijavljen: false });
});

test('postavljanje, prijava, postavke, promjena lozinke i odjava', async () => {
  assert.equal((await call('/api/auth/postavljanje', { method: 'POST', body: { korisnik: 'hj', lozinka: 'kratka' } })).status, 400);
  assert.equal((await call('/api/auth/postavljanje', { method: 'POST', body: { korisnik: 'odvjetnik', lozinka: 'tajna-lozinka', apiKey: 'neispravan' } })).status, 400);

  const setup = await call('/api/auth/postavljanje', { method: 'POST', body: { korisnik: 'odvjetnik', lozinka: 'tajna-lozinka' } });
  assert.equal(setup.status, 201);
  assert.ok(setup.cookie.startsWith('praksa_sesija='));
  assert.equal((await call('/api/predmeti', { cookie: setup.cookie })).status, 200);

  // Drugo postavljanje nije moguće (ni zamjena API ključa bez prijave).
  assert.equal((await call('/api/auth/postavljanje', { method: 'POST', body: { korisnik: 'drugi', lozinka: 'druga-lozinka', apiKey: 'sk-ant-api03-' + 'x'.repeat(40) } })).status, 409);
  assert.equal((await call('/api/postavke', { cookie: setup.cookie })).data.imaKljuc, false);

  assert.equal((await call('/api/auth/prijava', { method: 'POST', body: { korisnik: 'odvjetnik', lozinka: 'kriva-lozinka' } })).status, 401);
  const login = await call('/api/auth/prijava', { method: 'POST', body: { korisnik: 'odvjetnik', lozinka: 'tajna-lozinka' } });
  assert.equal(login.status, 200);

  const s = await call('/api/postavke', { method: 'POST', cookie: login.cookie, body: { apiKey: 'sk-ant-api03-' + 'a'.repeat(40) + 'WXYZ', maxOdluka: 7 } });
  assert.deepEqual([s.data.imaKljuc, s.data.kljucZavrsava, s.data.maxOdluka], [true, 'WXYZ', 7]);
  assert.ok(!JSON.stringify(s.data).includes('aaaa'), 'ključ se ne vraća sučelju');

  // Izbor modela: zadani je Opus 5.5, popis nosi cijene iz cjenika, nepoznat model se odbija bez ikakve promjene.
  assert.equal(s.data.model, 'claude-opus-5-5');
  assert.ok(s.data.modeli.some((m) => m.id === 'claude-sonnet-5-5' && m.cijena?.ulaz > 0));
  const bad = await call('/api/postavke', { method: 'POST', cookie: login.cookie, body: { model: 'gpt-5', maxOdluka: 9 } });
  assert.equal(bad.status, 400);
  assert.equal((await call('/api/postavke', { cookie: login.cookie })).data.maxOdluka, 7, 'neuspjelo spremanje ništa ne mijenja');
  const m = await call('/api/postavke', { method: 'POST', cookie: login.cookie, body: { model: 'claude-sonnet-5-5' } });
  assert.equal(m.data.model, 'claude-sonnet-5-5');
  assert.equal((await call('/api/info', { cookie: login.cookie })).data.model, 'claude-sonnet-5-5');

  // Broj odluka u lokalnoj zbirci (kvadratić iznad tražilice); računaju se samo .txt/.md/.html.
  assert.equal((await call('/api/info', { cookie: login.cookie })).data.lokalnaZbirka, 0, 'mapa ne postoji');
  await fs.mkdir(path.join(tmp, 'corpus'), { recursive: true });
  await fs.writeFile(path.join(tmp, 'corpus', 'a.txt'), 'x');
  await fs.writeFile(path.join(tmp, 'corpus', 'b.html'), 'x');
  await fs.writeFile(path.join(tmp, 'corpus', 'c.pdf'), 'x');
  assert.equal((await call('/api/info', { cookie: login.cookie })).data.lokalnaZbirka, 2);
  assert.equal(JSON.parse(await fs.readFile(path.join(tmp, 'postavke.json'), 'utf8')).model, 'claude-sonnet-5-5', 'izbor se pamti');

  assert.equal((await call('/api/auth/lozinka', { method: 'POST', cookie: login.cookie, body: { stara: 'tajna-lozinka', nova: 'nova-lozinka-1' } })).status, 200);
  assert.equal((await call('/api/predmeti', { cookie: login.cookie })).status, 401, 'promjena lozinke odjavljuje');
  const again = await call('/api/auth/prijava', { method: 'POST', body: { korisnik: 'odvjetnik', lozinka: 'nova-lozinka-1' } });
  assert.equal(again.status, 200);
  await call('/api/auth/odjava', { method: 'POST', cookie: again.cookie });
  assert.equal((await call('/api/predmeti', { cookie: again.cookie })).status, 401);
});

// fetch ne dopušta postavljanje zaglavlja Host, pa ide preko node:http.
function rawStatus(p, method, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end(method === 'POST' ? '{}' : undefined);
  });
}

test('zahtjevi s tuđeg hosta ili podrijetla odbijeni', async () => {
  assert.equal(await rawStatus('/api/auth/stanje', 'GET', { Host: 'zlonamjerno.test' }), 403);
  assert.equal(await rawStatus('/api/auth/prijava', 'POST', { Host: `127.0.0.1:${port}`, Origin: 'http://zlonamjerno.test', 'Content-Type': 'application/json' }), 403);
  assert.equal(await rawStatus('/api/auth/stanje', 'GET', { Host: `localhost:${port}` }), 200);
});

test.after(async () => {
  server.close();
  await fs.rm(tmp, { recursive: true, force: true });
});
