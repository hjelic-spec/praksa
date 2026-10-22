// Povezivanje predmeta među pronađenim odlukama (bez modela): odluke koje se
// međusobno citiraju ili citiraju iste predmete. Koriste ga web aplikacija i skill.
import { caseKey } from './extract.js';

export function uniqueByCaseKey(caseNos) {
  const seen = new Map();
  for (const c of caseNos) if (!seen.has(caseKey(c))) seen.set(caseKey(c), c);
  return [...seen.values()];
}

export function linkRelated(items) {
  // Poslovni brojevi uspoređuju se po ključu (caseKey) jer ista oznaka u tekstovima
  // dolazi u različitim zapisima ("Rev 12/2019-2", "Rev-12/19").
  const byKey = new Map(items.filter((d) => d.meta?.poslovniBroj).map((d) => [caseKey(d.meta.poslovniBroj), d]));
  const label = (d) => d.meta?.poslovniBroj ?? d.naslov;
  for (const d of items) {
    d.povezaniURezultatima = [];
    for (const c of d.citiraniPredmeti) {
      const other = byKey.get(caseKey(c));
      if (other && other !== d && !d.povezaniURezultatima.some((r) => r.url === other.url)) {
        d.povezaniURezultatima.push({ poslovniBroj: label(other), url: other.url, odnos: 'citira' });
      }
    }
  }
  for (const d of items) {
    for (const rel of d.povezaniURezultatima.filter((r) => r.odnos === 'citira')) {
      const other = items.find((x) => x.url === rel.url);
      if (other && !other.povezaniURezultatima.some((r) => r.url === d.url)) {
        other.povezaniURezultatima.push({ poslovniBroj: label(d), url: d.url, odnos: 'citiran u' });
      }
    }
  }
  // Odluke koje citiraju iste predmete
  const keysOf = new Map(items.map((d) => [d, new Map(d.citiraniPredmeti.map((c) => [caseKey(c), c]))]));
  for (const a of items) {
    for (const b of items) {
      if (a === b) continue;
      const kb = keysOf.get(b);
      const shared = [...keysOf.get(a)].filter(([k]) => kb.has(k)).map(([, c]) => c);
      if (shared.length && !a.povezaniURezultatima.some((r) => r.url === b.url)) {
        a.povezaniURezultatima.push({ poslovniBroj: label(b), url: b.url, odnos: `isti citirani predmeti: ${shared.join(', ')}` });
      }
    }
  }
  return items;
}
