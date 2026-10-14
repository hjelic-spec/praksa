import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
  cacheDir: path.join(root, 'data', 'cache'),
  corpusDir: path.join(root, 'data', 'corpus'),
  // Izvori: "odluke" (odluke.sudovi.hr), "local" (data/corpus). Npr. PRAKSA_SOURCES=local
  sources: (process.env.PRAKSA_SOURCES ?? 'odluke,local').split(',').map((s) => s.trim()).filter(Boolean),
  get verifyEuViaSparql() { return process.env.PRAKSA_VERIFY_EU !== '0'; },
  odluke: readJson('src/sources/odluke.config.json'),
};
