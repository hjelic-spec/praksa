// Pristojan HTTP klijent: razmak između zahtjeva i kod istovremenih poziva, rok trajanja
// predmemorije, ponovni dohvat neispravne stranice. Bez mreže (lažni fetch).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'praksa-http-'));
process.env.PRAKSA_DATA_DIR = tmp;
process.env.PRAKSA_MIN_DELAY_MS = '150';
const { fetchText } = await import('../src/http.js');
const { fetchDecision, search } = await import('../src/sources/odluke.js');

const calls = [];
let body = () => 'stranica';
globalThis.fetch = async (url) => {
  calls.push({ url, at: Date.now() });
  return { ok: true, status: 200, headers: { getSetCookie: () => [] }, text: async () => body(url) };
};

test('istovremeni zahtjevi prema istom poslužitelju idu s propisanim razmakom', async () => {
  calls.length = 0;
  await Promise.all(['a', 'b', 'c', 'd'].map((x) => fetchText(`https://primjer.test/${x}`, { useCache: false })));
  const gaps = calls.slice(1).map((c, i) => c.at - calls[i].at);
  assert.equal(calls.length, 4);
  assert.ok(gaps.every((g) => g >= 140), `razmaci ${gaps.join(', ')} ms`);
});

test('predmemorija: vrijedi do roka, zatim se stranica dohvaća ponovno', async () => {
  calls.length = 0;
  body = () => 'v1';
  assert.equal(await fetchText('https://primjer.test/rok'), 'v1');
  body = () => 'v2';
  assert.equal(await fetchText('https://primjer.test/rok'), 'v1', 'iz predmemorije');
  assert.equal(await fetchText('https://primjer.test/rok', { maxAgeMs: 0 }), 'v2', 'istekla');
  assert.equal(calls.length, 2);
});

test('stranica odluke bez teksta u predmemoriji dohvaća se ponovno i zamjenjuje', async () => {
  const url = 'https://primjer.test/Document/View?id=11111111-2222-4333-8444-555555555555';
  body = () => '<html><body>Stranica je u održavanju.</body></html>';
  await fetchText(url); // neispravna stranica završi u predmemoriji
  body = () => `<html><body><div class="decision-text"><p>${'Obrazloženje odluke. '.repeat(20)}</p></div></body></html>`;
  calls.length = 0;
  const d = await fetchDecision({ url });
  assert.ok(d.tekst.length >= 200);
  assert.equal(calls.length, 1, 'jedan novi dohvat');
  calls.length = 0;
  await fetchDecision({ url });
  assert.equal(calls.length, 0, 'ispravna stranica sada je u predmemoriji');
});

test('greška na drugoj stranici rezultata ne briše rezultate s prve', async () => {
  const id = (n) => `${String(n).repeat(8)}-2222-4333-8444-555555555555`;
  const page1 = `<a href="/Document/View?id=${id(1)}">Rev 1/2020</a><a href="/Document/View?id=${id(2)}">Gž-2/2021</a>
    <ul class="pagination"><li class="page-item"><a class="page-link" aria-label="Next" href="/Document/DisplayList?q=x&page=2">›</a></li></ul>`;
  globalThis.fetch = async (url) => (url.includes('page=2')
    ? { ok: false, status: 503, headers: { getSetCookie: () => [] }, text: async () => '' }
    : { ok: true, status: 200, headers: { getSetCookie: () => [] }, text: async () => page1 });
  const r = await search('greška na drugoj stranici', { limit: 20 });
  assert.equal(r.length, 2);
});

test.after(() => fs.rm(tmp, { recursive: true, force: true }));
