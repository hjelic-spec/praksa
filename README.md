# Preglednik sudske prakse

Lokalna web-aplikacija za pretraživanje odluka hrvatskih sudova s [odluke.sudovi.hr](https://odluke.sudovi.hr/).
Upit nije samo pojam nego **opis primjera ili događaja**. Aplikacija:

1. **razradi opis** (Claude): pravna pitanja, ključne činjenice i 3–8 upita za tražilicu sročenih pravnom terminologijom;
2. **pretraži** odluke.sudovi.hr (i po želji lokalnu zbirku u `data/corpus`);
3. **dohvati tekst** svake pronađene odluke;
4. **analizira svaku odluku** (Claude): podudara li se s opisanim primjerom (da / djelomično / ne), relevantnost 0–100,
   činjenice, ishod, pravno shvaćanje, zašto je odluka važna, doslovni citat;
5. **provjeri** ono što se može provjeriti bez modela (vidi dolje);
6. **poveže predmete**: odluke koje se međusobno citiraju ili citiraju iste predmete;
7. **poveže s pravom EU**: direktive, uredbe, predmeti Suda EU, Povelja i Ugovori navedeni u odluci;
8. izradi **sintezu prakse**: prevladavajuće stajalište, razlike u praksi, preporuke za daljnje istraživanje.

## Što je provjereno, a što nije

| Dio | Kako nastaje | Pouzdanost |
|---|---|---|
| Citat iz odluke | model ga predlaže, kod ga traži doslovno u tekstu | označen ✔ ili ⚠ |
| Citirani poslovni brojevi | regularni izraz nad tekstom odluke; povezivanje neovisno o zapisu (`Rev 12/2019-2` = `Rev-12/19`) | iz teksta (heuristika može nešto propustiti ili pogrešno spojiti) |
| Direktive/uredbe → CELEX | regularni izraz + pravila numeracije EU | iz teksta; postojanje se provjerava u CELLAR-u (SPARQL) |
| Predmeti Suda EU (C-…/…) | regularni izraz | iz teksta, poveznica na CURIA |
| „Moguće poveznice s pravom EU“ | prijedlog modela | **pretpostavka**, jasno označena u sučelju |
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
src/server.js            HTTP poslužitelj i API (/api/info, /api/upit)
src/pipeline.js          tijek obrade, provjere, povezivanje predmeta
src/llm.js               pozivi Claude API-ja sa strukturiranim izlazom
src/extract.js           regex ekstrakcija: poslovni brojevi, ECLI, EU akti → CELEX, provjera citata
src/eu.js                provjera CELEX-a u CELLAR SPARQL endpointu
src/sources/odluke.js    adapter za odluke.sudovi.hr (+ odluke.config.json)
src/sources/local.js     lokalna zbirka
scripts/probe-odluke.js  ispitivanje stvarne strukture stranice
public/                  sučelje
```
