---
name: sudska-praksa
description: Pretražuje i analizira odluke hrvatskih sudova s odluke.sudovi.hr prema opisu slučaja ili događaja (ne samo prema pojmu), provjerava citate u izvornom tekstu, izvlači citirane predmete i reference na pravo EU (direktive, uredbe, CELEX, predmeti Suda EU) te izrađuje sintezu prakse. Koristi kad korisnik traži sudsku praksu, presude ili odluke hrvatskih sudova za neki slučaj, pitanje ili pravni pojam, npr. "nađi praksu za...", "kako sudovi odlučuju o...", "ima li presuda o...", ili kad korisnik da odluke (datoteke ili tekst) koje treba analizirati.
---

# Sudska praksa (odluke.sudovi.hr)

Skill pronalazi odluke hrvatskih sudova koje odgovaraju opisanom slučaju i analizira ih.
Podjela posla je stroga:

- **Skripta `scripts/praksa.mjs`** radi sve što se može provjeriti bez modela: pretraživanje i dohvat odluka,
  poslovne brojeve, reference na pravo EU (s CELEX brojem), provjeru citata i povezivanje predmeta.
- **Ti** razrađuješ opis, čitaš odluke, ocjenjuješ relevantnost i pišeš sintezu.

Skripti treba samo Node.js 20.12 ili noviji. Pokreći je kao `node <mapa ovog skilla>/scripts/praksa.mjs <naredba>`.
Izlaz je JSON. Radne datoteke idu u `--dir` (zadano `./praksa-rad`).

## Prije početka

- Ovo **nije pravni savjet**. Ako korisnik opisuje vlastiti slučaj i pita što da radi, reci da je rezultat
  istraživanje prakse koje treba provjeriti kvalificirana osoba (odvjetnik) i da je izrađeno uz pomoć umjetne inteligencije.
- Ako opis sadrži imena ili druge podatke po kojima se osobe mogu prepoznati, ne prenosi ih u upite za tražilicu
  i ne ponavljaj ih u odgovoru više nego što treba.
- Čitanje odluka troši korisnikovu kvotu (odluke znaju imati desetke tisuća riječi). Zadano analiziraj
  **najviše 8 odluka**; za više pitaj korisnika.

## Postupak

### 1. Razradi opis

Iz opisa izvedi i kratko prikaži korisniku:
- pravna pitanja i ključne činjenice;
- pravna područja i propise koji bi se mogli primjenjivati (označi ih kao **pretpostavke**);
- **3–8 upita za tražilicu**: kratkih (2–6 riječi), izrazima kakve sudovi pišu u obrazloženjima
  (npr. `naknada nematerijalne štete prometna nesreća`, `ništetnost valutne klauzule CHF`), po potrebi s oznakom propisa i članka.

### 2. Pretraži

Sve upite pošalji jednim pozivom:

```bash
node <mapa skilla>/scripts/praksa.mjs pretrazi "upit 1" "upit 2" "upit 3"
```

Ako opis ili korisnik ograničava razdoblje, dodaj `--od YYYY-MM-DD` i/ili `--do YYYY-MM-DD` (datum odluke).
Rezultati su poredani tako da su prve odluke koje je pronašlo više upita (`upiti`). Ako su `rezultati` prazni,
a `upozorenja` sadrže mrežnu grešku (npr. `ENOTFOUND`, `ECONNREFUSED`, `HTTP 403`), stranica nije dostupna:
reci to korisniku i ponudi da sam spremi ili zalijepi tekst odluka (vidi „Kad pretraga ne radi”).
Ne izmišljaj odluke.

### 3. Odaberi i dohvati

Na temelju naslova, isječaka i broja upita odaberi do 8 najperspektivnijih odluka i dohvati ih jednim pozivom:

```bash
node <mapa skilla>/scripts/praksa.mjs dohvati "<url1>" "<url2>" ... --dir praksa-rad
```

Za svaku odluku dobivaš `datoteka` (puni tekst), `meta` (poslovni broj, sud, ECLI te, kad ih stranica navodi,
datum, pravomoćnost i vrstu odluke),
`citiraniPredmeti`, `euReference` i `ekljp`. Ove podatke izvukao je kod iz teksta i oni su **provjereni sloj**.

### 4. Pročitaj i ocijeni svaku odluku

Pročitaj datoteku s tekstom (cijelu, ili u dijelovima ako je duga) i za svaku odluku utvrdi:

