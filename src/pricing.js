// Procjena troška poziva Claude API-ja iz response.usage, u USD po milijunu tokena (MTok).
//
// Cjenik se automatski osvježava iz službene dokumentacije (Markdown tablica na
// platform.claude.com) pri pokretanju i zatim jednom dnevno; provjereni cjenik sprema se
// u data/cjenik.json. Ako dohvat ne uspije ili tablica ne prođe provjeru, koristi se
// zadnji spremljeni, a ako ga nema – ugrađeni cjenik ispod.
// Trošak se računa po modelu koji je stvarno odgovorio (response.model), jer kod odbijanja
// zahtjev može preuzeti zamjenski model.
import fs from 'node:fs';
import { config } from './config.js';

export const PRICING_URL = 'https://platform.claude.com/docs/en/about-claude/pricing.md';
const REFRESH_MS = 24 * 3600 * 1000;

// Ugrađeni cjenik (stanje 14.10.2026.): ulaz, upis u 5-min međuspremnik, čitanje iz međuspremnika, izlaz.
const BUILTIN = {
  'claude-fable-5-1': { ulaz: 10, pisanje: 12.5, citanje: 0.25, izlaz: 50 },
  'claude-fable-5': { ulaz: 10, pisanje: 12.5, citanje: 1, izlaz: 50 },
  'claude-opus-5-5': { ulaz: 4, pisanje: 5, citanje: 0.2, izlaz: 20 },
  'claude-opus-5': { ulaz: 5, pisanje: 6.25, citanje: 0.5, izlaz: 25 },
  'claude-opus-4-8': { ulaz: 5, pisanje: 6.25, citanje: 0.5, izlaz: 25 },
  'claude-opus-4-7': { ulaz: 5, pisanje: 6.25, citanje: 0.5, izlaz: 25 },
  'claude-sonnet-5-5': { ulaz: 2, pisanje: 2.5, citanje: 0.1, izlaz: 10 },
  'claude-sonnet-5': { ulaz: 2, pisanje: 2.5, citanje: 0.2, izlaz: 10 },
  'claude-haiku-5-5': { ulaz: 0.1, pisanje: 0.125, citanje: 0.01, izlaz: 0.5 },
};

let state = { cijene: BUILTIN, dohvaceno: null, izvor: 'ugrađeni cjenik (14.10.2026.)', greska: null };

// "Claude Opus 5.5" → "claude-opus-5-5"; dodaci u zagradama ("(limited availability)") se uklanjaju.
export function modelIdFromName(name) {
  return name.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\(.*?\)/g, '').trim().toLowerCase()
    .replace(/\./g, '-').replace(/\s+/g, '-');
}

const price = (cell) => {
  const m = /\$\s*([\d.]+)\s*\/\s*MTok/i.exec(cell ?? '');
  return m ? Number(m[1]) : null;
};

/** Čita tablicu cijena modela iz Markdowna dokumentacije. Vraća { modelId: {ulaz, pisanje, citanje, izlaz} }. */
export function parsePricingMarkdown(md) {
  const lines = md.split(/\r?\n/);
  const split = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const h = lines.findIndex((l) => /^\s*\|\s*Model\s*\|/i.test(l) && /Base input/i.test(l) && /Output/i.test(l));
  if (h < 0) throw new Error('tablica cijena nije pronađena');
  const head = split(lines[h]).map((c) => c.toLowerCase());
  const col = (re) => head.findIndex((c) => re.test(c));
  const idx = { ulaz: col(/base input/), pisanje: col(/5m cache write/), citanje: col(/cache hit/), izlaz: col(/output/) };
  if (Object.values(idx).some((i) => i < 0)) throw new Error('neočekivani stupci tablice cijena');

  const out = {};
  for (const line of lines.slice(h + 2)) {
    if (!line.trim().startsWith('|')) break;
    const cells = split(line);
    // Za modele s dvije cijene ovisno o duljini upita uzima se osnovna ("up to").
    if (/over [\d,]+ tokens/i.test(cells[0])) continue;
    const id = modelIdFromName(cells[0]);
    const p = Object.fromEntries(Object.entries(idx).map(([k, i]) => [k, price(cells[i])]));
    if (id.startsWith('claude-') && Object.values(p).every((v) => v !== null) && !out[id]) out[id] = p;
  }
  return out;
}

