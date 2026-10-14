// Lokalna anonimizacija opisa slučaja prije slanja modelu. Ništa se ne šalje van:
// prepoznavanje je heurističko (regularni izrazi), a korisnik prije slanja vidi i
// potvrđuje svaku zamjenu te može dodati vlastite pojmove.
//
// Imena se prepoznaju po velikom početnom slovu usred rečenice (hrvatski piše mjesece,
// dane i opće pojmove malim slovom), pa heuristika predlaže i nazive mjesta i ustanova;
// korisnik isključi ono što ne treba zamijeniti.

const L = '\\p{Lu}';
const W = "[\\p{L}'’-]";

// Riječi s velikim slovom koje nisu osobni podaci (sudovi, propisi, institucije).
const STOP = new Set(`republika republike republici hrvatska hrvatske hrvatskoj europska europske europskoj unija unije uniji
vrhovni vrhovnog vrhovnom ustavni ustavnog ustavnom županijski županijskog županijskom općinski općinskog općinskom
trgovački trgovačkog trgovačkom upravni upravnog upravnom visoki visokog visokom prekršajni prekršajnog kazneni kaznenog
građanski građanskog radni radnog sud suda sudu zakon zakona zakonu zakonom kazneni ugovor ugovora povelja povelje konvencija
konvencije uredba uredbe direktiva direktive grad grada gradu država državno državni državnog odvjetništvo odvjetništva
ministarstvo ministarstva policija policije policijska policijske ured ureda centar centra hzzo hzmo fina porezna porezne uprava uprave
tužitelj tužitelja tužiteljica tuženik tuženika tuženica okrivljenik okrivljenika okrivljenica oštećenik oštećenika oštećena
klijent klijenta klijentica stranka stranke`.split(/\s+/));

// Riječi na početku rečenice koje nikad nisu ime (da "Klijent Horvat" ne bude jedno ime).
const isStop = (w) => STOP.has(w.toLowerCase()) || /^[\p{Lu}\d]{2,6}$/u.test(w); // kratice: ZOO, ZKP, KZ, EU

