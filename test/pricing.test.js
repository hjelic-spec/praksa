// Automatsko osvježavanje cjenika: čitanje tablice iz dokumentacije, provjera, spremanje i
// zadržavanje zadnjeg dobrog cjenika kad dohvat ne uspije. Bez mreže (lažni fetch).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'praksa-cjenik-'));
process.env.PRAKSA_DATA_DIR = tmp;
const pricing = await import('../src/pricing.js');

// Isječak u obliku službene stranice (stupci i fusnote kao na platform.claude.com).
const MD = `# Pricing

| Model                                                                         | Base input tokens     | 5m cache writes | 1h cache writes | Cache hits and refreshes | Output tokens          |
| ----------------------------------------------------------------------------- | --------------------- | --------------- | --------------- | ------------------------ | ---------------------- |
| Claude Mythos 5.1 ([limited availability](https://support.claude.com/x/1))    | $10 / MTok            | $12.50 / MTok   | $20 / MTok      | $0.25 / MTok<sup>1</sup> | $50 / MTok             |
| Claude Opus 5.5                                                               | $3 / MTok             | $3.75 / MTok    | $6 / MTok       | $0.15 / MTok<sup>2</sup> | $15 / MTok             |
| Claude Sonnet 5.5                                                             | $2 / MTok<sup>3</sup> | $2.50 / MTok    | $4 / MTok       | $0.10 / MTok             | $10 / MTok             |
| Claude Haiku 5.5 (for prompts up to 100,000 tokens)                           | $0.10 / MTok          | $0.125 / MTok   | $0.20 / MTok    | $0.01 / MTok             | $0.50 / MTok           |
| Claude Haiku 5.5 (for prompts over 100,000 tokens)                            | $0.50 / MTok          | $0.625 / MTok   | $1 / MTok       | $0.05 / MTok             | $2.50 / MTok           |

*<sup>1 fusnota</sup>*
`;

const okFetch = (body) => async () => ({ ok: true, status: 200, text: async () => body });

test('čitanje tablice cijena iz dokumentacije', () => {
  const p = pricing.parsePricingMarkdown(MD);
  assert.deepEqual(p['claude-opus-5-5'], { ulaz: 3, pisanje: 3.75, citanje: 0.15, izlaz: 15 });
  assert.deepEqual(p['claude-sonnet-5-5'], { ulaz: 2, pisanje: 2.5, citanje: 0.1, izlaz: 10 }, 'fusnote se zanemaruju');
  assert.equal(p['claude-haiku-5-5'].ulaz, 0.1, 'osnovna cijena, ne ona za duge upite');
  assert.ok(p['claude-mythos-5-1'], 'poveznica u nazivu ne smeta');
  assert.throws(() => pricing.parsePricingMarkdown('# Nešto drugo'), /nije pronađena/);
});

test('provjera odbacuje nepotpun ili nelogičan cjenik', () => {
  assert.throws(() => pricing.validatePrices({ 'claude-opus-5-5': { ulaz: 4, pisanje: 5, citanje: 0.2, izlaz: 20 } }), /premalo/);
  const bez = { a: { ulaz: 1, pisanje: 1, citanje: 0.1, izlaz: 5 }, b: { ulaz: 1, pisanje: 1, citanje: 0.1, izlaz: 5 }, c: { ulaz: 1, pisanje: 1, citanje: 0.1, izlaz: 5 } };
  assert.throws(() => pricing.validatePrices(bez, 'claude-opus-5-5'), /nema modela/);
  const krivo = { ...bez, 'claude-opus-5-5': { ulaz: 40, pisanje: 5, citanje: 0.2, izlaz: 20 } };
  assert.throws(() => pricing.validatePrices(krivo, 'claude-opus-5-5'), /nelogične/);
});

test('osvježavanje: novi cjenik se sprema i koristi; neuspjeh zadržava zadnji dobar', async () => {
  assert.equal(pricing.costOf('claude-opus-5-5', { input_tokens: 1_000_000 }), 4, 'prije osvježavanja: ugrađeni cjenik');

  const info = await pricing.refreshPricing({ fetchImpl: okFetch(MD) });
  assert.equal(info.greska, null);
  assert.ok(info.dohvaceno);
  assert.equal(pricing.costOf('claude-opus-5-5', { input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 }), 3 + 3.75);
  const saved = JSON.parse(await fs.readFile(path.join(tmp, 'cjenik.json'), 'utf8'));
  assert.equal(saved.cijene['claude-opus-5-5'].izlaz, 15);

  const fail = await pricing.refreshPricing({ fetchImpl: async () => ({ ok: false, status: 503 }) });
  assert.match(fail.greska, /HTTP 503/);
  assert.equal(fail.dohvaceno, info.dohvaceno);
  assert.equal(pricing.costOf('claude-opus-5-5', { output_tokens: 1_000_000 }), 15, 'zadržan zadnji dobar cjenik');

  const garbage = await pricing.refreshPricing({ fetchImpl: okFetch('<html>stranica se promijenila</html>') });
  assert.match(garbage.greska, /nije pronađena/);
  assert.equal(pricing.costOf('claude-opus-5-5', { output_tokens: 1_000_000 }), 15);
});

test('trošak pretrage bilježi modele koji su stvarno odgovorili', () => {
  const t = pricing.createCostTracker();
  t.add('claude-opus-5-5', { input_tokens: 1000, output_tokens: 100 });
  t.add('claude-opus-5-5', { input_tokens: 1000, output_tokens: 100 });
  t.add('claude-sonnet-5-5', { input_tokens: 1000, output_tokens: 100 }); // npr. zamjenski model
  assert.deepEqual(t.summary.modeli, ['claude-opus-5-5', 'claude-sonnet-5-5']);
  assert.equal(t.summary.pozivi, 3);
});

test.after(() => fs.rm(tmp, { recursive: true, force: true }));
