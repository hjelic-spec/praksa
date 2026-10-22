# Promjene

Verzija aplikacije je u `package.json` i prikazuje se u Postavkama. Windows instalacija se izrađuje
s `npm run dist` (vidi README, „Windows aplikacija“) i zove se `Praksa Setup <verzija>.exe`.

## Neobjavljeno

Web na poslužitelju (zatvorena beta), vidi README „Web na poslužitelju“ i `deploy/`:
- Rad iza HTTPS proxyja: `PRAKSA_PUBLIC_URL` (Secure kolačić, javna domena dopuštena i bez porta),
  `PRAKSA_TRUST_PROXY` (IP korisnika iz X-Forwarded-For za zaključavanje nakon krivih lozinki).
- Sesije preživljavaju ponovno pokretanje (`sesije.json`, samo sažeci tokena).
- Mjesečne kvote po korisniku u USD (zadana i pojedinačna), jedna pretraga u tijeku po korisniku.
- Nova lozinka od administratora; uz SMTP reset lozinke e-poštom i obavijest o novoj registraciji.
- Lokalna zbirka: kad je prazna, putanja mape je u opisu kvadratića umjesto u natpisu.

## 0.2.0 – 22.10.2026.

Novo:
- **Izbor modela u Postavkama** (administrator): Claude Opus 5.5 (zadani), Sonnet 5.5, Haiku 5.5 i Fable 5.1,
  s cijenom iz cjenika. Uz trošak pretrage prikazuje se model koji je odgovorio.
- **Opcije pretraživanja** iznad polja za pretragu: „Europsko pravo (EU i EKLJP)“ (zadano isključeno) i
  „Lokalna zbirka“ (s brojem odluka; onemogućena kad je zbirka prazna).
- Verzija aplikacije prikazuje se na dnu Postavki.

Ispravci:
- Ograničenje brzine prema odluke.sudovi.hr vrijedi i za istovremene zahtjeve.
- Rezultati pretrage u predmemoriji vrijede 6 sati (prije zauvijek, pa nove odluke nisu bile vidljive za isti upit);
  stranice odluka 30 dana.
- Stranica odluke spremljena bez teksta (npr. tijekom održavanja stranice) dohvaća se ponovno.
- Greška na drugoj stranici rezultata više ne briše rezultate s prve.

Brzina i ponašanje:
- Odluke se analiziraju istovremeno (`PRAKSA_CONCURRENCY`, zadano 8), upiti tražilici do 3 istovremeno.
- Najviše jedan zahtjev prema odluke.sudovi.hr u 3 s (prije 1,5 s): pretraga je zbog toga sporija kad stranice
  nisu u predmemoriji.
- Lokalna zbirka drži se u memoriji (znatno brža pretraga velikih zbirki).
- Isti upit tražilici šalje se samo jednom.

Nadogradnja: instalirajte novu verziju preko postojeće. Podaci (korisnici, postavke, API ključ, predmeti) su u
`%APPDATA%\Praksa` i ostaju sačuvani.

## 0.1.0 – 15.10.2026.

Prva verzija: pretraga po opisu slučaja na odluke.sudovi.hr, analiza odluka modelom s provjerom citata,
veza s pravom EU, predmeti i spremljene odluke, izvoz u Word, prijava i registracija korisnika s odobrenjem,
web u uredu, Windows aplikacija s ugrađenom prijavom, prikaz troška pretrage i automatski cjenik.
