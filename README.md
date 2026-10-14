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
| Citirani poslovni brojevi | regularni izraz nad tekstom odluke | iz teksta (heuristika može nešto propustiti) |
| Direktive/uredbe → CELEX | regularni izraz + pravila numeracije EU | iz teksta; postojanje se provjerava u CELLAR-u (SPARQL) |
| Predmeti Suda EU (C-…/…) | regularni izraz | iz teksta, poveznica na CURIA |
| „Moguće poveznice s pravom EU“ | prijedlog modela | **pretpostavka**, jasno označena u sučelju |
| Ocjena relevantnosti, sažeci, sinteza | model | treba provjeriti u izvornoj odluci |

Ovo nije pravni savjet.

## Važno: stanje integracije s odluke.sudovi.hr

Kod je napisan u okruženju iz kojeg **odluke.sudovi.hr nije bio dostupan**, pa struktura stranice
(nazivi polja obrasca, oblik URL-ova rezultata, raspored teksta odluke) nije provjerena.
Adapter (`src/sources/odluke.js`) zato:

- sam pročita obrazac s `/Document/AdvancedSearch` (uključujući skrivena polja i kolačiće) i upiše upit u tekstualno polje;
- rezultate prepoznaje heuristikom (poveznice pod `/Document/` s identifikatorom);
- tekst odluke uzima iz cijele stranice bez navigacije.

Prije prve upotrebe pokrenite:

```bash
npm run probe -- "naknada nematerijalne štete"
```

Skripta ispiše polja obrasca, pronađene rezultate i početak teksta prve odluke. Ako nešto ne štima,
popunite odgovarajuća polja u `src/sources/odluke.config.json` (`queryField`, `filterFields`,
`results.linkPattern`, `decision.textSelector` ili `search.mode: "template"`).
Filteri u sučelju (npr. datum) pojavljuju se tek kad se u `filterFields` upiše naziv polja.

Ograničenja koja nisu riješena:
- odluke dostupne samo kao PDF/DOC nisu podržane (tekst se ne izvlači);
- ako tražilica rezultate učitava JavaScriptom, auto-form način neće raditi – tada treba `template` način s URL-om zahtjeva iz alata za razvojne programere preglednika;
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
