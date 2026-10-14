import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Podaci (predmeti, prijava, postavke, međuspremnik stranica). U Windows aplikaciji to je
// korisnikov profil (%APPDATA%\Praksa), jer se u mapu programa ne smije pisati.
const dataDir = process.env.PRAKSA_DATA_DIR ?? path.join(root, 'data');

// Varijable iz .env (npr. ANTHROPIC_API_KEY); one već postavljene u okruženju imaju prednost.
try {
  process.loadEnvFile(path.join(root, '.env'));
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
}

export const config = {
  root,
  port: Number(process.env.PORT ?? 3000),
  model: process.env.PRAKSA_MODEL ?? 'claude-opus-5-5',
  // Koliko odluka najviše dohvatiti i analizirati po upitu (svaka analiza je jedan API poziv).
  maxDecisions: Number(process.env.PRAKSA_MAX_DECISIONS ?? 15),
  // Odluke dulje od ovoga se skraćuju prije analize; skraćivanje se uvijek prikazuje korisniku.
  maxDecisionChars: Number(process.env.PRAKSA_MAX_CHARS ?? 150_000),
  analysisConcurrency: Number(process.env.PRAKSA_CONCURRENCY ?? 3),
  minDelayMs: Number(process.env.PRAKSA_MIN_DELAY_MS ?? 1500),
  userAgent: process.env.PRAKSA_USER_AGENT ?? 'praksa-preglednik/0.1 (istrazivacki alat; kontakt: postavite PRAKSA_USER_AGENT)',
  dataDir,
  cacheDir: path.join(dataDir, 'cache'),
  corpusDir: path.join(dataDir, 'corpus'),
  // Spremljeni predmeti (pretrage, bilješke); sadrže podatke o predmetima ureda i nisu u gitu.
  predmetiDir: process.env.PRAKSA_PREDMETI_DIR ?? path.join(dataDir, 'predmeti'),
  // Korisnik i lozinka (scrypt) te postavke (API ključ…); nisu u gitu.
  authFile: path.join(dataDir, 'prijava.json'),
  // Pristupni podaci ugrađeni u instalaciju (nije u gitu; izrađuje `npm run postavi-prijavu`).
  bundledAuthFile: process.env.PRAKSA_BUNDLED_AUTH ?? path.join(root, 'src', 'prijava-ugradena.json'),
  settingsFile: path.join(dataDir, 'postavke.json'),
  // Zadnji provjereni cjenik modela (automatski se osvježava, vidi src/pricing.js).
  pricingFile: path.join(dataDir, 'cjenik.json'),
  // Izvori: "odluke" (odluke.sudovi.hr), "local" (data/corpus). Npr. PRAKSA_SOURCES=local
  sources: (process.env.PRAKSA_SOURCES ?? 'odluke,local').split(',').map((s) => s.trim()).filter(Boolean),
  get verifyEuViaSparql() { return process.env.PRAKSA_VERIFY_EU !== '0'; },
  odluke: readJson('src/sources/odluke.config.json'),
};
