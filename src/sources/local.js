// Izvor: lokalna zbirka odluka u data/corpus (.txt, .md, .html).
// Korisno za rad bez mreže, za odluke preuzete ručno (npr. s portala Vrhovnog suda)
// i za testiranje. Pretraživanje je jednostavno: bodovanje po pojavljivanju
// korijena riječi (prvih 5 znakova, grubo za hrvatsku fleksiju).
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { decisionTextFromHtml, metadataFromText } from './odluke.js';
import { normalizeWs } from '../extract.js';

const STOP = new Set(['koji', 'koja', 'koje', 'kojeg', 'zbog', 'nakon', 'prije', 'izmeđ', 'protiv', 'prema', 'tijekom', 'odnosno', 'sudsk', 'odluk']);

export function stems(query) {
  return [...new Set(query.toLowerCase().split(/[^\p{L}\d]+/u).filter((w) => w.length >= 4).map((w) => w.slice(0, 5)).filter((s) => !STOP.has(s)))];
}

async function loadCorpus() {
  let files = [];
  try {
    files = await fs.readdir(config.corpusDir);
  } catch {
    return [];
  }
  const docs = [];
  for (const f of files.filter((x) => /\.(txt|md|html?)$/i.test(x))) {
    const raw = await fs.readFile(path.join(config.corpusDir, f), 'utf8');
    const tekst = /\.html?$/i.test(f) ? decisionTextFromHtml(raw) : raw;
    docs.push({ url: `local:${f}`, naslov: f, tekst, izvor: 'lokalna zbirka' });
  }
  return docs;
}

export async function search(query, { limit = 20 } = {}) {
  const s = stems(query);
  if (!s.length) return [];
  const docs = await loadCorpus();
  return docs
    .map((d) => {
      const low = d.tekst.toLowerCase();
      const hits = s.filter((x) => low.includes(x)).length;
      return { d, score: hits / s.length };
    })
    .filter((x) => x.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ d }) => ({ url: d.url, naslov: d.naslov, isjecak: normalizeWs(d.tekst).slice(0, 400), izvor: d.izvor }));
}

export async function fetchDecision(ref) {
  const f = ref.url.replace(/^local:/, '');
  if (f.includes('/') || f.includes('\\')) throw new Error('Neispravan naziv datoteke');
  const raw = await fs.readFile(path.join(config.corpusDir, f), 'utf8');
  const tekst = /\.html?$/i.test(f) ? decisionTextFromHtml(raw) : raw;
  return { ...ref, tekst, meta: metadataFromText(tekst) };
}
