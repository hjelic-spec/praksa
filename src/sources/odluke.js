// Izvor: javna tražilica odluka sudova RH (https://odluke.sudovi.hr).
//
// Struktura stranice provjerena je `npm run probe` (14.10.2026.) i upisana u
// odluke.config.json. Ako se stranica promijeni, adapter se može vratiti na općenite načine:
//   1) u načinu "auto-form" sam pročita obrazac s AdvancedSearch stranice (uključujući
//      skrivena polja poput anti-forgery tokena) i upiše upit u tekstualno polje;
//   2) rezultate prepoznaje heuristikom ako results.linkPattern nije zadan;
//   3) tekst odluke uzima iz decision.textSelector ili, ako nije zadan, iz cijele
//      stranice bez navigacije/skripti.
// Sve to se može precizno namjestiti u odluke.config.json nakon `npm run probe`.
import * as cheerio from 'cheerio';
import { config } from '../config.js';
import { fetchText } from '../http.js';
import { extractCaseNumbers, extractEcli, normalizeWs } from '../extract.js';

const cfg = () => config.odluke;
const abs = (href, base) => new URL(href, base).toString();

export function pickSearchForm(html, pageUrl) {
  const $ = cheerio.load(html);
  let best = null;
  $('form').each((_, form) => {
    const $f = $(form);
    const textInputs = $f.find('input[type=text], input[type=search], input:not([type])');
    if (!textInputs.length) return;
    const score = $f.find('input, select, textarea').length;
    if (!best || score > best.score) best = { $f, score };
  });
  if (!best) return null;
  const { $f } = best;
  const fields = [];
  $f.find('input, select, textarea').each((_, el) => {
    const $el = $(el);
    const name = $el.attr('name');
    if (!name) return;
    const type = (el.tagName === 'input' ? $el.attr('type') ?? 'text' : el.tagName).toLowerCase();
    if (['submit', 'button', 'image', 'reset', 'file'].includes(type)) return;
    if ((type === 'checkbox' || type === 'radio') && $el.attr('checked') === undefined) return;
    let value = $el.attr('value') ?? '';
    if (type === 'select') value = $el.find('option[selected]').attr('value') ?? $el.find('option').first().attr('value') ?? '';
    if (type === 'textarea') value = $el.text();
    const options = type === 'select'
      ? $el.find('option').map((__, o) => ({ value: $(o).attr('value') ?? '', label: normalizeWs($(o).text()) })).get()
      : undefined;
    const label = normalizeWs($(`label[for="${$el.attr('id')}"]`).text()) || $el.attr('placeholder') || '';
    fields.push({ name, type, value, label, options });
  });
  return {
    action: abs($f.attr('action') || pageUrl, pageUrl),
    method: ($f.attr('method') || 'GET').toUpperCase(),
    fields,
  };
}

function isResultLink(href, searchUrl) {
  const pattern = cfg().results.linkPattern;
  if (pattern) return new RegExp(pattern).test(href);
  // Heuristika: poveznica na isti host, pod /Document/, s identifikatorom, a nije sama tražilica.
  try {
    const u = new URL(href);
    const s = new URL(searchUrl);
    if (u.host !== s.host || !/\/Document\//i.test(u.pathname)) return false;
    if (/Search|Result|List|Index/i.test(u.pathname) || /[?&](page|stranica|p)=/i.test(u.search)) return false; // tražilica i paginacija
    return /\d/.test(u.search) || /\d/.test(u.pathname);
  } catch {
    return false;
  }
}

// Rezultati pretrage na odluke.sudovi.hr vode na /Document/View?id=<GUID>, često s dodanim
// "&q=<upit>" (vidljivo u javno indeksiranim poveznicama). Bez uklanjanja tog parametra ista
// bi odluka pronađena različitim upitima bila dohvaćena i analizirana više puta.
export function canonicalDecisionUrl(href) {
  try {
    const u = new URL(href);
    const id = u.searchParams.get('id');
    if (/\/Document\/View$/i.test(u.pathname) && id) return `${u.origin}${u.pathname}?id=${encodeURIComponent(id)}`;
    u.searchParams.delete('q');
    return u.toString();
  } catch {
    return href;
  }
}

export function parseResults(html, pageUrl) {
  const $ = cheerio.load(html);
  const seen = new Map();
  $('a[href]').each((_, a) => {
    const raw = abs($(a).attr('href'), pageUrl);
    if (!isResultLink(raw, pageUrl)) return;
    const href = canonicalDecisionUrl(raw);
    if (seen.has(href)) return;
    const row = $(a).closest('tr, li, article, .row, div');
    seen.set(href, {
      url: href,
      naslov: normalizeWs($(a).text()) || href,
      isjecak: normalizeWs(row.text()).slice(0, 400),
    });
  });
  let next = null;
  const sel = cfg().results.nextPageSelector;
  const $next = sel ? $(sel).first() : $('a[href]').filter((_, a) => /^(sljedeća|sljedeca|next|»|›|>)$/i.test(normalizeWs($(a).text()))).first();
  if ($next.length && $next.attr('href')) next = abs($next.attr('href'), pageUrl);
  return { results: [...seen.values()], next };
}

export function supportedFilters() {
  const f = cfg().search.filterFields;
  return Object.keys(f).filter((k) => f[k]);
}

// Sučelje šalje datume kao YYYY-MM-DD (<input type="date">), a tražilica ih očekuje u
// obliku D.M.YYYY. (format daterangepickera na stranici).
export function siteDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? `${Number(m[3])}.${Number(m[2])}.${m[1]}.` : value;
}

