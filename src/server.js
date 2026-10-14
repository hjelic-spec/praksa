// Lokalni web poslužitelj: statičko sučelje + API s poslovima (job) koje sučelje prati.
// Sluša samo na 127.0.0.1 i traži prijavu (korisničko ime i lozinka): spremljeni predmeti
// sadrže podatke o predmetima ureda, a svaki upit troši Claude API.
// Pokreće se samostalno (`npm start`) ili iz Windows aplikacije (electron/main.js) preko start().
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { runQuery } from './pipeline.js';
import { supportedFilters } from './sources/odluke.js';
import { anonymize } from './anonymize.js';
import * as store from './store.js';
import * as auth from './auth.js';
import { loadSettings, saveSettings, publicSettings } from './settings.js';
import { buildDocx } from './export.js';
import { startPricingUpdates, pricingInfo, refreshPricing } from './pricing.js';

const jobs = new Map();
const PUBLIC = path.join(config.root, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
// Datoteke dostupne bez prijave (stranica za prijavu).
const OPEN_FILES = new Set(['prijava.html', 'prijava.js', 'style.css']);

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 100_000) throw Object.assign(new Error('Zahtjev je prevelik'), { status: 413 });
  }
  return JSON.parse(data || '{}');
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Rute bez prijave: stanje, prvo postavljanje i prijava.
const publicRoutes = [
  ['GET', /^\/api\/auth\/stanje$/, async (req) => [200, {
    postoji: await auth.hasUser(),
    prijavljen: Boolean(auth.getSession(auth.tokenFromCookie(req.headers.cookie))),
  }]],

  ['POST', /^\/api\/auth\/postavljanje$/, async (req) => {
    const b = await readBody(req);
    // Postavljanje je moguće samo dok korisnik ne postoji (inače bi netko mogao zamijeniti API ključ).
    if (await auth.hasUser()) return [409, { greska: 'Korisnik je već postavljen.' }];
    auth.validate(b.korisnik, b.lozinka);
    if (b.apiKey) saveSettings({ apiKey: b.apiKey });
    await auth.createUser(b.korisnik, b.lozinka);
    const token = auth.createSession(b.korisnik);
    return [201, { ok: true }, { 'Set-Cookie': auth.sessionCookie(token) }];
  }],

  ['POST', /^\/api\/auth\/prijava$/, async (req) => {
    const b = await readBody(req);
    const korisnik = await auth.verify(b.korisnik, b.lozinka);
    return [200, { ok: true }, { 'Set-Cookie': auth.sessionCookie(auth.createSession(korisnik)) }];
  }],
];

