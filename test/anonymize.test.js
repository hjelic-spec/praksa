import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anonymize } from '../src/anonymize.js';

const OPIS = 'Klijent Ivan Horvat (OIB 12345678901), Ulica grada Vukovara 12, optužen je da je 3.5.2025. udario Marka Kovača. ' +
  'Policija je bez naloga pretražila Horvatov stan. Prema Horvatu, svjedok Ana Babić nije bila prisutna. ' +
  'Vozilo ZG 1234 AB, tel. 091 234 5678, ivan@mail.hr. Radi u Unikom d.o.o. Pozvat ćemo se na čl. 10. ZKP-a i praksu Vrhovnog suda Republike Hrvatske.';

test('anonimizacija: prepoznati podaci i dosljedne oznake', () => {
  const r = anonymize({ opis: OPIS, stajaliste: 'Pretraga Horvatova stana je nezakonita.' });
  for (const leak of ['Horvat', '12345678901', 'Vukovara', 'Kovača', 'Babić', 'ZG 1234 AB', '091 234 5678', 'ivan@mail.hr', 'Unikom']) {
    assert.ok(!r.opis.includes(leak), `u opisu ostalo: ${leak}`);
  }
  const osoba = r.stavke.find((s) => s.oblici.includes('Ivan Horvat'));
  assert.ok(osoba.oblici.includes('Horvatu') && osoba.oblici.includes('Horvatov'), 'padeži prezimena uz puno ime');
  assert.match(r.stajaliste, new RegExp(`Pretraga ${osoba.oznaka} stana`), 'ista oznaka u stajalištu');
  assert.ok(r.opis.includes('Vrhovnog suda Republike Hrvatske') && r.opis.includes('ZKP-a') && r.opis.includes('Policija'), 'institucije i kratice ostaju');
  assert.ok(!r.stavke.some((s) => s.oblici.includes('Pozvat')), 'prva riječ rečenice iza "d.o.o." nije ime');
});

test('anonimizacija: datum se predlaže, ali nije uključen; korisnik mijenja i dodaje', () => {
  const r = anonymize({ opis: OPIS });
  const datum = r.stavke.find((s) => s.tip === 'datum');
  assert.equal(datum.ukljuceno, false);
  assert.ok(r.opis.includes('3.5.2025.'));

  const r2 = anonymize({ opis: OPIS }, { ukljuceno: [datum.oznaka], dodatni: ['Zagreb'], iskljuceno: ['OIB_1'] });
  assert.ok(!r2.opis.includes('3.5.2025.'));
  assert.ok(r2.opis.includes('12345678901'), 'korisnik je isključio OIB');
  assert.ok(r2.stavke.some((s) => s.tip === 'ručno' && s.oblici.includes('Zagreb')));
});

test('anonimizacija: prezime na početku rečenice i adresa bez sljedeće riječi', () => {
  const r = anonymize({ opis: 'Policija je pretražila stan Ivana Horvata u Ulici grada Vukovara 12 u Zagrebu. Horvat nije bio prisutan.' });
  assert.ok(!/Horvat/.test(r.opis), r.opis);
  assert.match(r.opis, /ADRESA_1 u /);
});
