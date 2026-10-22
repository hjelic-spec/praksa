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

const isCorpusFile = (x) => /\.(txt|md|html?)$/i.test(x);

// Broj odluka u zbirci (za kvadratić u sučelju); 0 ako mapa ne postoji.
export async function count() {
  try {
    return (await fs.readdir(config.corpusDir)).filter(isCorpusFile).length;
  } catch {
    return 0;
  }
}

// Raščlanjene odluke u memoriji: datoteka se ponovno čita samo kad joj se promijene vrijeme
// izmjene ili veličina. Pretraga zove loadCorpus za svaki upit (5–8 po pretrazi).
const parsed = new Map(); // naziv datoteke -> { mtimeMs, size, doc }

async function readDoc(f) {
  const file = path.join(config.corpusDir, f);
  const st = await fs.stat(file);
  const hit = parsed.get(f);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.doc;
  const raw = await fs.readFile(file, 'utf8');
  const tekst = /\.html?$/i.test(f) ? decisionTextFromHtml(raw) : raw;
  const doc = { url: `local:${f}`, naslov: f, tekst, low: tekst.toLowerCase(), izvor: 'lokalna zbirka' };
  parsed.set(f, { mtimeMs: st.mtimeMs, size: st.size, doc });
  return doc;
}

async function loadCorpus() {
  let files = [];
  try {
    files = (await fs.readdir(config.corpusDir)).filter(isCorpusFile);
  } catch {
    return [];
  }
  for (const f of parsed.keys()) if (!files.includes(f)) parsed.delete(f); // obrisane datoteke
  return Promise.all(files.map(readDoc));
}

export async function search(query, { limit = 20 } = {}) {
  const s = stems(query);
  if (!s.length) return [];
  const docs = await loadCorpus();
  return docs
    .map((d) => {
      const hits = s.filter((x) => d.low.includes(x)).length;
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
  const { tekst } = await readDoc(f);
  return { ...ref, tekst, meta: metadataFromText(tekst) };
}
