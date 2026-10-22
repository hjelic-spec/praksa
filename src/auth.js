// Korisnici, prijava i registracija s odobrenjem administratora; sesije u memoriji.
//
// Korisnici su u data/korisnici.json (lozinke kao scrypt sažetak). Prvi korisnik je
// administrator: preuzima se iz prijave starije verzije (data/prijava.json), iz prijave
// ugrađene u instalaciju (src/prijava-ugradena.json, `npm run postavi-prijavu`) ili se
// postavlja pri prvom pokretanju. Ostali se registriraju sami i čekaju odobrenje.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';

const scrypt = promisify(crypto.scrypt);
const PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const IDLE_MS = 8 * 3600 * 1000; // sesija istječe nakon 8 sati neaktivnosti
const MAX_FAILS = 5;
const LOCK_MS = 30_000;
const MAX_PENDING = 50;
const DUMMY_SALT = crypto.randomBytes(16).toString('hex');

export const STATUS = { CEKA: 'ceka', ODOBREN: 'odobren', ODBIJEN: 'odbijen', BLOKIRAN: 'blokiran' };

const err = (status, message) => Object.assign(new Error(message), { status });
const sessions = new Map(); // SHA-256 sažetak tokena -> { userId, seen }
const fails = new Map(); // IP -> { n, lockedUntil }
let users = null;

const norm = (email) => String(email ?? '').trim().normalize().toLowerCase();

async function hash(password, salt) {
  return (await scrypt(password, Buffer.from(salt, 'hex'), 64, PARAMS)).toString('hex');
}

export function validate(korisnik, lozinka) {
  if (typeof korisnik !== 'string' || !/^[\p{L}\d._@+-]{3,100}$/u.test(korisnik.trim())) {
    throw err(400, 'Korisničko ime (e-pošta) mora imati 3–100 znakova.');
  }
  if (typeof lozinka !== 'string' || lozinka.length < 8) throw err(400, 'Lozinka mora imati barem 8 znakova.');
}

// Zapis pristupnih podataka (bez lozinke u čistom obliku), za ugrađenu prijavu administratora.
export async function makeCredentials(korisnik, lozinka) {
  validate(korisnik, lozinka);
  const salt = crypto.randomBytes(16).toString('hex');
  return { korisnik, salt, hash: await hash(lozinka, salt), stvoreno: new Date().toISOString() };
}

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