| Polje | Sadržaj |
|---|---|
| podudaranje | `da` / `djelomično` / `ne`: odnosi li se odluka na opisani slučaj |
| relevantnost | 0–100 |
| objašnjenje | zašto jest ili nije relevantna |
| činjenice predmeta | ukratko |
| ishod | kako je sud odlučio |
| pravno shvaćanje | ključno stajalište suda |
| zašto je važna | za korisnikov slučaj |
| citat | **doslovan** odlomak iz teksta koji najbolje potkrepljuje relevantnost |
| primijenjeni propisi | samo propisi navedeni u tekstu odluke |
| moguće poveznice s pravom EU | samo kao **pretpostavke** s obrazloženjem, ako nisu u `euReference` |

Svaki citat provjeri:

```bash
node <mapa skilla>/scripts/praksa.mjs citat "<datoteka>" "<citat>"
```

`"provjeren": true` označi s ✔. Ako je `false`, ispravi citat prema tekstu i provjeri ponovno; ako ne uspije,
izostavi ga ili ga označi s ⚠ „nije pronađen doslovno u tekstu”.

### 5. Poveži predmete

```bash
node <mapa skilla>/scripts/praksa.mjs povezi --dir praksa-rad
```

Pokazuje koje se dohvaćene odluke međusobno citiraju ili citiraju iste predmete.

### 6. Odgovor korisniku

1. **Sažetak problema** i upiti koji su korišteni.
2. **Sinteza prakse** (samo iz odluka s podudaranjem `da` ili `djelomično`): prevladavajuće stajalište,
   razlike u praksi, veza s pravom EU, preporuke za daljnje istraživanje.
3. **Odluke**, od najrelevantnije: poslovni broj, sud, poveznica (`url`), podudaranje i relevantnost,
   ishod, pravno shvaćanje, citat s ✔ ili ⚠, povezani predmeti, reference na pravo EU.
4. Odluke s podudaranjem `ne` samo nabroji s jednom rečenicom zašto nisu relevantne.
5. Napomenu da je rezultat istraživanje uz pomoć umjetne inteligencije, a ne pravni savjet.

Jasno razdvoji ono što je izvučeno i provjereno kodom od tvoje ocjene. Za reference na pravo EU navedi
oznaku, CELEX i stanje `provjera` (`potvrđeno`, `nije potvrđeno u CELLAR-u`, `neprovjereno`); `neprovjereno`
znači samo da provjera nije bila moguća, ne da akt ne postoji.

## Pravila pouzdanosti

- Tvrdnje o sadržaju odluke temelji isključivo na njezinu tekstu. Ako nešto nije navedeno, reci da nije navedeno.
- Ne izmišljaj poslovne brojeve, ECLI oznake, nazive propisa ni predmete Suda EU. Navodi samo one iz teksta
  odluke ili iz izlaza skripte.
- Poslovni brojevi i reference izvučeni su heuristikom: mogu nešto propustiti ili rijetko pogrešno prepoznati.
- Ako je izvorni tekst odluke nepotpun (npr. stranica bez teksta, samo PDF), reci to umjesto da nagađaš.

## Kad pretraga ne radi

`dohvati` prima i lokalne datoteke (`.txt`, `.md`, `.html`):

```bash
node <mapa skilla>/scripts/praksa.mjs dohvati odluka1.html odluka2.txt --dir praksa-rad
```

Korisnik može odluke spremiti iz preglednika (Ctrl+S, „Web stranica, samo HTML”; metapodaci se tada čitaju kao pri dohvatu) ili zalijepiti tekst, koji tada spremi u `.txt` datoteku
pa nastavi od koraka 4. Ako tražilica stalno ne vraća rezultate iako je stranica dostupna, struktura stranice
se vjerojatno promijenila: to treba podesiti u `scripts/odluke.config.json` (upute su u repozitoriju projekta).

## Postavke (varijable okruženja)

| Varijabla | Zadano | Značenje |
|---|---|---|
| `PRAKSA_MIN_DELAY_MS` | 1500 | razmak između zahtjeva prema istom poslužitelju |
| `PRAKSA_CACHE_DIR` | `~/.cache/praksa-skill` | predmemorija dohvaćenih stranica |
| `PRAKSA_VERIFY_EU` | 1 | `0` isključuje provjeru CELEX-a u CELLAR-u |
| `PRAKSA_USER_AGENT` | … | kontakt za operatera stranice |