const routes = [
  ['POST', /^\/api\/auth\/odjava$/, async (req) => {
    auth.destroySession(auth.tokenFromCookie(req.headers.cookie));
    return [200, { ok: true }, { 'Set-Cookie': auth.clearCookie }];
  }],

  ['POST', /^\/api\/auth\/lozinka$/, async (req) => {
    const b = await readBody(req);
    await auth.changePassword(b.stara, b.nova);
    return [200, { ok: true }, { 'Set-Cookie': auth.clearCookie }];
  }],

  ['GET', /^\/api\/postavke$/, async () => [200, publicSettings()]],
  ['POST', /^\/api\/postavke$/, async (req) => [200, saveSettings(await readBody(req))]],

  ['GET', /^\/api\/cjenik$/, async () => [200, pricingInfo()]],
  ['POST', /^\/api\/cjenik\/osvjezi$/, async () => [200, await refreshPricing()]],

  ['GET', /^\/api\/info$/, async (req, m, res, session) => [200, {
    izvori: config.sources,
    filteri: supportedFilters(),
    model: config.model,
    maxOdluka: config.maxDecisions,
    korisnik: session.korisnik,
    imaKljuc: publicSettings().imaKljuc,
  }]],

  // Anonimizacija se radi lokalno; ništa se ne šalje van.
  ['POST', /^\/api\/anonimizacija$/, async (req) => {
    const b = await readBody(req);
    const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
    return [200, anonymize(
      { opis: str(b.opis, 20_000), stajaliste: str(b.stajaliste, 5_000) },
      { dodatni: arr(b.dodatni), iskljuceno: arr(b.iskljuceno), ukljuceno: arr(b.ukljuceno) },
    )];
  }],

  ['POST', /^\/api\/upit$/, async (req) => {
    const b = await readBody(req);
    const opis = str(b.opis, 20_000);
    const stajaliste = str(b.stajaliste, 5_000);
    if (opis.length < 10) return [400, { greska: 'Opis mora imati barem 10 znakova.' }];
    if (!publicSettings().imaKljuc) return [400, { greska: 'API ključ nije postavljen. Upišite ga u Postavkama.' }];
    const predmetId = b.predmetId ? (await store.getPredmet(b.predmetId)).id : null;
    const id = crypto.randomUUID();
    const job = { status: 'u tijeku', napredak: [], rezultat: null, greska: null, predmetId, pretragaId: null };
    jobs.set(id, job);
    runQuery({ opis, stajaliste, filters: b.filters }, (p) => job.napredak.push(p))
      .then(async (r) => {
        if (predmetId) {
          const pretraga = { id: crypto.randomUUID().slice(0, 8), datum: new Date().toISOString(), opis, stajaliste, filters: b.filters ?? {}, rezultat: r };
          await store.addPretraga(predmetId, pretraga);
          job.pretragaId = pretraga.id;
        }
        job.rezultat = r;
        job.status = 'gotovo';
      })
      .catch((e) => { job.greska = e.message; job.status = 'greška'; });
    return [202, { id }];
  }],

  ['GET', /^\/api\/upit\/([\w-]+)$/, async (req, [id]) => {
    const job = jobs.get(id);
    return job ? [200, job] : [404, { greska: 'Nepoznat upit' }];
  }],

  ['GET', /^\/api\/predmeti$/, async () => [200, await store.listPredmeti()]],

  ['POST', /^\/api\/predmeti$/, async (req) => {
    const naziv = str((await readBody(req)).naziv, 200);
    if (!naziv) return [400, { greska: 'Upišite naziv predmeta.' }];
    return [201, await store.createPredmet(naziv)];
  }],

  ['GET', /^\/api\/predmeti\/([\w-]+)$/, async (req, [id]) => {
    const p = await store.getPredmet(id);
    return [200, { ...p, trosakUSD: store.totalCost(p) }];
  }],

  ['POST', /^\/api\/predmeti\/([\w-]+)\/odluke$/, async (req, [id]) => {
    const { url, biljeska, odabrano } = await readBody(req);
    const p = await store.updateOdluka(id, url, { biljeska, odabrano });
    return [200, p.odluke[url]];
  }],

  ['DELETE', /^\/api\/predmeti\/([\w-]+)\/pretrage\/([\w-]+)$/, async (req, [id, pid]) => {
    await store.deletePretraga(id, pid);
    return [200, { ok: true }];
  }],

  ['GET', /^\/api\/predmeti\/([\w-]+)\/izvoz$/, async (req, [id], res) => {
    const p = await store.getPredmet(id);
    const decisions = store.selectedDecisions(p);
    if (!decisions.length) return [400, { greska: 'Nije odabrana nijedna odluka za izvoz.' }];
    const buf = await buildDocx(p, decisions);
    const name = `praksa-${p.naziv}`.replace(/[^\p{L}\d-]+/gu, '_').slice(0, 80);
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="praksa.docx"; filename*=UTF-8''${encodeURIComponent(name)}.docx`,
    });
    res.end(buf);
    return null;
  }],
];

async function dispatch(list, req, res, url, session) {
  for (const [method, re, handler] of list) {
    const m = url.pathname.match(re);
    if (!m || req.method !== method) continue;
    const out = await handler(req, m.slice(1), res, session);
    if (out) send(res, ...out);
    return true;
  }
  return false;
}

function handler(port) {
  // Samo zahtjevi upućeni ovom poslužitelju (zaštita od DNS rebindinga i tuđih stranica u pregledniku).
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (!allowedHosts.has(req.headers.host)) return send(res, 403, { greska: 'Nedopušten host' });
      if (req.method !== 'GET' && req.headers.origin && !allowedHosts.has(req.headers.origin.replace(/^https?:\/\//, ''))) {
        return send(res, 403, { greska: 'Nedopušteno podrijetlo zahtjeva' });
      }
      if (await dispatch(publicRoutes, req, res, url)) return;

      const session = auth.getSession(auth.tokenFromCookie(req.headers.cookie));
      if (url.pathname.startsWith('/api/')) {
        if (!session) return send(res, 401, { greska: 'Potrebna je prijava.' });
        if (await dispatch(routes, req, res, url, session)) return;
        return send(res, 404, { greska: 'Nepoznata ruta' });
      }

      if (req.method === 'GET') {
        const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        if (!session && !OPEN_FILES.has(rel)) {
          res.writeHead(302, { Location: '/prijava.html' });
          return res.end();
        }
        const file = path.resolve(PUBLIC, rel);
        if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, { greska: 'Zabranjeno' });
        const content = await fs.readFile(file).catch(() => null);
        if (!content) return send(res, 404, { greska: 'Nije pronađeno' });
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
        return res.end(content);
      }
      send(res, 405, { greska: 'Metoda nije podržana' });
    } catch (e) {
      send(res, e.status ?? 500, { greska: e.message });
    }
  };
}

// port 0 = slobodan port koji odabere sustav (Windows aplikacija).
export function start({ port = config.port, host = '127.0.0.1' } = {}) {
  loadSettings();
  startPricingUpdates();
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(port, host, () => {
      const actual = server.address().port;
      server.on('request', handler(actual));
      resolve({ server, port: actual });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { port } = await start();
  console.log(`Preglednik sudske prakse: http://127.0.0.1:${port}`);
}
