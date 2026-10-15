// Postavlja novu lozinku korisniku (npr. administratoru koji je zaboravio lozinku).
// Pokrenite dok je poslužitelj zaustavljen.
//   npm run nova-lozinka -- korisnik@primjer.hr          (lozinka se upisuje u terminalu)
//   PRAKSA_LOZINKA="…" npm run nova-lozinka -- korisnik@primjer.hr
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { config } from '../src/config.js';
import { makeCredentials } from '../src/auth.js';

const email = process.argv[2];
if (!email) {
  console.error('Upotreba: npm run nova-lozinka -- <e-pošta>');
  process.exit(1);
}
const users = JSON.parse(fs.readFileSync(config.usersFile, 'utf8'));
const u = users.find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
if (!u) {
  console.error(`Korisnik ${email} ne postoji. Korisnici: ${users.map((x) => x.email).join(', ')}`);
  process.exit(1);
}
let lozinka = process.env.PRAKSA_LOZINKA;
if (!lozinka) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  lozinka = await rl.question('Nova lozinka: ');
  rl.close();
}
const { salt, hash } = await makeCredentials(u.email, lozinka);
Object.assign(u, { salt, hash });
fs.writeFileSync(config.usersFile, JSON.stringify(users, null, 1));
console.log(`Lozinka za ${u.email} je promijenjena.`);
