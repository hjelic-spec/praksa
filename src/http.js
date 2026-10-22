// HTTP klijent za javne izvore: pristojan prema poslužitelju (ograničenje brzine,
// jasan User-Agent, predmemorija na disku) i s jednostavnim spremnikom kolačića
// (ASP.NET obrasci često traže kolačić uz anti-forgery token).
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const nextSlot = new Map();
const cookieJars = new Map();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Svaki zahtjev prema istom poslužitelju sinkrono rezervira svoj termin (najmanje minDelayMs
// nakon prethodnog), pa ni istovremeni zahtjevi ne idu prečesto.
async function throttle(host) {
  const now = Date.now();
  const slot = Math.max(now, nextSlot.get(host) ?? 0);
  nextSlot.set(host, slot + config.minDelayMs);
  if (slot > now) await sleep(slot - now);
}

function storeCookies(host, res) {
  const jar = cookieJars.get(host) ?? new Map();
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  cookieJars.set(host, jar);
}

function cookieHeader(host) {
  const jar = cookieJars.get(host);
  return jar && jar.size ? [...jar].map(([k, v]) => `${k}=${v}`).join('; ') : undefined;
}

function cacheFile(key) {
  return path.join(config.cacheDir, crypto.createHash('sha256').update(key).digest('hex') + '.html');
}

// Predmemorija vrijedi maxAgeMs (zadano 30 dana; rezultati pretrage kraće, jer se odluke objavljuju
// svakodnevno). refresh: true preskače čitanje, ali novi odgovor sprema (npr. kad je spremljena
// stranica neispravna).
export const DEFAULT_MAX_AGE_MS = 30 * 24 * 3600 * 1000;

export async function fetchText(url, { method = 'GET', body, useCache = true, maxAgeMs = DEFAULT_MAX_AGE_MS, refresh = false } = {}) {
  const key = `${method} ${url} ${body ?? ''}`;
  const cacheable = useCache && method === 'GET';
  if (cacheable && !refresh) {
    try {
      const file = cacheFile(key);
      if (Date.now() - (await fs.stat(file)).mtimeMs < maxAgeMs) return await fs.readFile(file, 'utf8');
    } catch { /* nije u predmemoriji */ }
  }
  const host = new URL(url).host;
  await throttle(host);
  const headers = { 'User-Agent': config.userAgent, Accept: 'text/html,application/xhtml+xml' };
  const cookie = cookieHeader(host);
  if (cookie) headers.Cookie = cookie;
  if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';

  const res = await fetch(url, { method, body, headers, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  storeCookies(host, res);
  if (!res.ok) throw new Error(`HTTP ${res.status} za ${url}`);
  const text = await res.text();
  if (cacheable) {
    // Upis preko privremene datoteke: istovremeno čitanje nikad ne vidi napola upisanu stranicu.
    await fs.mkdir(config.cacheDir, { recursive: true });
    const file = cacheFile(key);
    const tmp = `${file}.${process.pid}.${crypto.randomUUID().slice(0, 8)}.tmp`;
    await fs.writeFile(tmp, text);
    await fs.rename(tmp, file);
  }
  return text;
}
