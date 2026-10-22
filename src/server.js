// Web poslužitelj: statičko sučelje + API s poslovima (job) koje sučelje prati.
// Traži prijavu; korisnici se registriraju i čekaju odobrenje administratora, a svaki ima
// svoje predmete. Po zadanom sluša samo na 127.0.0.1; PRAKSA_HOST=0.0.0.0 otvara pristup
// s drugih računala u uredskoj mreži (`npm run web`).
// Pokreće se samostalno (`npm start`) ili iz Windows aplikacije (electron/main.js) preko start().
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { runQuery, DEFAULT_OPCIJE } from './pipeline.js';
import * as localSource from './sources/local.js';
import { supportedFilters } from './sources/odluke.js';
import * as store from './store.js';
import { totalCost, selectedDecisions } from './store.js';
import * as auth from './auth.js';
import { loadSettings, saveSettings, publicSettings } from './settings.js';
import { buildDocx } from './export.js';
import { startPricingUpdates, pricingInfo, refreshPricing } from './pricing.js';

const jobs = new Map();
const PUBLIC = path.join(config.root, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
// Datoteke dostupne bez prijave (stranica za prijavu i registraciju).
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
  try {
    return JSON.parse(data || '{}');
  } catch {
    throw Object.assign(new Error('Neispravan zahtjev (JSON).'), { status: 400 });
  }
}

// Završeni poslovi (s cijelim rezultatom) brišu se iz memorije nakon jednog sata;
// rezultat je tada već spremljen u povijest predmeta.
const JOB_TTL_MS = 3600 * 1000;
const expireJob = (id) => setTimeout(() => jobs.delete(id), JOB_TTL_MS).unref();

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Rute bez prijave: stanje, prvo postavljanje i prijava.
const publicRoutes = [
  ['GET', /^\/api\/auth\/stanje$/, async (req) => [200, {
    postoji: auth.hasUser(),
    prijavljen: Boolean(auth.getSession(auth.tokenFromCookie(req.headers.cookie))),
  }]],

  // Prvo pokretanje: postavlja se administrator (samo dok nema nijednog korisnika).
  ['POST', /^\/api\/auth\/postavljanje$/, async (req) => {
    const b = await readBody(req);
    if (auth.hasUser()) return [409, { greska: 'Korisnik je već postavljen.' }];
    auth.validate(b.korisnik, b.lozinka);
    if (b.apiKey) saveSettings({ apiKey: b.apiKey });
    const u = await auth.createAdmin(b.korisnik, b.lozinka);
    await store.migrateLegacy(u.id);
    return [201, { ok: true }, { 'Set-Cookie': auth.sessionCookie(auth.createSession(u.id)) }];
  }],

  // Registracija: račun čeka odobrenje administratora.
  ['POST', /^\/api\/auth\/registracija$/, async (req) => {
    const b = await readBody(req);
    await auth.register({ email: b.email, ime: b.ime, lozinka: b.lozinka });
    return [201, { ok: true, poruka: 'Zahtjev je poslan. Moći ćete se prijaviti kad ga administrator odobri.' }];
  }],

  ['POST', /^\/api\/auth\/prijava$/, async (req) => {
    const b = await readBody(req);
    const u = await auth.verify(b.korisnik, b.lozinka, req.socket.remoteAddress);
    return [200, { ok: true }, { 'Set-Cookie': auth.sessionCookie(auth.createSession(u.id)) }];
  }],
];

const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString(); };

