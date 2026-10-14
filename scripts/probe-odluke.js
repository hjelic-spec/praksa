// Ispituje stvarnu strukturu odluke.sudovi.hr i ispisuje što je potrebno za
// odluke.config.json: polja obrasca za napredno pretraživanje, oblik poveznica
// na rezultate i duljinu izvučenog teksta odluke.
//   npm run probe -- "naknada štete prometna nesreća"
import { config } from '../src/config.js';
import { fetchText } from '../src/http.js';
import * as cheerio from 'cheerio';
import { pickSearchForm, firstPage, fetchDecision, search } from '../src/sources/odluke.js';

const query = process.argv[2] ?? 'naknada nematerijalne štete';
const c = config.odluke;
const searchPage = c.baseUrl + c.searchPagePath;

console.log(`1) Dohvaćam ${searchPage}`);
const html = await fetchText(searchPage, { useCache: false });
const form = pickSearchForm(html, searchPage);
if (!form) {
  console.log('   Nije pronađen obrazac s tekstualnim poljem. Stranica možda koristi JavaScript za pretraživanje;');
  console.log('   otvorite alate za razvojne programere u pregledniku (Network) i pronađite zahtjev koji šalje upit.');
  process.exit(1);
}
console.log(`   Obrazac: ${form.method} ${form.action}`);
for (const f of form.fields) {
  const opts = f.options ? ` [${f.options.slice(0, 8).map((o) => `${o.value}=${o.label}`).join(', ')}${f.options.length > 8 ? ', …' : ''}]` : '';
  console.log(`   - ${f.name} (${f.type})${f.label ? ` "${f.label}"` : ''}${f.value && f.type !== 'hidden' ? ` = ${f.value}` : ''}${opts}`);
}

console.log(`\n2) Pretražujem "${query}"`);
const results = await search(query, { limit: 5 }).catch((e) => { console.log(`   Greška: ${e.message}`); return []; });
if (!results.length) {
  console.log('   Heuristika nije prepoznala rezultate. Poveznice na stranici rezultata:');
  const page = await firstPage(query, {}).catch((e) => ({ html: '', err: e.message }));
  if (page.err) console.log(`   Greška: ${page.err}`);
  const $ = cheerio.load(page.html);
  $('a[href]').slice(0, 60).each((_, a) => console.log(`   ${$(a).attr('href')}  ${$(a).text().trim().slice(0, 60)}`));
  console.log('   Postavite results.linkPattern (regex) u odluke.config.json.');
  process.exit(1);
}
for (const r of results) console.log(`   - ${r.naslov}\n     ${r.url}`);

console.log(`\n3) Dohvaćam prvu odluku`);
const { tekst: text, meta } = await fetchDecision(results[0]);
console.log(`   Duljina teksta: ${text.length} znakova`);
console.log('   Metapodaci:', meta);
console.log(`   Početak:\n${text.slice(0, 800)}`);
console.log('\nAko tekst sadrži izbornike ili nedostaje, postavite decision.textSelector u odluke.config.json.');
