// Testovi parsera na IZMIŠLJENOM HTML-u. Provjeravaju logiku adaptera,
// a ne stvarnu strukturu odluke.sudovi.hr (za to služi `npm run probe`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickSearchForm, parseResults, canonicalDecisionUrl, decisionTextFromHtml, metadataFromText } from '../src/sources/odluke.js';

const SEARCH_PAGE = 'https://primjer.test/Document/AdvancedSearch';

test('obrazac: skrivena polja, select, tekstualno polje', () => {
  const html = `<form id="mali"><input type="text" name="q2"></form>
  <form action="/Document/Results" method="post">
    <input type="hidden" name="__RequestVerificationToken" value="tok">
    <input type="text" name="Upit" id="u"><label for="u">Pojam</label>
    <select name="Sud"><option value="">Svi</option><option value="3" selected>VSRH</option></select>
    <input type="checkbox" name="Samo" value="1">
    <input type="submit" name="go" value="Traži">
  </form>`;
  const f = pickSearchForm(html, SEARCH_PAGE);
  assert.equal(f.method, 'POST');
  assert.equal(f.action, 'https://primjer.test/Document/Results');
  const names = f.fields.map((x) => x.name);
  assert.deepEqual(names, ['__RequestVerificationToken', 'Upit', 'Sud']);
  assert.equal(f.fields.find((x) => x.name === 'Sud').value, '3');
  assert.equal(f.fields.find((x) => x.name === 'Upit').label, 'Pojam');
});

// Oblik /Document/View?id=<GUID>[&q=...] preuzet je iz javno indeksiranih poveznica na
// odluke.sudovi.hr; GUID-ovi ovdje su izmišljeni.
const ID1 = '11111111-2222-4333-8444-555555555555';
const ID2 = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

test('rezultati: poveznice na odluke, kanonski URL i sljedeća stranica', () => {
  const html = `<a href="/Document/AdvancedSearch">Traži</a>
    <table><tr><td><a href="/Document/View?id=${ID1}&q=naknada+%C5%A1tete">Rev 1/2020</a> Vrhovni sud, 2020</td></tr>
    <tr><td><a href="/Document/View?id=${ID2}">Gž-2/2021</a></td></tr>
    <tr><td><a href="/Document/View?id=${ID1}">isti dokument bez q</a></td></tr></table>
    <a href="/Document/Results?page=2">Sljedeća</a>`;
  const { results, next } = parseResults(html, SEARCH_PAGE);
  assert.equal(results.length, 2, 'ista odluka s različitim q= je jedan rezultat');
  assert.equal(results[0].url, `https://primjer.test/Document/View?id=${ID1}`);
  assert.match(results[0].isjecak, /Vrhovni sud/);
  assert.equal(next, 'https://primjer.test/Document/Results?page=2');
});

test('tekst odluke bez navigacije i metapodaci', () => {
  const html = `<html><body><nav>Izbornik</nav><script>x()</script>
    <div><p>REPUBLIKA HRVATSKA</p><p>Vrhovni sud Republike Hrvatske</p><p>Poslovni broj: Rev 1234/2019-2</p>
    <p>ECLI:HR:VSRH:2020:999</p><p>Obrazloženje ...</p></div><footer>Podnožje</footer></body></html>`;
  const t = decisionTextFromHtml(html);
  assert.ok(!t.includes('Izbornik') && !t.includes('Podnožje') && !t.includes('x()'));
  const m = metadataFromText(t);
  assert.equal(m.sud, 'Vrhovni sud Republike Hrvatske');
  assert.equal(m.poslovniBroj, 'Rev 1234/2019-2');
  assert.equal(m.ecli, 'ECLI:HR:VSRH:2020:999');
});

test('kanonski URL odluke', () => {
  assert.equal(
    canonicalDecisionUrl(`https://odluke.sudovi.hr/Document/View?id=${ID1}&q=Us+I-1486%2F2025-3`),
    `https://odluke.sudovi.hr/Document/View?id=${ID1}`,
  );
  assert.equal(canonicalDecisionUrl('https://primjer.test/Document/Other?x=1&q=a'), 'https://primjer.test/Document/Other?x=1');
});
