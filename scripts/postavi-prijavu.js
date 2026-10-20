// Izrađuje src/prijava-ugradena.json: pristupne podatke ugrađene u Windows instalaciju.
// Sprema se samo scrypt sažetak lozinke. Datoteka nije u gitu (repozitorij je javan).
//
//   PRAKSA_LOZINKA="…" npm run postavi-prijavu -- korisnik@primjer.hr
//   npm run postavi-prijavu -- korisnik@primjer.hr      (lozinka se upisuje u terminalu)
//   node scripts/postavi-prijavu.js --provjeri          (prije `npm run dist`: prekini ako je nema)
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { config } from '../src/config.js';
import { makeCredentials } from '../src/auth.js';

const file = config.bundledAuthFile;

if (process.argv[2] === '--provjeri') {
  if (!fs.existsSync(file)) {
    console.error(`Nema ugrađene prijave (${file}).\nBez nje bi instalacija dopustila postavljanje bilo kojeg korisnika.\nPokrenite: npm run postavi-prijavu -- <korisničko ime>`);
    process.exit(1);
  }
  console.log(`Ugrađena prijava: ${JSON.parse(fs.readFileSync(file, 'utf8')).korisnik}`);
  process.exit(0);
}

const korisnik = process.argv[2];
if (!korisnik) {
  console.error('Upotreba: npm run postavi-prijavu -- <korisničko ime>');
  process.exit(1);
}
let lozinka = process.env.PRAKSA_LOZINKA;
if (!lozinka) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  lozinka = await rl.question('Lozinka: ');
  rl.close();
}
fs.writeFileSync(file, JSON.stringify(await makeCredentials(korisnik, lozinka), null, 1));
console.log(`Spremljeno: ${file} (korisnik ${korisnik}). Sljedeća \`npm run dist\` ugradit će ovu prijavu.`);
