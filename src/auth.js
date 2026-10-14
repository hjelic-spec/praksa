// Prijava jednog lokalnog korisnika: korisničko ime i lozinka (scrypt), sesije u memoriji
// (svako pokretanje aplikacije traži novu prijavu).
//
// Pristupni podaci mogu biti ugrađeni u instalaciju (src/prijava-ugradena.json, izrađuje ga
// `npm run postavi-prijavu`): tada prvo postavljanje nije moguće i aplikacija se na bilo kojem
// računalu otvara samo s tim podacima. Lozinka promijenjena u aplikaciji sprema se u
// data/prijava.json i ima prednost; brisanjem te datoteke vraća se ugrađena prijava.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';

const scrypt = promisify(crypto.scrypt);
const PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const IDLE_MS = 8 * 3600 * 1000; // sesija istječe nakon 8 sati neaktivnosti
const MAX_FAILS = 5;
const LOCK_MS = 30_000;

const err = (status, message) => Object.assign(new Error(message), { status });
const sessions = new Map();
let fails = 0;
let lockedUntil = 0;

async function readJson(file) {
  const raw = await fs.readFile(file, 'utf8').catch(() => null);
  return raw ? JSON.parse(raw) : null;
}

async function readUser() {
  return (await readJson(config.authFile)) ?? (await readJson(config.bundledAuthFile));
}

async function hash(password, salt) {
  return (await scrypt(password, Buffer.from(salt, 'hex'), 64, PARAMS)).toString('hex');
}

// Zapis pristupnih podataka (bez lozinke u čistom obliku), za data/prijava.json i ugrađenu prijavu.
export async function makeCredentials(korisnik, lozinka) {
  validate(korisnik, lozinka);
  const salt = crypto.randomBytes(16).toString('hex');
  return { korisnik, salt, hash: await hash(lozinka, salt), stvoreno: new Date().toISOString() };
}

export function validate(korisnik, lozinka) {
  if (typeof korisnik !== 'string' || !/^[\p{L}\d._@-]{3,64}$/u.test(korisnik)) {
    throw err(400, 'Korisničko ime mora imati 3–64 znaka (slova, brojke, . _ @ -).');
  }
  if (typeof lozinka !== 'string' || lozinka.length < 8) throw err(400, 'Lozinka mora imati barem 8 znakova.');
}

export async function hasUser() {
  return Boolean(await readUser());
}

export async function createUser(korisnik, lozinka) {
  if (await hasUser()) throw err(409, 'Korisnik je već postavljen.');
  const cred = await makeCredentials(korisnik, lozinka);
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(config.authFile, JSON.stringify(cred, null, 1));
}

export async function verify(korisnik, lozinka) {
  if (Date.now() < lockedUntil) throw err(429, 'Previše neuspješnih pokušaja. Pričekajte 30 sekundi.');
  const u = await readUser();
  const ok = u && typeof lozinka === 'string' && typeof korisnik === 'string'
    && crypto.timingSafeEqual(Buffer.from(await hash(lozinka, u.salt), 'hex'), Buffer.from(u.hash, 'hex'))
    && korisnik.trim().normalize().toLowerCase() === u.korisnik.normalize().toLowerCase();
  if (!ok) {
    if (++fails >= MAX_FAILS) { lockedUntil = Date.now() + LOCK_MS; fails = 0; }
    throw err(401, 'Pogrešno korisničko ime ili lozinka.');
  }
  fails = 0;
  return u.korisnik;
}

export async function changePassword(stara, nova) {
  const u = await readUser();
  await verify(u.korisnik, stara);
  validate(u.korisnik, nova);
  u.salt = crypto.randomBytes(16).toString('hex');
  u.hash = await hash(nova, u.salt);
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(config.authFile, JSON.stringify(u, null, 1));
  sessions.clear();
}

export function createSession(korisnik) {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, { korisnik, seen: Date.now() });
  return token;
}

export function getSession(token) {
  const s = token && sessions.get(token);
  if (!s) return null;
  if (Date.now() - s.seen > IDLE_MS) { sessions.delete(token); return null; }
  s.seen = Date.now();
  return s;
}

export function destroySession(token) {
  sessions.delete(token);
}

export function tokenFromCookie(header = '') {
  return header.split(/;\s*/).find((c) => c.startsWith('praksa_sesija='))?.slice('praksa_sesija='.length) ?? null;
}

export const sessionCookie = (token) => `praksa_sesija=${token}; HttpOnly; SameSite=Strict; Path=/`;
export const clearCookie = 'praksa_sesija=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';
