// Lokalni web poslužitelj: statičko sučelje + jednostavan API s poslovima (job) koje sučelje prati.
// Po zadanom sluša samo na 127.0.0.1 jer svaki upit troši Claude API (nema autentikacije).
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { runQuery } from './pipeline.js';
import { supportedFilters } from './sources/odluke.js';

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
    if (data.length > 100_000) throw new Error('Zahtjev je prevelik');
  }
  return JSON.parse(data || '{}');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/api/info') {
      return send(res, 200, {
        izvori: config.sources,
        filteri: supportedFilters(),
        model: config.model,
        maxOdluka: config.maxDecisions,
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/upit') {
      const { opis, filters } = await readBody(req);
      if (typeof opis !== 'string' || opis.trim().length < 10) return send(res, 400, { greska: 'Opis mora imati barem 10 znakova.' });
      const id = crypto.randomUUID();
      const job = { status: 'u tijeku', napredak: [], rezultat: null, greska: null };
      jobs.set(id, job);
      runQuery({ opis: opis.trim(), filters }, (p) => job.napredak.push(p))
        .then((r) => { job.rezultat = r; job.status = 'gotovo'; })
        .catch((e) => { job.greska = e.message; job.status = 'greška'; });
      return send(res, 202, { id });
    }
    const m = url.pathname.match(/^\/api\/upit\/([\w-]+)$/);
    if (req.method === 'GET' && m) {
      const job = jobs.get(m[1]);
      return job ? send(res, 200, job) : send(res, 404, { greska: 'Nepoznat upit' });
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
    send(res, 500, { greska: e.message });
  }
});

const host = process.env.HOST ?? '127.0.0.1';
server.listen(config.port, host, () => {
  console.log(`Preglednik sudske prakse: http://${host}:${config.port}`);
});
