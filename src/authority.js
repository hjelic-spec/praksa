// Težina odluke izračunata iz metapodataka (bez modela): razina suda, pravomoćnost i starost.

const LEVELS = [
  [/^Ustavni sud/i, 1, 'Ustavni sud'],
  [/^Vrhovni sud/i, 1, 'Vrhovni sud'],
  [/^Visoki/i, 2, 'visoki sud'],
  [/^Županijski sud/i, 3, 'županijski sud'],
  [/^(Općinski|Trgovački|Upravni) /i, 4, 'prvostupanjski sud'],
];

// Odluke starije od ovoga označavaju se: propisi i praksa su se mogli promijeniti.
export const OLD_YEARS = 15;

export function parseHrDate(s) {
  const m = /(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})/.exec(s ?? '');
  return m ? new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]))) : null;
}

export function weigh(meta = {}, now = new Date()) {
  const level = LEVELS.find(([re]) => re.test(meta.sud ?? ''));
  const date = parseHrDate(meta.datum);
  const godina = date ? date.getUTCFullYear() : null;
  const starost = date ? Math.floor((now - date) / (365.25 * 24 * 3600 * 1000)) : null;
  return {
    razina: level?.[1] ?? null, // 1 = najviši sud
    razinaOznaka: level?.[2] ?? null,
    pravomocna: meta.pravomocnost ? /^pravomoćn/i.test(meta.pravomocnost) : null,
    godina,
    starost,
    stara: starost !== null && starost > OLD_YEARS,
  };
}