function save() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const tmp = `${config.usersFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(users, null, 1));
  fs.renameSync(tmp, config.usersFile);
}

function adminFrom(cred) {
  return {
    id: crypto.randomUUID().slice(0, 12), email: cred.korisnik, ime: 'Administrator', uloga: 'admin', status: STATUS.ODOBREN,
    salt: cred.salt, hash: cred.hash, stvoreno: cred.stvoreno ?? new Date().toISOString(),
  };
}

// Učitava korisnike; ako ih nema, administrator se preuzima iz starije ili ugrađene prijave.
export function loadUsers() {
  users = readJson(config.usersFile);
  if (!users) {
    const legacy = readJson(config.authFile) ?? readJson(config.bundledAuthFile);
    users = legacy ? [adminFrom(legacy)] : [];
    if (users.length) save();
  }
  return users;
}
const all = () => users ?? loadUsers();

export const admin = () => all().find((u) => u.uloga === 'admin') ?? null;
export const hasUser = () => all().length > 0;
export const findUser = (id) => all().find((u) => u.id === id) ?? null;
const byEmail = (email) => all().find((u) => norm(u.email) === norm(email));

export function publicUser(u) {
  return {
    id: u.id, email: u.email, ime: u.ime, uloga: u.uloga, status: u.status, stvoreno: u.stvoreno,
    odobreno: u.odobreno ?? null, zadnjaPrijava: u.zadnjaPrijava ?? null, kvotaUSD: u.kvotaUSD ?? null,
  };
}

// Mjesečna kvota korisnika u USD: vlastita (kvotaUSD) ili zadana; null = bez ograničenja.
// Administrator nema kvotu.
export function kvotaFor(u, defaultUSD) {
  if (u.uloga === 'admin') return null;
  const k = u.kvotaUSD ?? defaultUSD;
  return k > 0 ? k : null;
}

// Administrator određuje korisniku vlastitu kvotu; null vraća zadanu, 0 znači bez ograničenja.
export function setKvota(userId, kvotaUSD) {
  const u = findUser(userId);
  if (!u) throw err(404, 'Korisnik nije pronađen.');
  if (u.uloga === 'admin') throw err(400, 'Administrator nema kvotu.');
  if (kvotaUSD === null || kvotaUSD === '') {
    delete u.kvotaUSD;
  } else {
    const k = Number(kvotaUSD);
    if (!Number.isFinite(k) || k < 0 || k > 100_000) throw err(400, 'Kvota mora biti iznos u USD (0 = bez ograničenja).');
    u.kvotaUSD = Math.round(k * 100) / 100;
  }
  save();
  return u;
}

async function newUser({ email, ime, lozinka, uloga, status }) {
  validate(email, lozinka);
  if (byEmail(email)) throw err(409, 'Korisnik s tom e-poštom već postoji.');
  const salt = crypto.randomBytes(16).toString('hex');
  const u = { id: crypto.randomUUID().slice(0, 12), email: email.trim(), ime: String(ime ?? '').trim().slice(0, 100), uloga, status, salt, hash: await hash(lozinka, salt), stvoreno: new Date().toISOString() };
  all().push(u);
  save();
  return u;
}

// Prvo pokretanje bez ikakvog korisnika: postavlja se administrator.
export async function createAdmin(email, lozinka) {
  if (hasUser()) throw err(409, 'Korisnik je već postavljen.');
  return newUser({ email, ime: 'Administrator', lozinka, uloga: 'admin', status: STATUS.ODOBREN });
}

// Registracija: račun čeka odobrenje administratora.
export async function register({ email, ime, lozinka }) {
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw err(400, 'Upišite ispravnu adresu e-pošte.');
  if (!String(ime ?? '').trim()) throw err(400, 'Upišite ime i prezime.');
  if (!hasUser()) throw err(409, 'Najprije treba postaviti administratora.');
  // Zaštita od preplavljivanja registracijama: ograničen broj računa na čekanju.
  if (all().filter((u) => u.status === STATUS.CEKA).length >= MAX_PENDING) {
    throw err(429, 'Trenutačno je previše zahtjeva na čekanju. Pokušajte kasnije ili se obratite administratoru.');
  }
  return newUser({ email, ime, lozinka, uloga: 'korisnik', status: STATUS.CEKA });
}

const STATUS_MSG = {
  [STATUS.CEKA]: 'Račun čeka odobrenje administratora.',
  [STATUS.ODBIJEN]: 'Zahtjev za račun je odbijen.',
  [STATUS.BLOKIRAN]: 'Račun je blokiran. Obratite se administratoru.',
};

export async function verify(email, lozinka, ip = '') {
  const f = fails.get(ip) ?? { n: 0, lockedUntil: 0 };
  if (Date.now() < f.lockedUntil) throw err(429, 'Previše neuspješnih pokušaja. Pričekajte 30 sekundi.');
  const u = byEmail(email);
  // Sažetak se računa i za nepostojeći račun, da vrijeme odgovora ne otkriva koje e-pošte postoje.
  const computed = await hash(typeof lozinka === 'string' ? lozinka : '', u?.salt ?? DUMMY_SALT);
  const ok = u && typeof lozinka === 'string'
    && crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(u.hash, 'hex'));
  if (!ok) {
    if (++f.n >= MAX_FAILS) { f.lockedUntil = Date.now() + LOCK_MS; f.n = 0; }
    fails.set(ip, f);
    throw err(401, 'Pogrešna e-pošta ili lozinka.');
  }
  fails.delete(ip);
  if (u.status !== STATUS.ODOBREN) throw err(403, STATUS_MSG[u.status]);
  u.zadnjaPrijava = new Date().toISOString();
  save();
  return u;
}

export async function changePassword(userId, stara, nova) {
  const u = findUser(userId);
  if (!u || !crypto.timingSafeEqual(Buffer.from(await hash(String(stara ?? ''), u.salt), 'hex'), Buffer.from(u.hash, 'hex'))) {
    throw err(401, 'Trenutna lozinka nije točna.');
  }
  validate(u.email, nova);
  u.salt = crypto.randomBytes(16).toString('hex');
  u.hash = await hash(nova, u.salt);
  save();
  dropSessions(userId);
}

// ---------- reset lozinke ----------
const RESET_MS = 3600 * 1000; // poveznica za novu lozinku vrijedi jedan sat

// Token za novu lozinku (šalje se e-poštom); u korisniku je samo njegov sažetak i rok.
// Za nepostojeći ili neodobren račun vraća null, a poslužitelj tada ništa ne šalje.
export function createResetToken(email) {
  const u = byEmail(email);
  if (!u || u.status !== STATUS.ODOBREN) return null;
  const token = crypto.randomBytes(32).toString('base64url');
  u.reset = { hash: tokenKey(token), exp: Date.now() + RESET_MS };
  save();
  return { token, user: u };
}

export async function resetPassword(token, nova) {
  const key = typeof token === 'string' && token ? tokenKey(token) : null;
  const u = key && all().find((x) => x.reset?.hash === key);
  if (!u || Date.now() > u.reset.exp || u.status !== STATUS.ODOBREN) {
    throw err(400, 'Poveznica za novu lozinku nije valjana ili je istekla. Zatražite novu.');
  }
  validate(u.email, nova);
  // Poveznica se poništava prije izračuna sažetka (await), pa je ni istodobni zahtjevi ne mogu iskoristiti dvaput.
  delete u.reset;
  u.salt = crypto.randomBytes(16).toString('hex');
  u.hash = await hash(nova, u.salt);
  save();
  dropSessions(u.id);
  return u;
}

// Administrator postavlja korisniku novu nasumičnu lozinku (prikazuje mu se jednom); korisnik se odjavljuje.
export async function adminResetPassword(userId) {
  const u = findUser(userId);
  if (!u) throw err(404, 'Korisnik nije pronađen.');
  if (u.uloga === 'admin') throw err(400, 'Svoju lozinku administrator mijenja u Postavkama.');
  const lozinka = crypto.randomBytes(12).toString('base64url'); // 16 znakova
  u.salt = crypto.randomBytes(16).toString('hex');
  u.hash = await hash(lozinka, u.salt);
  delete u.reset;
  save();
  dropSessions(u.id);
  return lozinka;
}

// Administracija: odobri, odbij, blokiraj, deblokiraj, obriši. Administrator ne može mijenjati sebe.
export function setStatus(adminId, userId, akcija) {
  const u = findUser(userId);
  if (!u) throw err(404, 'Korisnik nije pronađen.');
  if (u.id === adminId || u.uloga === 'admin') throw err(400, 'Administratorski račun ne može se mijenjati ovdje.');
  // Dopuštene radnje po stanju (isto što nudi sučelje).
  const allowed = {
    [STATUS.CEKA]: ['odobri', 'odbij'],
    [STATUS.ODOBREN]: ['blokiraj'],
    [STATUS.ODBIJEN]: ['odobri', 'obrisi'],
    [STATUS.BLOKIRAN]: ['deblokiraj', 'obrisi'],
  }[u.status] ?? [];
  if (!allowed.includes(akcija)) throw err(400, 'Ta radnja nije moguća za ovaj račun.');
  const next = { odobri: STATUS.ODOBREN, odbij: STATUS.ODBIJEN, blokiraj: STATUS.BLOKIRAN, deblokiraj: STATUS.ODOBREN }[akcija];
  if (akcija === 'obrisi') {
    users = all().filter((x) => x.id !== userId);
  } else {
    u.status = next;
    if (akcija === 'odobri') u.odobreno = new Date().toISOString();
  }
  save();
  if (akcija !== 'odobri' && akcija !== 'deblokiraj') dropSessions(userId);
  return u;
}

export const listUsers = () => all().map(publicUser);

// ---------- sesije ----------
// Sesije su u memoriji i na disku (config.sessionsFile), pa ponovno pokretanje poslužitelja ne
// odjavljuje korisnike. Na disku je samo SHA-256 sažetak tokena: tko pročita datoteku, ne može
// iz nje sastaviti kolačić. Vrijeme zadnje aktivnosti zapisuje se najviše jednom u minuti.
const SEEN_WRITE_MS = 60_000;
const tokenKey = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
let sessionsLoaded = false;
let lastSessionWrite = 0;

function saveSessions() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const tmp = `${config.sessionsFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(sessions)), { mode: 0o600 });
  fs.renameSync(tmp, config.sessionsFile);
  lastSessionWrite = Date.now();
}