// Provjera prije prihvaćanja: dovoljno modela, uključen model koji aplikacija koristi, razumne vrijednosti.
export function validatePrices(cijene, model = config.model) {
  const entries = Object.entries(cijene);
  if (entries.length < 3) throw new Error('premalo modela u cjeniku');
  if (!cijene[model]) throw new Error(`u cjeniku nema modela ${model}`);
  for (const [id, p] of entries) {
    if (Object.values(p).some((v) => !(v > 0 && v < 1000))) throw new Error(`neispravna cijena za ${id}`);
    if (p.citanje > p.ulaz || p.ulaz > p.izlaz) throw new Error(`nelogične cijene za ${id}`);
  }
  return cijene;
}

function loadSaved() {
  try {
    const saved = JSON.parse(fs.readFileSync(config.pricingFile, 'utf8'));
    state = { ...state, cijene: validatePrices(saved.cijene), dohvaceno: saved.dohvaceno, izvor: saved.izvor, greska: null };
  } catch { /* nema spremljenog cjenika – ostaje ugrađeni */ }
}

export async function refreshPricing({ fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(PRICING_URL, { signal: AbortSignal.timeout(20_000), headers: { 'User-Agent': config.userAgent } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cijene = validatePrices(parsePricingMarkdown(await res.text()));
    state = { cijene, dohvaceno: new Date().toISOString(), izvor: PRICING_URL, greska: null };
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(config.pricingFile, JSON.stringify({ dohvaceno: state.dohvaceno, izvor: state.izvor, cijene }, null, 1));
  } catch (e) {
    state = { ...state, greska: `Osvježavanje cjenika nije uspjelo: ${e.message}` };
  }
  return pricingInfo();
}

let timer;
// Pri pokretanju: učitaj spremljeni cjenik i osvježi ga ako je stariji od jednog dana; zatim svaki dan.
// PRAKSA_PRICING_REFRESH=0 isključuje dohvat s mreže (testovi, rad bez mreže).
export function startPricingUpdates() {
  loadSaved();
  if (process.env.PRAKSA_PRICING_REFRESH === '0') return;
  const age = state.dohvaceno ? Date.now() - Date.parse(state.dohvaceno) : Infinity;
  if (age > REFRESH_MS) refreshPricing();
  clearInterval(timer);
  timer = setInterval(() => refreshPricing(), REFRESH_MS);
  timer.unref();
}

export function pricingInfo() {
  return {
    dohvaceno: state.dohvaceno,
    izvor: state.izvor,
    greska: state.greska,
    model: config.model,
    cijenaModela: priceFor(config.model),
  };
}

export function priceFor(model) {
  const key = Object.keys(state.cijene).sort((a, b) => b.length - a.length).find((k) => model?.startsWith(k));
  return key ? state.cijene[key] : null;
}

export function costOf(model, usage = {}) {
  const p = priceFor(model);
  if (!p) return null;
  return ((usage.input_tokens ?? 0) * p.ulaz
    + (usage.cache_creation_input_tokens ?? 0) * p.pisanje
    + (usage.cache_read_input_tokens ?? 0) * p.citanje
    + (usage.output_tokens ?? 0) * p.izlaz) / 1_000_000;
}

// Zbraja potrošnju svih poziva jedne pretrage; uz rezultat se sprema i datum korištenog cjenika.
export function createCostTracker() {
  // modeli: koji su modeli stvarno odgovorili (uz zamjenski model ili promjenu u Postavkama može ih biti više).
  const t = { pozivi: 0, ulazniTokeni: 0, izlazniTokeni: 0, usd: 0, modeli: [], nepoznatiModeli: [], cjenik: state.dohvaceno ?? state.izvor };
  return {
    add(model, usage = {}) {
      t.pozivi++;
      if (model && !t.modeli.includes(model)) t.modeli.push(model);
      t.ulazniTokeni += (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
      t.izlazniTokeni += usage.output_tokens ?? 0;
      const c = costOf(model, usage);
      if (c === null) { if (!t.nepoznatiModeli.includes(model)) t.nepoznatiModeli.push(model); } else t.usd += c;
    },
    get summary() { return { ...t, usd: Math.round(t.usd * 10000) / 10000 }; },
  };
}
