// Lokalni web poslužitelj: statičko sučelje + jednostavan API s poslovima (job) koje sučelje prati.
// Po zadanom sluša samo na 127.0.0.1 jer svaki upit troši Claude API (nema autentikacije),
// a spremljeni predmeti sadrže podatke o predmetima ureda.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { runQuery } from './pipeline.js';
import { supportedFilters } from './sources/odluke.js';
import { anonymize } from './anonymize.js';
import * as store from './store.js';
import { buildDocx } from './export.js';

const jobs = new Map();
const PUBLIC = path.join(config.root, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
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

const routes = [
  ['GET', /^\/api\/info$/, async () => [200, {
    izvori: config.sources,
    filteri: supportedFilters(),
    model: config.model,
    maxOdluka: config.maxDecisions,
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

  ['GET', /^\/api\/predmeti\/([\w-]+)$/, async (req, [id]) => [200, await store.getPredmet(id)]],

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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    for (const [method, re, handler] of routes) {
      const m = url.pathname.match(re);
      if (!m || req.method !== method) continue;
      const out = await handler(req, m.slice(1), res);
      if (out) send(res, ...out);
      return;
    }
    if (req.method === 'GET') {
      const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const file = path.resolve(PUBLIC, rel);
      if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, { greska: 'Zabranjeno' });
      const content = await fs.readFile(file).catch(() => null);
      if (!content) return send(res, 404, { greska: 'Nije pronađeno' });
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
      return res.end(content);
    }
    send(res, 405, { greska: 'Metoda nije podržana' });
  } catch (e) {
    send(res, e.status ?? 500, { greska: e.message });
  }
});

const host = process.env.HOST ?? '127.0.0.1';
server.listen(config.port, host, () => {
  console.log(`Preglednik sudske prakse: http://${host}:${config.port}`);
});
