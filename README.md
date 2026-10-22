# Preglednik sudske prakse

Tražilica presedana za odvjetnički ured: u jedno polje upišete opis slučaja ili pravnog pitanja, a aplikacija
pronađe odluke hrvatskih sudova na [odluke.sudovi.hr](https://odluke.sudovi.hr/) i posloži ih kao presedane. Aplikacija:

1. **razumije upit** (Claude): precizno pravno pitanje, traženo stajalište ako ga upit izražava (npr. „tražim presude da je
   pretraga nezakonita“), bitne činjenice, 5–8 upita za tražilicu i razdoblje ako ga upit spominje (primjenjuje se kao filtar);
2. **pretraži** odluke.sudovi.hr (i po želji lokalnu zbirku u `data/corpus`) – do 2 stranice po upitu, do 60 kandidata;
3. **predselekcija** (Claude, jedan poziv): po isječcima kandidata odabere najrelevantnijih N (`PRAKSA_MAX_DECISIONS`, zadano 8);
4. **analizira svaku odabranu odluku kao presedan** (Claude): odgovor na upit, pravno pitanje, **pravno shvaćanje (ratio decidendi)**,
   do 3 doslovna citata, bitne činjenice, razlike u odnosu na upit, ishod, propisi, u prilog / protiv traženog stajališta,
   primjenjivost danas; iz metapodataka računa **težinu** (razina suda, pravomoćnost, starost) i **navod za podnesak**;
5. **provjeri** ono što se može provjeriti bez modela (vidi dolje), **poveže predmete** koji se međusobno citiraju i **poveže s pravom EU**;
6. **odgovori na upit** (Claude): kratki odgovor s uputama [1], [2] na odluke, vodeća i suprotna praksa, upozorenja.

**Prikaz:** okvir „Odgovor“, zatim kartice presedana po relevantnosti i razini suda – zaglavlje (sud · broj · datum · vrsta ·
pravomoćnost), jedna rečenica odgovora, istaknuto pravno shvaćanje i provjereni citat, gumbi „Kopiraj za podnesak“, „Spremi“ i
„Izvornik“, a ostalo pod „Svi detalji“. Odluke ispod praga relevantnosti (`PRAKSA_RELEVANCE_THRESHOLD`, 50) su pod „Ostale pronađene odluke“.

**Spremljeno** (izbornik gore desno): svaka pretraga sprema se u aktivni predmet (zadani „Spremljene odluke“); tu su povijest
pretraga, spremljene odluke s bilješkama i **izvoz u Word** (navod, pravno shvaćanje, citati, činjenice, razlike, propisi, bilješka).

## Povjerljivost

- Upit se Claude API-ju (Anthropic) šalje **kako je upisan** – nema anonimizacije. Ne upisujte podatke po kojima se klijent može
  prepoznati ako to uvjeti obrade podataka vašeg Anthropic računa ne dopuštaju.
- Prema odluke.sudovi.hr idu samo pravni upiti koje sastavi model, ne vaš opis.
- Predmeti, povijest pretraga i bilješke spremaju se samo lokalno (`data/predmeti`, izvan gita). Bilješke se ne šalju nikamo.

## Što je provjereno, a što nije

| Dio | Kako nastaje | Pouzdanost |
|---|---|---|
| Citati iz odluke (do 3) | model ih predlaže, kod svaki traži doslovno u tekstu | označen ✔ ili ⚠ |
| Citirani poslovni brojevi | regularni izraz nad tekstom odluke; povezivanje neovisno o zapisu (`Rev 12/2019-2` = `Rev-12/19`) | iz teksta (heuristika može nešto propustiti ili pogrešno spojiti) |
| Direktive/uredbe → CELEX | regularni izraz + pravila numeracije EU | iz teksta; postojanje se provjerava u CELLAR-u (SPARQL) |
| Predmeti Suda EU (C-…/…) | regularni izraz | iz teksta, poveznica na CURIA |
| „Moguće poveznice s pravom EU“ | prijedlog modela | **pretpostavka**, jasno označena u sučelju |
| Razina suda, pravomoćnost, starost, navod za podnesak | metapodaci s odluke.sudovi.hr | iz izvora |
| Predselekcija, smjer (u prilog / protiv), razlike od upita, primjenjivost danas | model | procjena, treba provjeriti |
| Relevantnost, pravno shvaćanje, odgovor na upit | model | treba provjeriti u izvornoj odluci |

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
- uvjeti korištenja i `robots.txt` stranice nisu provjereni – provjerite ih prije šire upotrebe. Adapter šalje najviše jedan zahtjev u 3 s i sprema stranice u `data/cache`.

## Web u uredu (više korisnika)

Aplikacija radi na jednom računalu u uredu, a ostali joj pristupaju preglednikom iz iste mreže.

```bash
npm run web                     # poslužitelj za uredsku mrežu (port 8080); ispiše adrese za preglednik
npm run nova-lozinka -- e@posta.hr   # nova lozinka korisniku (npr. zaboravljena lozinka administratora), dok poslužitelj ne radi
```

- **Administrator** je prvi korisnik: preuzima se iz postojeće prijave (`data/prijava.json` ili ugrađene prijave) ili se
  postavlja pri prvom otvaranju stranice. Administrator jedini mijenja API ključ, broj odluka i cjenik.
- **Registracija:** na stranici za prijavu „Zatražite pristup“ (ime, e-pošta, lozinka). Račun čeka odobrenje;
  administrator ga u izborniku **Korisnici** odobri ili odbije, a kasnije može blokirati, deblokirati ili obrisati
  (brisanje uklanja i korisnikove predmete). Blokiran korisnik odmah gubi pristup.
- Svaki korisnik ima **svoje predmete, povijest i bilješke** (`data/predmeti/<id korisnika>/`); predmeti iz verzije s jednim
  korisnikom prelaze administratoru. U izborniku Korisnici vidi se broj pretraga i trošak svakog korisnika u tekućem mjesecu.
- Pristup je dopušten samo preko IP adresa i naziva ovog računala (zaštita od DNS rebindinga); dodatne nazive navedite u
  `PRAKSA_ALLOWED_HOSTS` (npr. `praksa.ured.local`). Port: `PORT`, adresa slušanja: `PRAKSA_HOST` (`npm run web` postavlja `0.0.0.0`).
- Pri prvom pokretanju Windows vatrozid pita za dopuštenje – dopustite za **privatne** mreže. Računalo mora biti uključeno dok ga drugi koriste.
- **Promet nije šifriran (HTTP).** Unutar uredske mreže to je prihvatljivo, ali lozinke i upiti putuju nešifrirano; aplikaciju
  ne izlažite internetu bez HTTPS-a (npr. iza reverse proxyja s certifikatom).

## Windows aplikacija

```bash
npm run postavi-prijavu -- korisnik@primjer.hr   # pristupni podaci ugrađeni u instalaciju (lozinka se upisuje)
npm run dist         # izradi instalaciju: dist/Praksa Setup <verzija>.exe (prekida se ako nema ugrađene prijave)
npm run app          # pokreni aplikaciju iz izvornog koda
```

- **Ugrađena prijava:** `postavi-prijavu` sprema korisničko ime i scrypt sažetak lozinke u `src/prijava-ugradena.json`
  (nije u gitu). Instalacija tada nema prvog postavljanja – na bilo kojem računalu otvara se samo s tim podacima.
  Ugrađena prijava pri prvom pokretanju postaje administratorski račun u `korisnici.json`; promijenjena lozinka sprema se ondje.
  Sažetak je u instalaciji, pa onaj tko ima instalaciju može pokušati pogađati lozinku izvan aplikacije – koristite dugu lozinku koja nije uobičajena fraza.

- Instalacija ne traži administratorska prava (instalira se za trenutnog korisnika) i napravi prečac na radnoj površini.
  Instalacija nije digitalno potpisana, pa Windows SmartScreen pri prvom pokretanju prikaže upozorenje („Više informacija“ → „Svejedno pokreni“).
- Aplikacija se otvara tek nakon prijave; API ključ se upisuje u Postavkama (otvore se same ako ključa nema).
  Bez ugrađene prijave (pokretanje iz izvornog koda) pri prvom pokretanju postavlja se korisničko ime i lozinka.
  Sesija traje dok je aplikacija otvorena (najdulje 8 sati neaktivnosti); nakon 5 krivih lozinki prijava se blokira na 30 sekundi.
- Podaci su u `%APPDATA%\Praksa`: `korisnici.json` (korisnici i scrypt sažeci lozinki), `postavke.json` (API ključ, broj odluka, kontakt),
  `predmeti\` i `cache\`. Podaci **nisu šifrirani** – štiti ih pristup Windows korisničkom računu.
- **Zaboravljena lozinka:** dok je aplikacija zatvorena, `npm run nova-lozinka -- <e-pošta>` uz `PRAKSA_DATA_DIR` postavljen na `%APPDATA%\Praksa`.
- Svaka pretraga prikazuje procijenjeni trošak (tokeni × cijena modela koji je odgovorio); zbroj po predmetu vidi se uz naziv predmeta.

## Pokretanje iz izvornog koda

Potrebno: Node.js 20+ i Anthropic API ključ.

```bash
npm install
npm start            # http://127.0.0.1:3000 – prijava kao u aplikaciji, podaci u ./data
npm test             # testovi (bez mreže i bez API-ja)
```

API ključ se upisuje u Postavkama ili u `.env` (`ANTHROPIC_API_KEY=…`).

Postavke (varijable okruženja):

| Varijabla | Zadano | Značenje |
|---|---|---|
| `PRAKSA_MODEL` | `claude-opus-5-5` | model |
| `PRAKSA_MAX_DECISIONS` | 8 | odluka za detaljnu analizu po upitu (svaka = jedan API poziv) |
| `PRAKSA_MAX_CANDIDATES` | 60 | kandidata za predselekciju po isječcima |
| `PRAKSA_RESULTS_PER_QUERY` | 20 | rezultata tražilice po upitu (2 stranice) |
| `PRAKSA_RELEVANCE_THRESHOLD` | 50 | prag za glavni popis rezultata |
| `PRAKSA_MAX_CHARS` | 150000 | dulje odluke se skraćuju za analizu (prikazuje se oznaka) |
| `PRAKSA_SOURCES` | `odluke,local` | izvori |
| `PRAKSA_MIN_DELAY_MS` | 3000 | razmak između zahtjeva prema istom poslužitelju |
| `PRAKSA_VERIFY_EU` | 1 | `0` isključuje provjeru CELEX-a u CELLAR-u |
| `PRAKSA_USER_AGENT` | … | upišite kontakt kako bi vas operater stranice mogao kontaktirati |

Troškovi: jedan upit = 1 poziv za razumijevanje upita + 1 za predselekciju + do `PRAKSA_MAX_DECISIONS` poziva za analizu + 1 za odgovor.
Duge odluke znače mnogo ulaznih tokena. Trošak svake pretrage prikazuje se u sučelju, a broj odluka mijenja se i u Postavkama.

Cjenik se **osvježava automatski**: pri pokretanju (ako je stariji od jednog dana) i zatim svaki dan aplikacija dohvaća
službenu tablicu cijena s `platform.claude.com/docs/en/about-claude/pricing.md`, provjerava je (dovoljno modela, uključen
korišteni model, logične vrijednosti) i sprema u `data/cjenik.json`. Ako dohvat ne uspije ili se stranica promijeni pa
tablica ne prođe provjeru, ostaje zadnji dobar cjenik (ili ugrađeni u `src/pricing.js`), a greška se prikaže u Postavkama.
Ručno osvježavanje: Postavke → „Osvježi cjenik sada“. `PRAKSA_PRICING_REFRESH=0` isključuje dohvat s mreže.

Za zahtjeve odbijene od sigurnosnih klasifikatora uključen je poslužiteljski `fallbacks: "default"`
(beta `server-side-fallback-2026-07-01`) – zahtjev se tada automatski ponovi na preporučenom zamjenskom modelu.

## Skill za Claude (`skill/sudska-praksa`)

Isti posao kao web aplikacija, ali unutar Claudea: Claude razrađuje opis, čita i ocjenjuje odluke i piše
sintezu, a skripta `scripts/praksa.mjs` radi pretraživanje, dohvat, regex ekstrakciju, provjeru citata
i povezivanje predmeta. Troši se kvota korisnikove Claude pretplate, ne API ključ; nema poslužitelja.

Skripta je jedna datoteka (cheerio je zapakiran unutra), treba joj samo Node.js 20.12+.
Izvor je `skill/praksa-cli.js`; nakon izmjena u njemu ili u `src/` pokrenite `npm run skill:build`
(test `npm test` javlja grešku ako zapakirana skripta nije osvježena).

**Instalacija za Claude Code** (osobni skill, vrijedi u svim projektima):

```powershell
# Windows (PowerShell), iz mape repozitorija. Mapa skilla se izričito stvara i kopira se samo
# njezin sadržaj (\*): Copy-Item -Recurse inače ovisno o tome postoji li odredište kopira ili
# sadržaj umjesto mape ili mapu unutar mape, a Claude Code skill tada ne pronalazi.
$cilj = "$env:USERPROFILE\.claude\skills\sudska-praksa"
New-Item -ItemType Directory -Force $cilj | Out-Null
Copy-Item -Recurse -Force skill\sudska-praksa\* $cilj
Test-Path "$cilj\scripts\praksa.mjs"   # mora ispisati True
```

```bash
# Linux / macOS
mkdir -p ~/.claude/skills/sudska-praksa && cp -r skill/sudska-praksa/. ~/.claude/skills/sudska-praksa/
```

Zatim u Claude Codeu npr. „Nađi sudsku praksu: putnik je ozlijeđen kad je autobus naglo zakočio.”

Ograničenja koja treba znati:
- skripta dohvaća odluke s računala na kojem radi; u Claude Codeu ili Coworku na vlastitom računalu to je
  vaša mreža. U pregledniku na claude.ai skripte se izvode u Anthropicovu okruženju čiji je mrežni pristup
  ograničen, pa nije provjereno može li tamo doći do odluke.sudovi.hr;
- skill koristi isti adapter i istu `odluke.config.json` (provjerenu 14.10.2026., vidi gore), ali je sam skill
  na stvarnoj stranici još neisproban; konfiguracija se pri izgradnji kopira u skill, pa nakon njezine izmjene
  ponovno pokrenite `npm run skill:build`;
- dosljednost ovisi o tome koliko Claude slijedi upute iz `SKILL.md`; ono što je provjerljivo radi skripta.

## Lokalna zbirka

Odluke spremljene kao `.txt`, `.md` ili `.html` u `data/corpus/` pretražuju se zajedno s online izvorom
(korisno za odluke s portala Vrhovnog suda ili za rad bez mreže).

## Struktura

```
src/server.js            HTTP poslužitelj i API (/api/upit, /api/predmeti, /api/postavke…)
src/pipeline.js          tijek obrade, provjere, povezivanje predmeta
src/llm.js               pozivi Claude API-ja sa strukturiranim izlazom
src/authority.js         težina odluke (razina suda, pravomoćnost, starost) i navod za podnesak
src/store.js             spremanje predmeta po korisniku u data/predmeti/<id>
src/auth.js              korisnici, registracija s odobrenjem administratora, prijava (scrypt), sesije
src/settings.js          postavke: API ključ, broj odluka, kontakt
src/pricing.js           procjena troška iz usage
electron/main.js         Windows aplikacija (prozor + lokalni poslužitelj)
src/export.js            izvoz odabranih odluka u .docx
src/extract.js           regex ekstrakcija: poslovni brojevi, ECLI, EU akti → CELEX, provjera citata
src/eu.js                provjera CELEX-a u CELLAR SPARQL endpointu
src/sources/odluke.js    adapter za odluke.sudovi.hr (+ odluke.config.json)
src/sources/local.js     lokalna zbirka
src/related.js           povezivanje predmeta (zajedničko aplikaciji i skillu)
scripts/probe-odluke.js  ispitivanje stvarne strukture stranice
scripts/build-skill.js   pakiranje skilla (npm run skill:build)
skill/praksa-cli.js      naredbe skilla (izvor)
skill/sudska-praksa/     skill: SKILL.md + zapakirana skripta
public/                  sučelje
```
