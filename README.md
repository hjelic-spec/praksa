# Preglednik sudske prakse

Lokalna web-aplikacija za odvjetnički ured: traženje sudske prakse na [odluke.sudovi.hr](https://odluke.sudovi.hr/)
za potrebe obrane u sudskim postupcima. Upit nije samo pojam nego **opis slučaja**, uz neobavezno **stajalište obrane**. Aplikacija:

0. **anonimizira** opis i stajalište lokalno (imena, OIB, adrese, telefoni, e-pošta, registracije, tvrtke) i prije slanja
   prikaže točno što odlazi modelu – ništa se ne šalje bez potvrde;
1. **razradi opis** (Claude): pravna pitanja, ključne činjenice i 3–8 upita za tražilicu (i za odluke u prilog i protiv stajališta);
2. **pretraži** odluke.sudovi.hr (i po želji lokalnu zbirku u `data/corpus`);
3. **dohvati tekst** svake pronađene odluke;
4. **analizira svaku odluku** (Claude): podudara li se s opisanim primjerom (da / djelomično / ne), relevantnost 0–100,
   **ide li u prilog stajalištu ili protiv njega**, kako je iskoristiti odnosno kako joj se suprotstaviti, je li još primjenjiva,
   činjenice, ishod, pravno shvaćanje, doslovni citat; uz to se iz metapodataka računa **težina** (razina suda, pravomoćnost, starost);
5. **provjeri** ono što se može provjeriti bez modela (vidi dolje);
6. **poveže predmete**: odluke koje se međusobno citiraju ili citiraju iste predmete;
7. **poveže s pravom EU**: direktive, uredbe, predmeti Suda EU, Povelja i Ugovori navedeni u odluci;
8. izradi **sintezu prakse**: argumenti u prilog, argumenti protiv i odgovor na njih, prevladavajuće stajalište, razlike u praksi,
   preporuke za daljnje istraživanje;
9. **spremi pretragu u predmet** (`data/predmeti`, izvan gita) zajedno s bilješkama uz odluke, a odabrane odluke
   **izveze u Word** s citatom za podnesak (sud, poslovni broj, datum, ECLI) i doslovnim citatom.

## Povjerljivost

- Anonimizacija je heuristička i može nešto propustiti; zato se uvijek prikazuje tekst koji će biti poslan, a pojmovi se mogu dodati ručno.
  Imena se prepoznaju po velikom početnom slovu, pa se predlažu i nazivi mjesta – isključite što ne treba zamijeniti. Datumi se predlažu, ali nisu uključeni (često su bitni za rokove i zastaru).
- Modelu (Anthropic API) šalju se samo anonimizirani opis i stajalište te tekstovi javno objavljenih odluka. Prema odluke.sudovi.hr idu samo pravni upiti.
- U predmetu se sprema samo poslani (anonimizirani) tekst, rezultati i bilješke. Bilješke ostaju lokalno i ne šalju se nikamo.
- Provjerite uvjete obrade podataka za Anthropic API koji vrijede za vaš račun prije upotrebe na stvarnim predmetima.

## Što je provjereno, a što nije

| Dio | Kako nastaje | Pouzdanost |
|---|---|---|
| Citat iz odluke | model ga predlaže, kod ga traži doslovno u tekstu | označen ✔ ili ⚠ |
| Citirani poslovni brojevi | regularni izraz nad tekstom odluke; povezivanje neovisno o zapisu (`Rev 12/2019-2` = `Rev-12/19`) | iz teksta (heuristika može nešto propustiti ili pogrešno spojiti) |
| Direktive/uredbe → CELEX | regularni izraz + pravila numeracije EU | iz teksta; postojanje se provjerava u CELLAR-u (SPARQL) |
| Predmeti Suda EU (C-…/…) | regularni izraz | iz teksta, poveznica na CURIA |
| „Moguće poveznice s pravom EU“ | prijedlog modela | **pretpostavka**, jasno označena u sučelju |
| Razina suda, pravomoćnost, starost odluke | metapodaci s odluke.sudovi.hr | iz izvora |
| Smjer (u prilog / protiv), „kako iskoristiti“, primjenjivost danas | model | procjena, treba provjeriti |
| Ocjena relevantnosti, sažeci, sinteza | model | treba provjeriti u izvornoj odluci |

Ovo nije pravni savjet.

## Stanje integracije s odluke.sudovi.hr

Provjereno na stvarnoj stranici (`npm run probe`, 14.10.2026.) i upisano u `src/sources/odluke.config.json`:

- pretraga: `GET /Document/DisplayList?q=<upit>` (način `template`); datum odluke `dd_from` / `dd_to`
  u obliku `D.M.YYYY.` (adapter pretvara datume iz sučelja);
- rezultati: poveznice `/Document/View?id=<GUID>` (parametar `q` se uklanja kako se ista odluka pronađena
  različitim upitima ne bi analizirala više puta), 10 po stranici, paginacija `?page=N` (gumb *Next*);
- tekst odluke: `.decision-text`; poslovni broj, sud i ECLI s ploče metapodataka (`.metadata-item[data-metadata-type]`).

Ako se stranica promijeni, ponovno pokrenite i prema ispisu prilagodite konfiguraciju:

```bash
npm run probe -- "naknada nematerijalne štete"
```

Tražilica podržava i druge parametre (vrsta suda `ct`, pojedini sud `os`/`zs`/`ts`/`us`, vrsta odluke `vo`,
poslovni broj `pb`, ECLI `ecli`); u sučelju se pojavljuju kad se dodaju u `filterFields` (i u `FILTER_LABELS` u `public/app.js`).

Ograničenja koja nisu riješena:
- odluke dostupne samo kao PDF/DOC nisu podržane (tekst se ne izvlači);
- uvjeti korištenja i `robots.txt` stranice nisu provjereni – provjerite ih prije šire upotrebe. Adapter šalje najviše jedan zahtjev u 1,5 s i sprema stranice u `data/cache`.

## Pokretanje

Potrebno: Node.js 20+ i Anthropic API ključ.

```bash
npm install
export ANTHROPIC_API_KEY=...
npm start            # http://127.0.0.1:3000
npm test             # testovi logike (bez mreže i bez API-ja)
```

Postavke (varijable okruženja):

| Varijabla | Zadano | Značenje |
|---|---|---|
| `PRAKSA_MODEL` | `claude-opus-5-5` | model |
| `PRAKSA_MAX_DECISIONS` | 15 | najviše odluka po upitu (svaka = jedan API poziv) |
| `PRAKSA_MAX_CHARS` | 150000 | dulje odluke se skraćuju za analizu (prikazuje se oznaka) |
| `PRAKSA_SOURCES` | `odluke,local` | izvori |
| `PRAKSA_MIN_DELAY_MS` | 1500 | razmak između zahtjeva prema istom poslužitelju |
| `PRAKSA_VERIFY_EU` | 1 | `0` isključuje provjeru CELEX-a u CELLAR-u |
| `PRAKSA_USER_AGENT` | … | upišite kontakt kako bi vas operater stranice mogao kontaktirati |

Troškovi: jedan upit = 1 poziv za razradu + do `PRAKSA_MAX_DECISIONS` poziva za analizu + 1 za sintezu.
Duge odluke znače mnogo ulaznih tokena; prije veće upotrebe izmjerite potrošnju na nekoliko upita.

Za zahtjeve odbijene od sigurnosnih klasifikatora uključen je poslužiteljski `fallbacks: "default"`
(beta `server-side-fallback-2026-07-01`) – zahtjev se tada automatski ponovi na preporučenom zamjenskom modelu.

## Lokalna zbirka

Odluke spremljene kao `.txt`, `.md` ili `.html` u `data/corpus/` pretražuju se zajedno s online izvorom
(korisno za odluke s portala Vrhovnog suda ili za rad bez mreže).

## Struktura

```
src/server.js            HTTP poslužitelj i API (/api/upit, /api/anonimizacija, /api/predmeti…)
src/pipeline.js          tijek obrade, provjere, povezivanje predmeta
src/llm.js               pozivi Claude API-ja sa strukturiranim izlazom
src/anonymize.js         lokalna anonimizacija opisa i stajališta
src/authority.js         težina odluke: razina suda, pravomoćnost, starost
src/store.js             spremanje predmeta u data/predmeti
src/export.js            izvoz odabranih odluka u .docx
src/extract.js           regex ekstrakcija: poslovni brojevi, ECLI, EU akti → CELEX, provjera citata
src/eu.js                provjera CELEX-a u CELLAR SPARQL endpointu
src/sources/odluke.js    adapter za odluke.sudovi.hr (+ odluke.config.json)
src/sources/local.js     lokalna zbirka
scripts/probe-odluke.js  ispitivanje stvarne strukture stranice
public/                  sučelje
```
