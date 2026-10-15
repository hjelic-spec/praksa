// Postavke koje korisnik mijenja u aplikaciji (data/postavke.json): API ključ, najveći broj
// odluka po upitu i kontakt za User-Agent. Varijable okruženja (.env) vrijede kao zadane.
import fs from 'node:fs';
import { config } from './config.js';

let current = {};

function apply() {
  if (current.maxOdluka) config.maxDecisions = current.maxOdluka;
  if (current.kontakt) config.userAgent = `praksa-preglednik/0.1 (istrazivacki alat; kontakt: ${current.kontakt})`;
}

export function loadSettings() {
  try {
    current = JSON.parse(fs.readFileSync(config.settingsFile, 'utf8'));
  } catch {
    current = {};
  }
  apply();
  return current;
}

export function getApiKey() {
  return current.apiKey || process.env.ANTHROPIC_API_KEY || null;
}

export function publicSettings() {
  const key = getApiKey();
  return {
    imaKljuc: Boolean(key),
    kljucZavrsava: key ? key.slice(-4) : null,
    maxOdluka: config.maxDecisions,
    kontakt: current.kontakt ?? '',
  };
}

export function saveSettings({ apiKey, maxOdluka, kontakt }) {
  const err = (m) => Object.assign(new Error(m), { status: 400 });
  // Sve se provjerava prije bilo kakve promjene, da neuspjelo spremanje ne ostavi djelomične postavke.
  const next = { ...current };
  if (apiKey !== undefined && apiKey !== '') {
    if (typeof apiKey !== 'string' || !/^sk-ant-[\w-]{20,}$/.test(apiKey.trim())) throw err('API ključ mora počinjati sa "sk-ant-".');
    next.apiKey = apiKey.trim();
  }
  if (maxOdluka !== undefined) {
    const n = Number(maxOdluka);
    if (!Number.isInteger(n) || n < 1 || n > 30) throw err('Broj odluka mora biti između 1 i 30.');
    next.maxOdluka = n;
  }
  if (kontakt !== undefined) next.kontakt = String(kontakt).trim().slice(0, 200);
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(config.settingsFile, JSON.stringify(next, null, 1));
  current = next;
  apply();
  return publicSettings();
}
