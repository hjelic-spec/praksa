import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MODEL } from './models.js';

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
  return JSON.parse(fs.readFileSync(path.resolve(root, file), 'utf8'));
}

let odlukeConfig;

export const config = {
  root,
  // Verzija aplikacije (package.json je i u Windows instalaciji); prikazuje se u Postavkama.
  // Čita se tek pri upotrebi: zapakirani skill nema package.json, pa je ondje null.
  get verzija() {
    try { return readJson('package.json').version; } catch { return null; }
  },
  port: Number(process.env.PORT ?? 3000),
  // Model se bira u Postavkama (src/settings.js); PRAKSA_MODEL vrijedi dok se ondje ne odabere drugi.
  model: process.env.PRAKSA_MODEL ?? DEFAULT_MODEL,
  // Koliko odluka najviše dohvatiti i analizirati po upitu (svaka analiza je jedan API poziv).
  maxDecisions: Number(process.env.PRAKSA_MAX_DECISIONS ?? 8),
  // Koliko kandidata (iz rezultata tražilice) model pregleda po isječcima prije odabira za analizu.
  maxCandidates: Number(process.env.PRAKSA_MAX_CANDIDATES ?? 60),
  // Rezultata po upitu tražilice (odluke.sudovi.hr prikazuje 10 po stranici).
  resultsPerQuery: Number(process.env.PRAKSA_RESULTS_PER_QUERY ?? 20),
  // Odluke ispod ovoga (ili s podudaranjem "ne") prikazuju se samo pod "Ostale pronađene odluke".
  relevanceThreshold: Number(process.env.PRAKSA_RELEVANCE_THRESHOLD ?? 50),
  // Odluke dulje od ovoga se skraćuju prije analize; skraćivanje se uvijek prikazuje korisniku.
  maxDecisionChars: Number(process.env.PRAKSA_MAX_CHARS ?? 150_000),
  // Koliko se odluka analizira istovremeno (pozivi modela su najsporiji korak; dohvat stranica
  // ionako ograničava minDelayMs). Zadano: sve odabrane odluke odjednom, najviše 8.
  analysisConcurrency: Number(process.env.PRAKSA_CONCURRENCY ?? 8),
  // Koliko upita tražilici ide istovremeno (svaki zahtjev i dalje poštuje minDelayMs).
  searchConcurrency: Number(process.env.PRAKSA_SEARCH_CONCURRENCY ?? 3),
  // Najmanji razmak između zahtjeva prema istom poslužitelju (odluke.sudovi.hr): jedan zahtjev u 3 s.
  minDelayMs: Number(process.env.PRAKSA_MIN_DELAY_MS ?? 3000),
  userAgent: process.env.PRAKSA_USER_AGENT ?? 'praksa-preglednik/0.1 (istrazivacki alat; kontakt: postavite PRAKSA_USER_AGENT)',
  dataDir,
  // PRAKSA_CACHE_DIR koristi skill (predmemorija izvan mape skilla); čita se pri svakoj upotrebi.
  get cacheDir() { return process.env.PRAKSA_CACHE_DIR ?? path.join(dataDir, 'cache'); },
  corpusDir: path.join(dataDir, 'corpus'),
  // Spremljeni predmeti (pretrage, bilješke); sadrže podatke o predmetima ureda i nisu u gitu.
  predmetiDir: process.env.PRAKSA_PREDMETI_DIR ?? path.join(dataDir, 'predmeti'),
  // Korisnik i lozinka (scrypt) te postavke (API ključ…); nisu u gitu.
  authFile: path.join(dataDir, 'prijava.json'), // prijava starije verzije (jedan korisnik); preuzima se u korisnici.json
  usersFile: path.join(dataDir, 'korisnici.json'),
  // Web u uredu: PRAKSA_HOST=0.0.0.0 otvara pristup s drugih računala u mreži.
  host: process.env.PRAKSA_HOST ?? '127.0.0.1',
  // Dodatni nazivi pod kojima se poslužitelju pristupa (npr. ured-pc:8080), uz lokalne IP adrese i naziv računala.
  allowedHosts: (process.env.PRAKSA_ALLOWED_HOSTS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  // Javna adresa kad aplikacija radi na poslužitelju iza HTTPS proxyja (npr. https://praksa.primjer.hr):
  // kolačić sesije tada ima oznaku Secure, domena je dopuštena, a poveznice u e-pošti vode na nju.
  publicUrl: (process.env.PRAKSA_PUBLIC_URL ?? '').trim().replace(/\/+$/, ''),
  // PRAKSA_TRUST_PROXY=1: IP adresa korisnika uzima se iz X-Forwarded-For koji postavlja proxy
  // (inače bi svi korisnici imali adresu proxyja, pa bi krive lozinke jednoga blokirale sve).
  trustProxy: process.env.PRAKSA_TRUST_PROXY === '1',
  // Sesije se pamte na disku (samo sažeci tokena), pa ponovno pokretanje poslužitelja ne odjavljuje korisnike.
  sessionsFile: path.join(dataDir, 'sesije.json'),
  // E-pošta (reset lozinke, obavijest o registraciji): npr. smtps://korisnik:lozinka@smtp.primjer.hr:465
  smtpUrl: process.env.PRAKSA_SMTP_URL ?? '',
  mailFrom: process.env.PRAKSA_MAIL_FROM ?? '',
  // Pristupni podaci ugrađeni u instalaciju (nije u gitu; izrađuje `npm run postavi-prijavu`).
  bundledAuthFile: process.env.PRAKSA_BUNDLED_AUTH ?? path.join(root, 'src', 'prijava-ugradena.json'),
  settingsFile: path.join(dataDir, 'postavke.json'),
  // Zadnji provjereni cjenik modela (automatski se osvježava, vidi src/pricing.js).
  pricingFile: path.join(dataDir, 'cjenik.json'),
  // Izvori: "odluke" (odluke.sudovi.hr), "local" (data/corpus). Npr. PRAKSA_SOURCES=local
  sources: (process.env.PRAKSA_SOURCES ?? 'odluke,local').split(',').map((s) => s.trim()).filter(Boolean),
  get verifyEuViaSparql() { return process.env.PRAKSA_VERIFY_EU !== '0'; },
  // Čita se tek pri prvoj upotrebi, pa PRAKSA_ODLUKE_CONFIG može postaviti i skill na početku izvođenja.
  get odluke() {
    return (odlukeConfig ??= readJson(process.env.PRAKSA_ODLUKE_CONFIG ?? 'src/sources/odluke.config.json'));
  },
};
