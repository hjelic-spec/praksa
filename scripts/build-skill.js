// Pakira skill/praksa-cli.js (s cheeriom i modulima iz src/) u jednu datoteku
// skill/sudska-praksa/scripts/praksa.mjs, kojoj treba samo Node.js 20+.
//   npm run skill:build
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const outDir = path.join(root, 'skill', 'sudska-praksa', 'scripts');
export const outFile = path.join(outDir, 'praksa.mjs');

export const buildOptions = {
  entryPoints: [path.join(root, 'skill', 'praksa-cli.js')],
  outfile: outFile,
  // Putanje u komentarima paketa su relativne na ovu mapu; fiksna je da bi izlaz bio isti odakle god se gradi.
  absWorkingDir: root,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  legalComments: 'none',
  // Koristi se samo cheerio.load. Glavni modul cheeria ga prosljeđuje iz load-parse.js, ali uz
  // njega uvozi i undici/iconv-lite za dohvat preko URL-a (~1,5 MB) koji ovdje ne treba.
  alias: { cheerio: path.join(root, 'node_modules', 'cheerio', 'dist', 'esm', 'load-parse.js') },
  banner: { js: '// GENERIRANO: npm run skill:build (izvor: skill/praksa-cli.js). Ne uređivati ručno.' },
  logLevel: 'warning',
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await build(buildOptions);
  await fs.copyFile(path.join(root, 'src', 'sources', 'odluke.config.json'), path.join(outDir, 'odluke.config.json'));
  const { size } = await fs.stat(outFile);
  console.log(`skill/sudska-praksa/scripts/praksa.mjs: ${(size / 1024).toFixed(0)} KB`);
}
