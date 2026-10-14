// Lokalno spremanje predmeta: svaki predmet je jedna JSON datoteka u data/predmeti/.
// Sprema se samo ono što je poslano modelu (anonimizirani opis i stajalište) i rezultati,
// te bilješke i odabir odluka za izvoz. Mapa je izuzeta iz gita (.gitignore).
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const dir = () => config.predmetiDir;
const fileOf = (id) => {
  if (!/^[\w-]{1,64}$/.test(id)) throw Object.assign(new Error('Neispravna oznaka predmeta'), { status: 400 });
  return path.join(dir(), `${id}.json`);
};

async function write(p) {
  await fs.mkdir(dir(), { recursive: true });
  const file = fileOf(p.id);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(p, null, 1));
  await fs.rename(tmp, file);
  return p;
}

// Upisi istog predmeta idu jedan za drugim (bilješke se spremaju dok pretraga još traje).
const queues = new Map();
function update(id, fn) {
  const run = (queues.get(id) ?? Promise.resolve()).then(async () => {
    const p = await getPredmet(id);
    await fn(p);
    p.izmijenjeno = new Date().toISOString();
    return write(p);
  });
  queues.set(id, run.catch(() => {}));
  return run;
}

// Zbroj procijenjenog troška svih pretraga predmeta (USD).
export function totalCost(p) {
  return Math.round(p.pretrage.reduce((s, x) => s + (x.rezultat?.trosak?.usd ?? 0), 0) * 10000) / 10000;
}

export async function listPredmeti() {
  const files = await fs.readdir(dir()).catch(() => []);
  const out = [];
  for (const f of files.filter((x) => x.endsWith('.json'))) {
    const p = JSON.parse(await fs.readFile(path.join(dir(), f), 'utf8'));
    out.push({ id: p.id, naziv: p.naziv, stvoreno: p.stvoreno, izmijenjeno: p.izmijenjeno, brojPretraga: p.pretrage.length, trosakUSD: totalCost(p) });
  }
  return out.sort((a, b) => (b.izmijenjeno ?? '').localeCompare(a.izmijenjeno ?? ''));
}

export async function createPredmet(naziv) {
  const now = new Date().toISOString();
  return write({ id: crypto.randomUUID().slice(0, 8), naziv, stvoreno: now, izmijenjeno: now, pretrage: [], odluke: {} });
}

export async function getPredmet(id) {
  const raw = await fs.readFile(fileOf(id), 'utf8').catch(() => null);
  if (!raw) throw Object.assign(new Error('Predmet nije pronađen'), { status: 404 });
  return JSON.parse(raw);
}

export function addPretraga(id, pretraga) {
  return update(id, (p) => { p.pretrage.unshift(pretraga); });
}

// Bilješka i odabir za izvoz vežu se uz odluku (URL) na razini predmeta, ne pojedine pretrage.
export function updateOdluka(id, url, { biljeska, odabrano }) {
  if (typeof url !== 'string' || !url) throw Object.assign(new Error('Nedostaje URL odluke'), { status: 400 });
  return update(id, (p) => {
    const o = (p.odluke[url] ??= { biljeska: '', odabrano: false });
    if (typeof biljeska === 'string') o.biljeska = biljeska.slice(0, 20_000);
    if (typeof odabrano === 'boolean') o.odabrano = odabrano;
  });
}

export function deletePretraga(id, pretragaId) {
  return update(id, (p) => { p.pretrage = p.pretrage.filter((x) => x.id !== pretragaId); });
}

// Najnovija analiza svake odabrane odluke (ista odluka može biti u više pretraga).
export function selectedDecisions(p) {
  const out = [];
  for (const [url, o] of Object.entries(p.odluke)) {
    if (!o.odabrano) continue;
    for (const s of p.pretrage) {
      const d = s.rezultat?.odluke?.find((x) => x.url === url);
      if (d) { out.push({ ...d, biljeska: o.biljeska, pretraga: s }); break; }
    }
  }
  return out;
}