export async function firstPage(query, filters) {
  const c = cfg();
  const searchPage = c.baseUrl + c.searchPagePath;
  const params = { ...c.search.extraParams };
  for (const [k, field] of Object.entries(c.search.filterFields)) {
    if (field && filters?.[k]) params[field] = siteDate(filters[k]);
  }

  if (c.search.mode === 'template') {
    if (!c.search.template) throw new Error('odluke.config.json: search.template nije postavljen');
    const url = new URL(c.search.template.replace('{q}', encodeURIComponent(query)), c.baseUrl);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return { html: await fetchText(url.toString()), url: url.toString() };
  }

  const pageHtml = await fetchText(searchPage, { useCache: false });
  const form = pickSearchForm(pageHtml, searchPage);
  if (!form) throw new Error('Na stranici za napredno pretraživanje nije pronađen obrazac s tekstualnim poljem. Pokrenite `npm run probe`.');
  const qField = c.search.queryField
    ?? form.fields.find((f) => f.type === 'text' || f.type === 'search')?.name;
  if (!qField) throw new Error('Nije moguće odrediti polje za upit. Postavite search.queryField u odluke.config.json.');

  const body = new URLSearchParams();
  for (const f of form.fields) body.append(f.name, f.value);
  body.set(qField, query);
  for (const [k, v] of Object.entries(params)) body.set(k, v);

  if (form.method === 'POST') {
    return { html: await fetchText(form.action, { method: 'POST', body: body.toString(), useCache: false }), url: form.action };
  }
  const url = new URL(form.action);
  for (const [k, v] of body) url.searchParams.append(k, v);
  return { html: await fetchText(url.toString()), url: url.toString() };
}

export async function search(query, { filters, limit = 20 } = {}) {
  let { html, url } = await firstPage(query, filters);
  const out = [];
  for (let page = 0; page < cfg().results.maxPages; page++) {
    const { results, next } = parseResults(html, url);
    out.push(...results);
    if (out.length >= limit || !next) break;
    url = next;
    html = await fetchText(next);
  }
  return out.slice(0, limit).map((r) => ({ ...r, izvor: 'odluke.sudovi.hr' }));
}

const COURT_RE = /(Vrhovni sud Republike Hrvatske|Ustavni sud Republike Hrvatske|Visoki trgovački sud Republike Hrvatske|Visoki upravni sud Republike Hrvatske|Visoki prekršajni sud Republike Hrvatske|Visoki kazneni sud Republike Hrvatske|Županijski sud u [A-ZČĆŠŽĐ][\p{L}]+(?: [A-ZČĆŠŽĐ][\p{L}]+)?|Općinski (?:građanski |kazneni |radni )?sud u [A-ZČĆŠŽĐ][\p{L}]+(?: [A-ZČĆŠŽĐ][\p{L}]+)?|Trgovački sud u [A-ZČĆŠŽĐ][\p{L}]+|Upravni sud u [A-ZČĆŠŽĐ][\p{L}]+)/u;

export function metadataFromText(text) {
  const head = text.slice(0, 3000);
  return {
    poslovniBroj: extractCaseNumbers(head)[0] ?? null,
    ecli: extractEcli(head).find((e) => e.startsWith('ECLI:HR')) ?? null,
    sud: head.match(COURT_RE)?.[0] ?? null,
  };
}

// Metapodaci s ploče odluke (.metadata-item[data-metadata-type]); pouzdaniji od teksta,
// a ECLI se često nalazi samo ondje.
export function metadataFromHtml(html) {
  const $ = cheerio.load(html);
  const get = (type) => normalizeWs($(`.metadata-item[data-metadata-type="${type}"] .metadata-content`).first().text()) || null;
  return {
    poslovniBroj: get('decision-number'),
    ecli: get('ecli-number'),
    sud: get('court'),
    datum: get('decision-date'),
    pravomocnost: get('decision-finality'),
    vrsta: get('decision-type'),
  };
}

export function decisionTextFromHtml(html) {
  const $ = cheerio.load(html);
  const sel = cfg().decision.textSelector;
  const $root = sel && $(sel).length ? $(sel).first() : $('body');
  $root.find('script, style, noscript, nav, header, footer, form, iframe').remove();
  // Zadrži prijelome odlomaka radi čitljivosti citata.
  $root.find('p, br, div, li, tr, h1, h2, h3, h4').each((_, el) => { $(el).append('\n'); });
  return $root.text().replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
}

export async function fetchDecision(ref) {
  const html = await fetchText(ref.url);
  const tekst = decisionTextFromHtml(html);
  const fromText = metadataFromText(tekst);
  const fromHtml = metadataFromHtml(html);
  const meta = Object.fromEntries([...new Set([...Object.keys(fromText), ...Object.keys(fromHtml)])]
    .map((k) => [k, fromHtml[k] ?? fromText[k] ?? null]));
  return { ...ref, tekst, meta };
}