const routes = [
  ['POST', /^\/api\/auth\/odjava$/, async (req) => {
    auth.destroySession(auth.tokenFromCookie(req.headers.cookie));
    return [200, { ok: true }, { 'Set-Cookie': auth.clearCookie }];
  }],

  ['POST', /^\/api\/auth\/lozinka$/, async (req, m, res, { user }) => {
    const b = await readBody(req);
    await auth.changePassword(user.id, b.stara, b.nova);
    return [200, { ok: true }, { 'Set-Cookie': auth.clearCookie }];
  }],

  // Postavke (API ključ, broj odluka, kontakt) i cjenik mijenja samo administrator.
  ['GET', /^\/api\/postavke$/, async () => [200, publicSettings()], 'admin'],
  ['POST', /^\/api\/postavke$/, async (req) => [200, saveSettings(await readBody(req))], 'admin'],

  ['GET', /^\/api\/cjenik$/, async () => [200, pricingInfo()], 'admin'],
  ['POST', /^\/api\/cjenik\/osvjezi$/, async () => [200, await refreshPricing()], 'admin'],

  ['GET', /^\/api\/info$/, async (req, m, res, { user }) => [200, {
    izvori: config.sources,
    // Broj odluka u lokalnoj zbirci; null ako izvor "local" nije uključen (PRAKSA_SOURCES).
    lokalnaZbirka: config.sources.includes('local') ? await localSource.count() : null,
    // Stvarna mapa zbirke (u Windows aplikaciji je u korisnikovu profilu) – samo administratoru.
    lokalnaZbirkaMapa: user.uloga === 'admin' ? config.corpusDir : undefined,
    filteri: supportedFilters(),
    model: config.model,
    maxOdluka: config.maxDecisions,
    korisnik: user.email,
    ime: user.ime,
    uloga: user.uloga,
    imaKljuc: publicSettings().imaKljuc,
    naCekanju: user.uloga === 'admin' ? auth.listUsers().filter((u) => u.status === auth.STATUS.CEKA).length : undefined,
  }]],

  // Administracija korisnika: popis s potrošnjom u tekućem mjesecu i promjena stanja računa.
  ['GET', /^\/api\/admin\/korisnici$/, async () => {
    const since = monthStart();
    return [200, await Promise.all(auth.listUsers().map(async (u) => ({ ...u, ovajMjesec: await store.forUser(u.id).usage(since) })))];
  }, 'admin'],

  ['POST', /^\/api\/admin\/korisnici\/([\w-]+)$/, async (req, [id], res, { user }) => {
    const { akcija } = await readBody(req);
    const u = auth.setStatus(user.id, id, akcija);
    if (akcija === 'obrisi') await store.forUser(id).removeAll();
    return [200, auth.publicUser(u)];
  }, 'admin'],

  // Pretraga: opis, neobavezni datumi i opcije (europsko pravo, lokalna zbirka). Sprema se u aktivni predmet ili u zadani
  // "Spremljene odluke", pa je povijest pretraga uvijek dostupna.
  ['POST', /^\/api\/upit$/, async (req, m, res, { user, store }) => {
    const b = await readBody(req);
    const opis = str(b.opis, 20_000);
    if (opis.length < 10) return [400, { greska: 'Upit mora imati barem 10 znakova.' }];
    if (!publicSettings().imaKljuc) return [400, { greska: user.uloga === 'admin' ? 'API ključ nije postavljen. Upišite ga u Postavkama.' : 'Pretraga trenutačno nije dostupna (administrator nije postavio API ključ).' }];
    const predmetId = b.predmetId ? (await store.getPredmet(b.predmetId)).id : (await store.ensureDefaultPredmet()).id;
    const filters = Object.fromEntries(Object.entries(b.filters ?? {}).filter(([, v]) => typeof v === 'string' && v));
    // Kvadratići iznad tražilice; što nije poslano kao true/false ostaje zadano.
    const opcije = Object.fromEntries(Object.keys(DEFAULT_OPCIJE).map((k) => [k, typeof b.opcije?.[k] === 'boolean' ? b.opcije[k] : DEFAULT_OPCIJE[k]]));
    const id = crypto.randomUUID();
    const job = { userId: user.id, status: 'u tijeku', napredak: [], rezultat: null, greska: null, predmetId, pretragaId: null };
    jobs.set(id, job);
    runQuery({ opis, filters, opcije }, (p) => job.napredak.push(p))
      .then(async (r) => {
        const pretraga = { id: crypto.randomUUID().slice(0, 8), datum: new Date().toISOString(), opis, filters, opcije, rezultat: r };
        await store.addPretraga(predmetId, pretraga);
        job.pretragaId = pretraga.id;
        job.rezultat = r;
        job.status = 'gotovo';
      })
      .catch((e) => { job.greska = e.message; job.status = 'greška'; })
      .finally(() => expireJob(id));
    return [202, { id }];
  }],

  ['GET', /^\/api\/upit\/([\w-]+)$/, async (req, [id], res, { user }) => {
    const job = jobs.get(id);
    if (!job || job.userId !== user.id) return [404, { greska: 'Nepoznat upit' }];
    const { userId, ...pub } = job;
    return [200, pub];
  }],

  ['GET', /^\/api\/predmeti$/, async (req, m, res, { store }) => [200, await store.listPredmeti()]],

  ['POST', /^\/api\/predmeti$/, async (req, m, res, { store }) => {
    const naziv = str((await readBody(req)).naziv, 200);
    if (!naziv) return [400, { greska: 'Upišite naziv predmeta.' }];
    return [201, await store.createPredmet(naziv)];
  }],

  ['GET', /^\/api\/predmeti\/([\w-]+)$/, async (req, [id], res, { store }) => {
    const p = await store.getPredmet(id);
    return [200, { ...p, trosakUSD: totalCost(p) }];
  }],

  ['POST', /^\/api\/predmeti\/([\w-]+)\/odluke$/, async (req, [id], res, { store }) => {
    const { url, biljeska, odabrano } = await readBody(req);
    const p = await store.updateOdluka(id, url, { biljeska, odabrano });
    return [200, p.odluke[url]];
  }],

  ['DELETE', /^\/api\/predmeti\/([\w-]+)\/pretrage\/([\w-]+)$/, async (req, [id, pid], res, { store }) => {
    await store.deletePretraga(id, pid);
    return [200, { ok: true }];
  }],

  ['GET', /^\/api\/predmeti\/([\w-]+)\/izvoz$/, async (req, [id], res, { store }) => {
    const p = await store.getPredmet(id);
    const decisions = selectedDecisions(p);
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

async function dispatch(list, req, res, url, ctx) {
  for (const [method, re, handler, role] of list) {
    const m = url.pathname.match(re);
    if (!m || req.method !== method) continue;
    if (role === 'admin' && ctx?.user.uloga !== 'admin') { send(res, 403, { greska: 'Samo za administratora.' }); return true; }
    const out = await handler(req, m.slice(1), res, ctx);
    if (out) send(res, ...out);
    return true;
  }
  return false;
}

// Nazivi pod kojima je poslužitelj dopušteno zvati (zaštita od DNS rebindinga i tuđih stranica u
// pregledniku): localhost, a u uredskoj mreži i IP adrese ovog računala, njegov naziv i PRAKSA_ALLOWED_HOSTS.
export function allowedHostsFor(port, host = config.host) {
  const names = ['127.0.0.1', 'localhost'];
  if (host !== '127.0.0.1' && host !== 'localhost') {
    for (const list of Object.values(os.networkInterfaces())) for (const a of list ?? []) if (a.family === 'IPv4') names.push(a.address);
    names.push(os.hostname(), `${os.hostname()}.local`);
  }
  const set = new Set(names.map((n) => `${n.toLowerCase()}:${port}`));
  for (const h of config.allowedHosts) set.add(h.includes(':') ? h : `${h}:${port}`);
  return set;
}

function handler(port, host) {
  // Popis se osvježava (najviše jednom u 30 s) kad stigne nepoznat host, jer računalo
  // može dobiti novu IP adresu (DHCP) dok poslužitelj radi.
  let allowedHosts = allowedHostsFor(port, host);
  let refreshedAt = Date.now();
  const isAllowed = (h) => {
    if (allowedHosts.has(h)) return true;
    if (Date.now() - refreshedAt < 30_000) return false;
    allowedHosts = allowedHostsFor(port, host);
    refreshedAt = Date.now();
    return allowedHosts.has(h);
  };
  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (!isAllowed(String(req.headers.host).toLowerCase())) return send(res, 403, { greska: 'Nedopušten host' });
      if (req.method !== 'GET' && req.headers.origin && !isAllowed(req.headers.origin.replace(/^https?:\/\//, '').toLowerCase())) {
        return send(res, 403, { greska: 'Nedopušteno podrijetlo zahtjeva' });
      }
      if (await dispatch(publicRoutes, req, res, url)) return;

      const session = auth.getSession(auth.tokenFromCookie(req.headers.cookie));
      if (url.pathname.startsWith('/api/')) {
        if (!session) return send(res, 401, { greska: 'Potrebna je prijava.' });
        const ctx = { user: session.user, store: store.forUser(session.user.id) };
        if (await dispatch(routes, req, res, url, ctx)) return;
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
export async function start({ port = config.port, host = config.host } = {}) {
  loadSettings();
  startPricingUpdates();
  auth.loadUsers();
  const a = auth.admin();
  if (a) await store.migrateLegacy(a.id);
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(port, host, () => {
      const actual = server.address().port;
      server.on('request', handler(actual, host));
      resolve({ server, port: actual });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { port } = await start();
  console.log(`Preglednik sudske prakse sluša na ${config.host}:${port}. Adrese:`);
  for (const a of allowedHostsFor(port)) if (!a.startsWith('localhost')) console.log(`  http://${a}`);
}