const DETECTORS = [
  { tip: 'OIB', oznaka: 'OIB', re: /(?<!\d)\d{11}(?!\d)/g },
  { tip: 'IBAN', oznaka: 'IBAN', re: /\bHR\d{2}(?:\s?\d{4}){4}\s?\d\b/g },
  { tip: 'e-pošta', oznaka: 'EMAIL', re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g },
  { tip: 'telefon', oznaka: 'TELEFON', re: /(?:\+385|(?<!\d)0)[\s/-]?\d{1,2}[\s/-]?\d{3}[\s/-]?\d{3,4}(?!\d)/g },
  { tip: 'registracija', oznaka: 'REGISTRACIJA', re: /\b[A-ZČŠŽ]{2}[\s-]?\d{3,4}[\s-]?[A-Z]{1,2}\b/g },
  {
    tip: 'adresa', oznaka: 'ADRESA',
    re: new RegExp(`(?<!\\p{L})(?:[Uu]l\\.|[Uu]lic[aie]|[Tt]rg[u]?|[Cc]est[aei]|[Aa]venij[aie])\\s+(?:${W}+\\.?\\s+){0,4}?\\d+[a-zA-Z]?(?![\\p{L}\\d])`, 'gu'),
  },
  {
    tip: 'tvrtka', oznaka: 'TVRTKA',
    re: new RegExp(`(?:${L}${W}*\\s+){1,4}(?:d\\.o\\.o\\.|j\\.d\\.o\\.o\\.|d\\.d\\.|obrt)`, 'gu'),
  },
  // Datumi su često bitni za ocjenu (zastara, rokovi), pa se predlažu, ali nisu uključeni.
  { tip: 'datum', oznaka: 'DATUM', re: /(?<!\d)\d{1,2}\.\s?\d{1,2}\.\s?\d{4}\.?/g, ukljuceno: false },
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Oblici istog imena u različitim padežima ("Horvat", "Horvata", "Horvatu"; "Marko", "Marka").
function sameName(a, b) {
  const wa = a.toLowerCase().split(/\s+/);
  const wb = b.toLowerCase().split(/\s+/);
  if (wa.length !== wb.length) return false;
  return wa.every((x, i) => {
    const y = wb[i];
    let p = 0;
    while (p < x.length && p < y.length && x[p] === y[p]) p++;
    return p >= 3 && p >= Math.min(x.length, y.length) - 1 && Math.abs(x.length - y.length) <= 3;
  });
}

// Isto ime u drugom padežu, ili samo prezime/ime osobe već prepoznate punim imenom.
function relatedName(a, b) {
  if (sameName(a, b)) return true;
  const [short, long] = a.split(/\s+/).length < b.split(/\s+/).length ? [a, b] : [b, a];
  return short.split(/\s+/).length === 1 && long.split(/\s+/).some((w) => sameName(w, short));
}

// text: tekst s prikrivenim već prepoznatim dijelovima; original: isti tekst bez prikrivanja
// (za prepoznavanje početka rečenice, npr. iza "d.o.o.").
function nameCandidates(text, original, taken) {
  const out = [];
  const dropped = [];
  const re = new RegExp(`${L}${W}+(?:\\s+${L}${W}+){0,2}`, 'gu');
  for (const m of text.matchAll(re)) {
    let words = m[0].split(/\s+/);
    const before = original.slice(0, m.index).trimEnd();
    // Prva riječ rečenice piše se velikim slovom bez obzira na to je li ime ("Prema Horvatu…"),
    // pa se preskače; ako je ime, uhvatit će se na drugom mjestu ili ga korisnik doda ručno.
    if (before === '' || /[.!?:;"„“(]$/.test(before) || /\n\s*$/.test(original.slice(0, m.index))) {
      if (!isStop(words[0])) dropped.push(words[0]);
      words = words.slice(1);
    }
    // Uzastopne riječi koje nisu stop-riječi čine jedno ime.
    let run = [];
    for (const w of [...words, null]) {
      if (w && !isStop(w)) { run.push(w); continue; }
      const value = run.join(' ');
      if (value && !taken(value) && !out.includes(value)) out.push(value);
      run = [];
    }
  }
  return { names: out, dropped };
}

/**
 * Prepoznaje osjetljive podatke u jednom ili više tekstova (zajednička numeracija oznaka).
 * @param {string[]} texts
 * @param {{dodatni?: string[], iskljuceno?: string[], ukljuceno?: string[]}} opts
 *   dodatni: pojmovi koje korisnik ručno dodaje; iskljuceno/ukljuceno: oznake koje korisnik mijenja
 * @returns {{oznaka:string, tip:string, oblici:string[], ukljuceno:boolean}[]}
 */
export function detectSensitive(texts, { dodatni = [], iskljuceno = [], ukljuceno = [] } = {}) {
  const all = texts.join('\n');
  const items = [];
  const counters = {};
  const used = []; // [start, end) već prepoznatih dijelova
  const overlaps = (s, e) => used.some(([a, b]) => s < b && e > a);
  const add = (tip, oznakaBase, value, defaultOn = true) => {
    const existing = items.find((i) => i.tip === tip && (i.oblici.includes(value) || (tip === 'ime/naziv' && i.oblici.some((o) => relatedName(o, value)))));
    if (existing) {
      if (!existing.oblici.includes(value)) existing.oblici.push(value);
      return;
    }
    counters[oznakaBase] = (counters[oznakaBase] ?? 0) + 1;
    items.push({ oznaka: `${oznakaBase}_${counters[oznakaBase]}`, tip, oblici: [value], ukljuceno: defaultOn });
  };

  for (const term of dodatni.map((t) => t.trim()).filter(Boolean)) {
    add('ručno', 'POJAM', term);
    for (const m of all.matchAll(new RegExp(escapeRe(term), 'giu'))) used.push([m.index, m.index + m[0].length]);
  }
  for (const d of DETECTORS) {
    for (const m of all.matchAll(d.re)) {
      const value = m[0].trim();
      if (overlaps(m.index, m.index + m[0].length)) continue;
      used.push([m.index, m.index + m[0].length]);
      add(d.tip, d.oznaka, value, d.ukljuceno ?? true);
    }
  }
  const masked = [...all].map((c, i) => (used.some(([a, b]) => i >= a && i < b) ? ' ' : c)).join('');
  const taken = (v) => items.some((i) => i.oblici.includes(v));
  const { names, dropped } = nameCandidates(masked, all, taken);
  for (const name of names) add('ime/naziv', 'OSOBA', name);
  // Prva riječ rečenice ("Horvat nije bio prisutan") zamjenjuje se ako je oblik već prepoznatog imena.
  for (const w of dropped) {
    if (!taken(w) && items.some((i) => i.tip === 'ime/naziv' && i.oblici.some((o) => relatedName(o, w)))) add('ime/naziv', 'OSOBA', w);
  }

  for (const i of items) {
    if (iskljuceno.includes(i.oznaka)) i.ukljuceno = false;
    if (ukljuceno.includes(i.oznaka)) i.ukljuceno = true;
  }
  return items;
}

export function applyReplacements(text, items) {
  const pairs = items.filter((i) => i.ukljuceno)
    .flatMap((i) => i.oblici.map((o) => [o, i.oznaka]))
    .sort((a, b) => b[0].length - a[0].length);
  let out = text;
  for (const [form, label] of pairs) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\d])${escapeRe(form)}(?![\\p{L}\\d])`, 'giu'), label);
  }
  return out;
}

export function anonymize({ opis = '', stajaliste = '' }, opts = {}) {
  const stavke = detectSensitive([opis, stajaliste], opts);
  return { stavke, opis: applyReplacements(opis, stavke), stajaliste: applyReplacements(stajaliste, stavke) };
}
