// Pakira skill/praksa-cli.js (s cheeriom i modulima iz src/) u jednu datoteku
// skill/sudska-praksa/scripts/praksa.mjs, kojoj treba samo Node.js 20.12+, te uz nju
// izrađuje THIRD_PARTY_LICENSES.txt s licencama svih zapakiranih biblioteka.
//   npm run skill:build
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const skillDir = path.join(root, 'skill', 'sudska-praksa');
export const outDir = path.join(skillDir, 'scripts');
export const outFile = path.join(outDir, 'praksa.mjs');
export const licensesFile = path.join(skillDir, 'THIRD_PARTY_LICENSES.txt');

export const buildOptions = {
  entryPoints: [path.join(root, 'skill', 'praksa-cli.js')],
  outfile: outFile,
  // Putanje u komentarima paketa su relativne na ovu mapu; fiksna je da bi izlaz bio isti odakle god se gradi.
  absWorkingDir: root,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Licence se ne ostavljaju razbacane po paketu, nego idu u THIRD_PARTY_LICENSES.txt.
  legalComments: 'none',
  // Koristi se samo cheerio.load. Glavni modul cheeria ga prosljeđuje iz load-parse.js, ali uz
  // njega uvozi i undici/iconv-lite za dohvat preko URL-a (~1,5 MB) koji ovdje ne treba.
  alias: { cheerio: path.join(root, 'node_modules', 'cheerio', 'dist', 'esm', 'load-parse.js') },
  banner: { js: '// GENERIRANO: npm run skill:build (izvor: skill/praksa-cli.js). Ne uređivati ručno.' },
  metafile: true,
  logLevel: 'warning',
};

// Standardni tekst licence ISC, za pakete koji je navode u package.json, a nemaju datoteku licence.
const ISC_TEXT = `Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`;

const LICENSE_FILE = /^(licen[cs]e|copying)(\.(md|txt))?$/i;

/** Tekst THIRD_PARTY_LICENSES.txt za pakete koji su ušli u paket (iz esbuild metafilea). */
export async function thirdPartyLicenses(metafile) {
  // Mapa paketa kojem datoteka pripada (zadnji node_modules u putanji). Isti paket može biti
  // zapakiran u više verzija (npr. entities ugniježđen pod htmlparser2 i parse5), pa se čita svaka mapa.
  const dirs = new Set();
  for (const input of Object.keys(metafile.inputs)) {
    const m = input.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
    if (m) dirs.add(m[1]);
  }
  const pkgs = new Map(); // name@version -> { dir, pkg }
  for (const rel of dirs) {
    const dir = path.join(root, rel);
    const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
    pkgs.set(`${pkg.name}@${pkg.version}`, { dir, pkg });
  }
  const parts = [];
  for (const [id, { dir, pkg }] of [...pkgs].sort(([a], [b]) => a.localeCompare(b))) {
    const name = pkg.name;
    const file = (await fs.readdir(dir)).find((f) => LICENSE_FILE.test(f));
    let text;
    if (file) {
      text = (await fs.readFile(path.join(dir, file), 'utf8')).trim();
    } else if (pkg.license === 'ISC') {
      const author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name ?? '';
      text = `(Paket nema datoteku licence; package.json navodi licencu ISC i autora "${author}".)\n\nISC License\n\nCopyright (c) ${author}\n\n${ISC_TEXT}`;
    } else {
      throw new Error(`Paket ${name} nema datoteku licence – dodajte je ručno prije dijeljenja skilla.`);
    }
    parts.push(`${'='.repeat(78)}\n${id} (${pkg.license})\n${'='.repeat(78)}\n\n${text}\n`);
  }
  return `Skill "sudska-praksa": licence biblioteka zapakiranih u scripts/praksa.mjs
GENERIRANO: npm run skill:build. Ne uređivati ručno.

${parts.join('\n')}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { metafile } = await build(buildOptions);
  await fs.copyFile(path.join(root, 'src', 'sources', 'odluke.config.json'), path.join(outDir, 'odluke.config.json'));
  await fs.writeFile(licensesFile, await thirdPartyLicenses(metafile));
  const { size } = await fs.stat(outFile);
  console.log(`skill/sudska-praksa/scripts/praksa.mjs: ${(size / 1024).toFixed(0)} KB; licence: ${path.relative(root, licensesFile)}`);
}
