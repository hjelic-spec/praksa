// HTTP klijent za javne izvore: pristojan prema poslužitelju (ograničenje brzine,
// jasan User-Agent, predmemorija na disku) i s jednostavnim spremnikom kolačića
// (ASP.NET obrasci često traže kolačić uz anti-forgery token).
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const lastRequestAt = new Map();
const cookieJars = new Map();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function throttle(host) {
  const wait = (lastRequestAt.get(host) ?? 0) + config.minDelayMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt.set(host, Date.now());
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

export async function fetchText(url, { method = 'GET', body, useCache = true } = {}) {
  const key = `${method} ${url} ${body ?? ''}`;
  if (useCache && method === 'GET') {
    try {
      return await fs.readFile(cacheFile(key), 'utf8');
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
  if (useCache && method === 'GET') {
    await fs.mkdir(config.cacheDir, { recursive: true });
    await fs.writeFile(cacheFile(key), text);
  }
  return text;
}
