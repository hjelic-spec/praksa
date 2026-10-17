// Testovi naredbi skilla na IZMIŠLJENIM odlukama u lokalnim datotekama (bez mreže).
// Pokreću zapakiranu skriptu, koju korisnici stvarno dobivaju, i provjeravaju da je
// izgrađena iz trenutnog izvornog koda.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { buildOptions, outFile, outDir } from '../scripts/build-skill.js';

const run = promisify(execFile);
const env = { ...process.env, PRAKSA_VERIFY_EU: '0' };

async function cli(args, cwd) {
  const { stdout } = await run(process.execPath, [outFile, ...args], { cwd, env });
  return JSON.parse(stdout);
}

test('zapakirana skripta odgovara izvornom kodu (npm run skill:build)', async () => {
  const r = await build({ ...buildOptions, write: false });
  const fresh = r.outputFiles[0].text;
  const current = await fs.readFile(outFile, 'utf8');
  assert.ok(fresh === current, 'skill/sudska-praksa/scripts/praksa.mjs je zastario: pokrenite npm run skill:build');
  const cfg = await fs.readFile(path.join(outDir, 'odluke.config.json'), 'utf8');
  const src = await fs.readFile(new URL('../src/sources/odluke.config.json', import.meta.url), 'utf8');
  assert.equal(cfg, src, 'kopija odluke.config.json u skillu je zastarjela');
});

test('dohvati, citat i povezi na lokalnim datotekama', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'praksa-skill-'));
  const pad = '.'.repeat(250);
  await fs.writeFile(path.join(dir, 'a.txt'), `Vrhovni sud Republike Hrvatske\nPoslovni broj: Rev 100/2020-2\n${pad}\n` +
    'Sud smatra da štrajk vlastitog osoblja prijevoznika nije izvanredna okolnost u smislu Uredbe (EZ) br. 261/2004. Vidi Gž-55/2019.\n');
  await fs.writeFile(path.join(dir, 'b.html'), `<html><body><nav>Izbornik</nav><p>Županijski sud u Splitu</p>
    <p>Poslovni broj: Gž-55/2019</p><p>${pad}</p><p>Vidi Rev-100/20.</p></body></html>`);

  const d = await cli(['dohvati', 'a.txt', 'b.html', 'nema.txt', '--dir', 'rad'], dir);
  assert.equal(d.odluke.length, 2);
  assert.equal(d.upozorenja.length, 1, 'nepostojeća datoteka je upozorenje, ne pad');
  const [a, b] = d.odluke;
  assert.equal(a.meta.poslovniBroj, 'Rev 100/2020-2');
  assert.equal(a.meta.sud, 'Vrhovni sud Republike Hrvatske');
  assert.deepEqual(a.citiraniPredmeti, ['Gž-55/2019']);
  assert.ok(a.euReference.some((e) => e.celex === '32004R0261' && e.provjera === 'neprovjereno'));
  assert.equal(b.meta.poslovniBroj, 'Gž-55/2019');
  const tekstB = await fs.readFile(path.join(dir, b.datoteka), 'utf8');
  assert.ok(!tekstB.includes('Izbornik'), 'navigacija je uklonjena iz HTML-a');

  assert.deepEqual(await cli(['citat', a.datoteka, 'štrajk vlastitog osoblja prijevoznika nije izvanredna okolnost'], dir), { provjeren: true });
  assert.deepEqual(await cli(['citat', a.datoteka, 'ova rečenica ne postoji u odluci'], dir), { provjeren: false });

  const veze = await cli(['povezi', '--dir', 'rad'], dir);
  const va = veze.find((v) => v.oznaka === 'Rev 100/2020-2');
  const vb = veze.find((v) => v.oznaka === 'Gž-55/2019');
  assert.ok(va.povezani.some((p) => p.url === b.url && p.odnos === 'citira'));
  assert.ok(vb.povezani.some((p) => p.url === a.url && p.odnos === 'citira'), 'Rev-100/20 = Rev 100/2020-2');
});

test('pomoć i nepoznata naredba', async () => {
  const { stdout } = await run(process.execPath, [outFile, '--help'], { env });
  assert.match(stdout, /pretrazi/);
  await assert.rejects(run(process.execPath, [outFile, 'nepostojeca'], { env }), (e) => e.code === 2);
});