function ensureSessions() {
  if (sessionsLoaded) return;
  sessionsLoaded = true;
  const now = Date.now();
  for (const [k, v] of Object.entries(readJson(config.sessionsFile) ?? {})) {
    if (v && typeof v.userId === 'string' && now - v.seen <= IDLE_MS) sessions.set(k, v);
  }
}

export function createSession(userId) {
  ensureSessions();
  const token = crypto.randomBytes(32).toString('base64url');
  // Istekle sesije uklanjaju se pri svakoj novoj prijavi, da se datoteka ne povećava.
  for (const [k, v] of sessions) if (Date.now() - v.seen > IDLE_MS) sessions.delete(k);
  sessions.set(tokenKey(token), { userId, seen: Date.now() });
  saveSessions();
  return token;
}

// Vraća prijavljenog korisnika; blokiran ili obrisan korisnik odmah gubi pristup.
export function getSession(token) {
  if (!token) return null;
  ensureSessions();
  const key = tokenKey(token);
  const s = sessions.get(key);
  if (!s) return null;
  const u = findUser(s.userId);
  if (!u || u.status !== STATUS.ODOBREN || Date.now() - s.seen > IDLE_MS) {
    sessions.delete(key);
    saveSessions();
    return null;
  }
  s.seen = Date.now();
  if (s.seen - lastSessionWrite > SEEN_WRITE_MS) saveSessions();
  return { user: u };
}

function dropSessions(userId) {
  ensureSessions();
  for (const [k, s] of sessions) if (s.userId === userId) sessions.delete(k);
  saveSessions();
}

export function destroySession(token) {
  if (!token) return;
  ensureSessions();
  if (sessions.delete(tokenKey(token))) saveSessions();
}

export function tokenFromCookie(header = '') {
  return header.split(/;\s*/).find((c) => c.startsWith('praksa_sesija='))?.slice('praksa_sesija='.length) ?? null;
}

// Uz HTTPS javnu adresu kolačić ide samo preko šifrirane veze.
const secure = () => (config.publicUrl.startsWith('https://') ? '; Secure' : '');
export const sessionCookie = (token) => `praksa_sesija=${token}; HttpOnly; SameSite=Strict; Path=/${secure()}`;
export const clearCookie = 'praksa_sesija=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';
