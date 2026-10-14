// Deterministička (regex) ekstrakcija referenci iz teksta odluke.
// Sve što se ovdje izvuče stvarno postoji u tekstu odluke – to je "provjereni" sloj,
// za razliku od prijedloga jezičnog modela koji se u sučelju označavaju kao neprovjereni.

const LOWER = 'a-zčćšžđ';
const UPPER = 'A-ZČĆŠŽĐ';

// Poslovni brojevi hrvatskih sudova, npr. "Rev 1234/2019-2", "Gž-123/18", "Us I-45/2020", "U-III-1234/2018".
// Heuristika: može propustiti neobične oznake ili uhvatiti lažno pozitivne nizove.
const CASE_NO_RE = new RegExp(
  String.raw`(?<![\w/])(U-[IVX]+[A-Z]?-\d{1,6}\/\d{2,4}|[${UPPER}][${LOWER}]{0,4}(?:[- ][${LOWER}${UPPER}]{1,4})?[- ]\d{1,6}\/\d{2,4}(?:-\d{1,3})?)(?![\w/])`,
  'gu',
);

// ECLI je standardiziran: ECLI:<država>:<sud>:<godina>:<broj>
const ECLI_RE = /ECLI:([A-Z]{2}|EU):[A-Z0-9.]{1,7}:\d{4}:[A-Z0-9.]{1,25}/g;

// Predmeti Suda EU / Općeg suda: C-415/11, T-123/19
const CJEU_CASE_RE = /(?<![\w/])([CT])-(\d{1,4})\/(\d{2})(?![\w/])/g;

export function normalizeWs(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

export function extractCaseNumbers(text) {
  const out = new Set();
  for (const m of normalizeWs(text).matchAll(CASE_NO_RE)) {
    const v = m[1];
    if (/^[CT]-\d{1,4}\/\d{2}$/.test(v)) continue; // to je predmet Suda EU, ne hrvatski
    out.add(v);
  }
  return [...out];
}

export function extractEcli(text) {
  const found = (normalizeWs(text).match(ECLI_RE) ?? []).map((e) => e.replace(/\.+$/, ''));
  return [...new Set(found)];
}

export function extractCjeuCases(text) {
  const out = new Map();
  for (const m of normalizeWs(text).matchAll(CJEU_CASE_RE)) {
    const id = `${m[1]}-${m[2]}/${m[3]}`;
    out.set(id, {
      vrsta: 'predmet_sud_eu',
      oznaka: id,
      url: `https://curia.europa.eu/juris/liste.jsf?num=${encodeURIComponent(id)}&language=hr`,
    });
  }
  return [...out.values()];
}

function fullYear(y) {
  if (y.length === 4) return y;
  const n = Number(y);
  return String(n > 50 ? 1900 + n : 2000 + n);
}

function celex(year, typeLetter, number) {
  return `3${year}${typeLetter}${String(number).padStart(4, '0')}`;
}

function docTypeBefore(text, index) {
  const window = text.slice(Math.max(0, index - 120), index);
  const d = window.lastIndexOf('irektiv');
  const r = window.lastIndexOf('redb'); // Uredba, Uredbe, Uredbom...
  if (d === -1 && r === -1) return null;
  return d > r ? 'L' : 'R';
}

export function eurLexUrl(celexId) {
  return `https://eur-lex.europa.eu/legal-content/HR/TXT/?uri=CELEX:${celexId}`;
}

// Izvlači direktive i uredbe EU iz hrvatskog teksta i pretvara ih u CELEX broj.
// Podržani oblici:
//   "Direktiva 2011/83/EU", "Direktive Vijeća 93/13/EEZ"         -> godina/broj/sufiks
//   "Uredba (EU) 2016/679", "Direktiva (EU) 2019/1937"           -> (EU) godina/broj
//   "Uredba (EZ) br. 261/2004"                                   -> (EZ) br. broj/godina
export function extractEuActs(text) {
  const t = normalizeWs(text);
  const out = new Map();
  const add = (type, year, number, raw) => {
    if (!type) return;
    const id = celex(year, type, number);
    out.set(id, {
      vrsta: type === 'L' ? 'direktiva' : 'uredba',
      oznaka: raw,
      celex: id,
      url: eurLexUrl(id),
    });
  };

  // Novi oblik (od 2015.) i stari oblik uredbi s "br."
  const paren = /\((EU|EZ|EEZ|Euratom|EU, Euratom)\)\s*(br\.\s*)?(\d{1,4})\/(\d{2,4})/g;
  for (const m of t.matchAll(paren)) {
    const type = docTypeBefore(t, m.index + 1);
    const [a, b] = [m[3], m[4]];
    if (m[2]) add(type, fullYear(b), a, m[0]); // br. broj/godina
    else if (a.length === 4) add(type, a, b, m[0]); // godina/broj
  }

  // Stari oblik direktiva: 93/13/EEZ, 2011/83/EU
  const slash = /(?<![\w/])(\d{2}|\d{4})\/(\d{1,4})\/(EU|EZ|EEZ|EZČ|Euratom)(?![\w])/g;
  for (const m of t.matchAll(slash)) {
    const type = docTypeBefore(t, m.index + 1) ?? 'L';
    add(type, fullYear(m[1]), m[2], m[0]);
  }
  return [...out.values()];
}

const TREATY_PATTERNS = [
  { re: /Povelj\p{L}* Europske unije o temeljnim pravima/u, naziv: 'Povelja Europske unije o temeljnim pravima', celex: '12016P/TXT' },
  { re: /Ugovor\p{L}* o funkcioniranju Europske unije|\bUFEU\b/u, naziv: 'Ugovor o funkcioniranju Europske unije (UFEU)', celex: '12016E/TXT' },
  { re: /Ugovor\p{L}* o Europskoj uniji|\bUEU\b/u, naziv: 'Ugovor o Europskoj uniji (UEU)', celex: '12016M/TXT' },
];

const ECHR_RE = /Konvencij\p{L}* za zaštitu ljudskih prava i temeljnih sloboda|Europsk\p{L}* sud\p{L}* za ljudska prava|\bESLJP\b/u;

export function extractEuReferences(text) {
  const t = normalizeWs(text);
  const refs = [...extractEuActs(t), ...extractCjeuCases(t)];
  for (const p of TREATY_PATTERNS) {
    if (p.re.test(t)) refs.push({ vrsta: 'ugovor_povelja', oznaka: p.naziv, celex: p.celex, url: eurLexUrl(p.celex) });
  }
  for (const e of extractEcli(t)) {
    if (e.startsWith('ECLI:EU:')) refs.push({ vrsta: 'ecli_eu', oznaka: e });
  }
  // EKLJP nije pravo EU, ali je često povezan pa se prikazuje odvojeno.
  const echr = ECHR_RE.test(t);
  return { eu: refs, ekljp: echr };
}

// Provjera da citat koji je predložio model doslovno postoji u tekstu odluke.
export function quoteInText(quote, text) {
  const q = normalizeWs(quote).toLowerCase().replace(/[„“"”'‘’]/g, '');
  if (q.length < 15) return false;
  const t = normalizeWs(text).toLowerCase().replace(/[„“"”'‘’]/g, '');
  return t.includes(q);
}
