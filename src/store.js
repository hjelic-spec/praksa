// Lokalno spremanje predmeta: svaki korisnik ima svoju mapu data/predmeti/<id korisnika>/,
// a svaki predmet je jedna JSON datoteka (pretrage, rezultati, bilješke, spremljene odluke).
// Mapa je izuzeta iz gita (.gitignore).
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const ID_RE = /^[\w-]{1,64}$/;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

export const DEFAULT_NAZIV = 'Spremljene odluke';

// Zbroj procijenjenog troška pretraga predmeta (USD), po želji samo od određenog datuma.
export function totalCost(p, since = '') {
  return Math.round(p.pretrage.filter((x) => x.datum >= since).reduce((s, x) => s + (x.rezultat?.trosak?.usd ?? 0), 0) * 10000) / 10000;
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

// Upisi istog predmeta idu jedan za drugim (bilješke se spremaju dok pretraga još traje).
const queues = new Map();
const defaults = new Map();

/** Spremište predmeta jednog korisnika. */
export function forUser(userId) {
  if (!ID_RE.test(userId ?? '')) throw bad('Neispravan korisnik');
  const dir = path.join(config.predmetiDir, userId);
  const fileOf = (id) => {
    if (!ID_RE.test(id ?? '')) throw bad('Neispravna oznaka predmeta');
    return path.join(dir, `${id}.json`);
  };

  async function write(p) {
    await fs.mkdir(dir, { recursive: true });
    const file = fileOf(p.id);
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(p, null, 1));
    await fs.rename(tmp, file);
    return p;
  }

  async function readAll() {
    const files = await fs.readdir(dir).catch(() => []);
    const out = [];
    for (const f of files.filter((x) => x.endsWith('.json'))) out.push(JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')));
    return out;
  }

  async function getPredmet(id) {
    const raw = await fs.readFile(fileOf(id), 'utf8').catch(() => null);
    if (!raw) throw bad('Predmet nije pronađen', 404);
    return JSON.parse(raw);
  }

  function update(id, fn) {
    const key = `${userId}/${id}`;
    const run = (queues.get(key) ?? Promise.resolve()).then(async () => {
      const p = await getPredmet(id);
      await fn(p);
      p.izmijenjeno = new Date().toISOString();
      return write(p);
    });
    queues.set(key, run.catch(() => {}));
    return run;
  }

  async function createPredmet(naziv, extra = {}) {
    const now = new Date().toISOString();
    return write({ id: crypto.randomUUID().slice(0, 8), naziv, stvoreno: now, izmijenjeno: now, pretrage: [], odluke: {}, ...extra });
  }

  return {
    getPredmet,
    createPredmet: (naziv) => createPredmet(naziv),

    async listPredmeti() {
      return (await readAll()).map((p) => ({
        id: p.id, naziv: p.naziv, zadani: Boolean(p.zadani), stvoreno: p.stvoreno, izmijenjeno: p.izmijenjeno,
        brojPretraga: p.pretrage.length, brojSpremljenih: Object.values(p.odluke).filter((o) => o.odabrano).length, trosakUSD: totalCost(p),
      })).sort((a, b) => (b.izmijenjeno ?? '').localeCompare(a.izmijenjeno ?? ''));
    },

    // Zadani predmet za pretrage i spremljene odluke kad korisnik nije odabrao drugi.
    ensureDefaultPredmet() {
      if (!defaults.has(userId)) {
        defaults.set(userId, (async () => (await readAll()).find((p) => p.zadani) ?? createPredmet(DEFAULT_NAZIV, { zadani: true }))()
          .finally(() => defaults.delete(userId)));
      }
      return defaults.get(userId);
    },

    addPretraga: (id, pretraga) => update(id, (p) => { p.pretrage.unshift(pretraga); }),

    // Bilješka i odabir za izvoz vežu se uz odluku (URL) na razini predmeta, ne pojedine pretrage.
    updateOdluka(id, url, { biljeska, odabrano }) {
      if (typeof url !== 'string' || !url) throw bad('Nedostaje URL odluke');
      return update(id, (p) => {
        const o = (p.odluke[url] ??= { biljeska: '', odabrano: false });
        if (typeof biljeska === 'string') o.biljeska = biljeska.slice(0, 20_000);
        if (typeof odabrano === 'boolean') o.odabrano = odabrano;
      });
    },

    deletePretraga: (id, pretragaId) => update(id, (p) => { p.pretrage = p.pretrage.filter((x) => x.id !== pretragaId); }),

    // Potrošnja korisnika od datuma (za administraciju): broj pretraga i trošak.
    async usage(since = '') {
      const all = await readAll();
      return {
        pretrage: all.reduce((n, p) => n + p.pretrage.filter((x) => x.datum >= since).length, 0),
        usd: Math.round(all.reduce((s, p) => s + totalCost(p, since), 0) * 10000) / 10000,
      };
    },

    async removeAll() {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

// Predmeti iz verzije s jednim korisnikom (izravno u data/predmeti) prelaze administratoru.
export async function migrateLegacy(adminId) {
  const files = await fs.readdir(config.predmetiDir, { withFileTypes: true }).catch(() => []);
  const legacy = files.filter((f) => f.isFile() && f.name.endsWith('.json'));
  if (!legacy.length) return 0;
  const target = path.join(config.predmetiDir, adminId);
  await fs.mkdir(target, { recursive: true });
  for (const f of legacy) await fs.rename(path.join(config.predmetiDir, f.name), path.join(target, f.name));
  return legacy.length;
}
