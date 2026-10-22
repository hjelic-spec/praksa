// Web na poslužitelju (zatvorena beta): rad iza HTTPS proxyja, kvote, jedna pretraga u tijeku,
// nova lozinka od administratora i e-poštom. E-pošta ide u memoriju (PRAKSA_SMTP_URL=json),
// a Anthropic API je lažni poslužitelj koji ne odgovara dok ga test ne pusti.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'praksa-web-'));

// Lažni Anthropic API: zahtjeve drži otvorenima (pretraga ostaje "u tijeku").
const pending = [];
const fakeApi = http.createServer((req, res) => pending.push(res));
await new Promise((r) => fakeApi.listen(0, '127.0.0.1', r));

process.env.PRAKSA_DATA_DIR = tmp;
process.env.PRAKSA_BUNDLED_AUTH = path.join(tmp, 'nema.json');
process.env.PRAKSA_PRICING_REFRESH = '0';
process.env.ANTHROPIC_API_KEY = '';
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${fakeApi.address().port}`;
process.env.PRAKSA_PUBLIC_URL = 'https://praksa.test';
process.env.PRAKSA_TRUST_PROXY = '1';
process.env.PRAKSA_SMTP_URL = 'json';
process.env.PRAKSA_MAIL_FROM = 'praksa@praksa.test';
const { start } = await import('../src/server.js');
const { outbox } = await import('../src/mail.js');
const { server, port } = await start({ port: 0 });

// Zahtjev kakav stiže preko proxyja: Host bez porta, X-Forwarded-For s adresom korisnika.
function call(p, { method = 'GET', body, cookie, host = 'praksa.test', ip = '10.0.0.1', origin } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: '127.0.0.1', port, path: p, method,
      headers: {
        Host: host, 'X-Forwarded-For': ip,
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { /* nije JSON */ }
        resolve({ status: res.statusCode, setCookie: res.headers['set-cookie']?.[0] ?? '', cookie: res.headers['set-cookie']?.[0]?.split(';')[0], data: json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const login = (korisnik, lozinka, ip) => call('/api/auth/prijava', { method: 'POST', body: { korisnik, lozinka }, ip });

let admin;
let ana;
let anaId;

test('iza proxyja: domena bez porta, Secure kolačić, IP iz X-Forwarded-For', async () => {
  assert.equal((await call('/api/auth/stanje')).status, 200, 'javna domena bez porta je dopuštena');
  assert.equal((await call('/api/auth/stanje', { host: 'zlo.test' })).status, 403);
  assert.equal((await call('/api/auth/stanje')).data.resetLozinke, true);

  const setup = await call('/api/auth/postavljanje', { method: 'POST', body: { korisnik: 'admin@praksa.test', lozinka: 'admin-lozinka-1' } });
  assert.equal(setup.status, 201);
  assert.match(setup.setCookie, /; Secure/);
  admin = setup.cookie;

  // Pet krivih lozinki s jedne adrese zaključava samo tu adresu; podmetnuta adresa na početku ne pomaže.
  for (let i = 0; i < 5; i++) assert.equal((await login('admin@praksa.test', 'kriva-lozinka', '1.1.1.1')).status, 401);
  assert.equal((await login('admin@praksa.test', 'admin-lozinka-1', '1.1.1.1')).status, 429);
  assert.equal((await login('admin@praksa.test', 'admin-lozinka-1', '9.9.9.9, 1.1.1.1')).status, 429);
  assert.equal((await login('admin@praksa.test', 'admin-lozinka-1', '2.2.2.2')).status, 200);

  // POST iz preglednika s javne domene prolazi, s tuđe stranice ne.
  const body = { korisnik: 'admin@praksa.test', lozinka: 'admin-lozinka-1' };
  assert.equal((await call('/api/auth/prijava', { method: 'POST', body, ip: '4.4.4.4', origin: 'https://praksa.test' })).status, 200);
  assert.equal((await call('/api/auth/prijava', { method: 'POST', body, ip: '4.4.4.4', origin: 'https://zlo.test' })).status, 403);
});

test('registracija: obavijest administratoru e-poštom', async () => {
  outbox.length = 0;
  assert.equal((await call('/api/auth/registracija', { method: 'POST', body: { ime: 'Ana Anić', email: 'ana@primjer.hr', lozinka: 'ana-lozinka-1' } })).status, 201);
  await new Promise((r) => setTimeout(r, 50)); // slanje je asinkrono
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].to[0].address, 'admin@praksa.test');
  assert.match(outbox[0].text, /Ana Anić \(ana@primjer\.hr\)/);
  anaId = (await call('/api/admin/korisnici', { cookie: admin })).data.find((u) => u.email === 'ana@primjer.hr').id;
  await call(`/api/admin/korisnici/${anaId}`, { method: 'POST', cookie: admin, body: { akcija: 'odobri' } });
  ana = (await login('ana@primjer.hr', 'ana-lozinka-1')).cookie;
  assert.ok(ana);
});

test('kvota: zadana i vlastita, provjera prije pretrage, jedna pretraga u tijeku', async () => {
  await call('/api/postavke', { method: 'POST', cookie: admin, body: { apiKey: 'sk-ant-api03-' + 'a'.repeat(40), kvotaUSD: 1 } });
  // Ana je ovaj mjesec već potrošila $1.50 (pretraga u njezinu predmetu).
  const dir = path.join(tmp, 'predmeti', anaId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'p1.json'), JSON.stringify({
    id: 'p1', naziv: 'Probni', pretrage: [{ id: 'x', datum: new Date().toISOString(), opis: 'o', rezultat: { trosak: { usd: 1.5 } } }], odluke: {},
  }));
  assert.deepEqual((await call('/api/info', { cookie: ana })).data.kvota, { limitUSD: 1, potrosenoUSD: 1.5 });
  const blocked = await call('/api/upit', { method: 'POST', cookie: ana, body: { opis: 'putnik ozlijeđen u autobusu' } });
  assert.equal(blocked.status, 429);
  assert.match(blocked.data.greska, /kvota je potrošena/);
  assert.equal((await call('/api/info', { cookie: admin })).data.kvota.limitUSD, null, 'administrator nema kvotu');

  // Vlastita kvota $5: pretraga kreće (i čeka lažni API), druga istodobna se odbija.
  assert.equal((await call(`/api/admin/korisnici/${anaId}/kvota`, { method: 'POST', cookie: admin, body: { kvotaUSD: 5 } })).data.kvotaUSD, 5);
  assert.equal((await call('/api/upit', { method: 'POST', cookie: ana, body: { opis: 'putnik ozlijeđen u autobusu' } })).status, 202);
  const second = await call('/api/upit', { method: 'POST', cookie: ana, body: { opis: 'druga pretraga istodobno' } });
  assert.equal(second.status, 429);
  assert.match(second.data.greska, /već u tijeku/);
  // Povratak na zadanu kvotu.
  assert.equal((await call(`/api/admin/korisnici/${anaId}/kvota`, { method: 'POST', cookie: admin, body: { kvotaUSD: null } })).data.kvotaUSD, null);
});

test('nova lozinka od administratora odjavljuje korisnika', async () => {
  const r = await call(`/api/admin/korisnici/${anaId}/lozinka`, { method: 'POST', cookie: admin });
  assert.equal(r.status, 200);
  assert.ok(r.data.lozinka.length >= 16);
  assert.equal((await call('/api/predmeti', { cookie: ana })).status, 401, 'stara sesija ne vrijedi');
  assert.equal((await login('ana@primjer.hr', 'ana-lozinka-1')).status, 401);
  ana = (await login('ana@primjer.hr', r.data.lozinka)).cookie;
  assert.ok(ana);
});

test('zaboravljena lozinka: poveznica e-poštom, jednokratna, bez otkrivanja računa', async () => {
  outbox.length = 0;
  const unknown = await call('/api/auth/zaboravljena', { method: 'POST', body: { email: 'nepoznat@primjer.hr' }, ip: '3.3.3.3' });
  const known = await call('/api/auth/zaboravljena', { method: 'POST', body: { email: 'ana@primjer.hr' }, ip: '3.3.3.3' });
  assert.deepEqual(unknown.data, known.data, 'isti odgovor za postojeći i nepostojeći račun');
  assert.equal(outbox.length, 1);
  const token = /#reset=([\w-]+)/.exec(outbox[0].text)[1];
  assert.match(outbox[0].text, /https:\/\/praksa\.test\/prijava\.html#reset=/);

  assert.equal((await call('/api/auth/nova-lozinka', { method: 'POST', body: { token, lozinka: 'nova-ana-lozinka' } })).status, 200);
  assert.equal((await login('ana@primjer.hr', 'nova-ana-lozinka')).status, 200);
  assert.equal((await call('/api/auth/nova-lozinka', { method: 'POST', body: { token, lozinka: 'jos-jedna-lozinka' } })).status, 400, 'poveznica vrijedi jednom');

  // Najviše 5 zahtjeva u 15 minuta s iste adrese.
  for (let i = 0; i < 3; i++) await call('/api/auth/zaboravljena', { method: 'POST', body: { email: 'x@y.hr' }, ip: '3.3.3.3' });
  assert.equal((await call('/api/auth/zaboravljena', { method: 'POST', body: { email: 'x@y.hr' }, ip: '3.3.3.3' })).status, 429);
});

test.after(async () => {
  // Pušta zahtjeve lažnom API-ju (greška bez ponavljanja), zatim zatvara poslužitelje.
  for (const res of pending) res.writeHead(400, { 'Content-Type': 'application/json' }).end('{"type":"error","error":{"type":"invalid_request_error","message":"test"}}');
  await new Promise((r) => setTimeout(r, 100));
  server.closeAllConnections();
  server.close();
  fakeApi.close();
  await fs.rm(tmp, { recursive: true, force: true });
});
