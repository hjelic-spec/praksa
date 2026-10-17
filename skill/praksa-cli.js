// Naredbe koje skill "sudska-praksa" poziva iz Claudea. Rade samo ono što se može
// odraditi bez jezičnog modela: pretraživanje i dohvat odluka, regex ekstrakciju
// referenci, provjeru citata i povezivanje predmeta. Analizu odluka radi Claude.
//
// Izvor je ovdje (koristi module iz ../src); `npm run skill:build` ga pakira u
// skill/sudska-praksa/scripts/praksa.mjs, koji ne treba npm install.
//
// Izlaz je JSON na stdout; poruke o napretku idu na stderr.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as odluke from '../src/sources/odluke.js';
import { canonicalDecisionUrl, decisionTextFromHtml, metadataFromText } from '../src/sources/odluke.js';
import { caseKey, extractCaseNumbers, extractEuReferences, quoteInText } from '../src/extract.js';
import { linkRelated, uniqueByCaseKey } from '../src/related.js';
import { verifyAll } from '../src/eu.js';

const HELP = `Upotreba: node praksa.mjs <naredba> [argumenti]

  pretrazi <upit>... [--limit N]       pretraži odluke.sudovi.hr; više upita odjednom
  dohvati <url|datoteka>... [--dir D]   spremi tekst odluka u D/odluke/*.txt i reference u *.json
  citat <datoteka.txt> <citat>          je li citat doslovno u tekstu odluke
  povezi [--dir D]                      poveži dohvaćene odluke koje se citiraju ili citiraju iste predmete

Zadana radna mapa (--dir) je ./praksa-rad.`;

function parseArgs(argv) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) opts[argv[i].slice(2)] = argv[++i];
    else pos.push(argv[i]);
  }
  return { pos, opts };
}

// "fetch failed" sam ne kaže ništa; pravi razlog (DNS, odbijena veza, istek) je u e.cause.
function errMsg(e) {
  const c = e.cause;
  return c ? `${e.message} (${c.code ?? c.message})` : e.message;
}

function print(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

function slugFor(ref) {
  try {
    const id = new URL(ref).searchParams.get('id');
    if (id && /^[\w-]+$/.test(id)) return id;
  } catch { /* nije URL */ }
  const base = path.basename(ref).replace(/\.[^.]+$/, '').replace(/[^\p{L}\d_-]+/gu, '_').slice(0, 60);
  return `${base}-${crypto.createHash('sha1').update(ref).digest('hex').slice(0, 8)}`;
}

async function pretrazi(upiti, { limit = '15' }) {
  if (!upiti.length) throw new Error('Navedite barem jedan upit.');
  const refs = new Map();
  const upozorenja = [];
  for (const q of upiti) {
    process.stderr.write(`Pretražujem: ${q}\n`);
    try {
      for (const r of await odluke.search(q, { limit: Number(limit) })) {
        if (!refs.has(r.url)) refs.set(r.url, { url: r.url, naslov: r.naslov, isjecak: r.isjecak, upiti: [q] });
        else refs.get(r.url).upiti.push(q);
      }
    } catch (e) {
      upozorenja.push(`Upit "${q}": ${errMsg(e)}`);
    }
  }
  // Prednost odlukama koje je pronašlo više upita
  const rezultati = [...refs.values()].sort((a, b) => b.upiti.length - a.upiti.length);
  print({ rezultati, upozorenja });
}

async function readDecision(ref) {
  if (/^https?:\/\//i.test(ref)) {
    const url = canonicalDecisionUrl(ref);
    const d = await odluke.fetchDecision({ url, naslov: url, izvor: 'odluke.sudovi.hr' });
    return { url, izvor: d.izvor, tekst: d.tekst, meta: d.meta };
  }
  const raw = await fs.readFile(ref, 'utf8');
  const tekst = /\.html?$/i.test(ref) ? decisionTextFromHtml(raw) : raw;
  return { url: `datoteka:${path.resolve(ref)}`, izvor: 'lokalna datoteka', tekst, meta: metadataFromText(tekst) };
}

async function dohvati(refs, { dir = 'praksa-rad' }) {
  if (!refs.length) throw new Error('Navedite barem jedan URL ili datoteku.');
  const outDir = path.join(dir, 'odluke');
  await fs.mkdir(outDir, { recursive: true });
  const odlukeOut = [];
  const upozorenja = [];
  for (const ref of refs) {
    process.stderr.write(`Dohvaćam: ${ref}\n`);
    try {
      const d = await readDecision(ref);
      if (!d.tekst || d.tekst.length < 200) throw new Error('tekst odluke nije pronađen');
      const slug = slugFor(ref);
      const own = d.meta?.poslovniBroj ? caseKey(d.meta.poslovniBroj) : null;
      const { eu, ekljp } = extractEuReferences(d.tekst);
      const zapis = {
        url: d.url,
        izvor: d.izvor,
        naslov: d.meta?.poslovniBroj ?? slug,
        datoteka: path.join(outDir, `${slug}.txt`),
        znakova: d.tekst.length,
        meta: d.meta,
        citiraniPredmeti: uniqueByCaseKey(extractCaseNumbers(d.tekst)).filter((c) => caseKey(c) !== own),
        euReference: await verifyAll(eu),
        ekljp,
      };
      await fs.writeFile(zapis.datoteka, d.tekst);
      await fs.writeFile(path.join(outDir, `${slug}.json`), JSON.stringify(zapis, null, 2));
      odlukeOut.push(zapis);
    } catch (e) {
      upozorenja.push(`${ref}: ${errMsg(e)}`);
    }
  }
  print({ odluke: odlukeOut, upozorenja });
}

async function citat([file, ...rest]) {
  const quote = rest.join(' ');
  if (!file || !quote) throw new Error('Upotreba: citat <datoteka.txt> <citat>');
  const tekst = await fs.readFile(file, 'utf8');
  print({ provjeren: quoteInText(quote, tekst) });
}

async function povezi({ dir = 'praksa-rad' }) {
  const outDir = path.join(dir, 'odluke');
  const files = (await fs.readdir(outDir)).filter((f) => f.endsWith('.json'));
  const items = await Promise.all(files.map(async (f) => JSON.parse(await fs.readFile(path.join(outDir, f), 'utf8'))));
  linkRelated(items);
  print(items.map((d) => ({ oznaka: d.naslov, url: d.url, povezani: d.povezaniURezultatima })));
}

export async function main(argv = process.argv.slice(2)) {
  // Uz zapakiranu skriptu stoji kopija odluke.config.json; predmemorija ide u korisnikovu mapu.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const bundledCfg = path.join(here, 'odluke.config.json');
  if (!process.env.PRAKSA_ODLUKE_CONFIG && existsSync(bundledCfg)) process.env.PRAKSA_ODLUKE_CONFIG = bundledCfg;
  process.env.PRAKSA_CACHE_DIR ??= path.join(os.homedir(), '.cache', 'praksa-skill');

  const [cmd, ...rest] = argv;
  const { pos, opts } = parseArgs(rest);
  try {
    if (cmd === 'pretrazi') await pretrazi(pos, opts);
    else if (cmd === 'dohvati') await dohvati(pos, opts);
    else if (cmd === 'citat') await citat(pos);
    else if (cmd === 'povezi') await povezi(opts);
    else {
      process.stdout.write(HELP + '\n');
      if (cmd && cmd !== '--help' && cmd !== 'pomoc') process.exitCode = 2;
    }
  } catch (e) {
    process.stderr.write(`Greška: ${errMsg(e)}\n`);
    process.exitCode = 1;
  }
}

await main();
