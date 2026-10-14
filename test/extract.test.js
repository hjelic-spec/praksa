import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  caseKey, extractCaseNumbers, extractEcli, extractEuActs, extractCjeuCases, extractEuReferences, quoteInText,
} from '../src/extract.js';

test('poslovni brojevi hrvatskih sudova', () => {
  const t = 'Vrhovni sud u predmetu Rev 1234/2019-2 i Županijski sud Gž-123/18, te Ustavni sud U-III-1234/2018. ' +
    'Vidi i Us I-45/2020. Propis NN 35/05, Uredba (EZ) br. 261/2004 i presuda C-415/11.';
  const got = extractCaseNumbers(t);
  for (const c of ['Rev 1234/2019-2', 'Gž-123/18', 'U-III-1234/2018', 'Us I-45/2020']) assert.ok(got.includes(c), c);
  assert.ok(!got.some((c) => c.includes('35/05')), 'NN nije poslovni broj');
  assert.ok(!got.includes('C-415/11'), 'predmet Suda EU nije hrvatski poslovni broj');
});

test('ECLI', () => {
  const r = extractEcli('vidi ECLI:EU:C:2013:164 i ECLI:HR:VSRH:2019:1234.');
  assert.deepEqual(r, ['ECLI:EU:C:2013:164', 'ECLI:HR:VSRH:2019:1234']);
});

test('direktive i uredbe -> CELEX', () => {
  const t = 'Primjenjuje se Direktiva Vijeća 93/13/EEZ o nepoštenim uvjetima, Direktiva 2011/83/EU, ' +
    'Uredba (EU) 2016/679 (Opća uredba o zaštiti podataka), Uredba (EZ) br. 261/2004 te Direktiva (EU) 2019/1937.';
  const ids = extractEuActs(t).map((a) => a.celex).sort();
  assert.deepEqual(ids, ['31993L0013', '32004R0261', '32011L0083', '32016R0679', '32019L1937'].sort());
});

test('predmeti Suda EU', () => {
  const r = extractCjeuCases('kako je utvrdio Sud EU u predmetu C-415/11 (Aziz)');
  assert.equal(r[0].oznaka, 'C-415/11');
  assert.match(r[0].url, /curia\.europa\.eu/);
});

test('Povelja i EKLJP', () => {
  const r = extractEuReferences('čl. 47. Povelje Europske unije o temeljnim pravima; čl. 6. Konvencije za zaštitu ljudskih prava i temeljnih sloboda');
  assert.ok(r.eu.some((x) => x.vrsta === 'ugovor_povelja'));
  assert.equal(r.ekljp, true);
});

test('provjera citata', () => {
  const text = 'Sud je utvrdio da je ugovorna odredba o valutnoj klauzuli   ništetna jer nije bila jasna.';
  assert.equal(quoteInText('ugovorna odredba o valutnoj klauzuli ništetna', text), true);
  assert.equal(quoteInText('ugovorna odredba je valjana i jasna', text), false);
  assert.equal(quoteInText('kratko', text), false);
});

test('ključ poslovnog broja neovisan o zapisu', () => {
  assert.equal(caseKey('Rev 1234/2019-2'), caseKey('Rev-1234/19'));
  assert.equal(caseKey('Gž R-568/2021-2'), caseKey('Gž R 568/2021'));
  assert.equal(caseKey('U-III-1234/2018'), caseKey('U-III-1234/18'));
  assert.notEqual(caseKey('Rev 1234/2019'), caseKey('Revr 1234/2019'));
  assert.notEqual(caseKey('Gž-55/2019'), caseKey('Gž-55/2018'));
});

test('obična riječ ispred poslovnog broja nije dio oznake', () => {
  const got = extractCaseNumbers('Vidi Rev-100/20. Sud Rev 5/2020. Isto Gž-7/2019 te Gž R-568/2021-2 i Gž Ob-3/2020.');
  assert.deepEqual(got, ['Rev-100/20', 'Rev 5/2020', 'Gž-7/2019', 'Gž R-568/2021-2', 'Gž Ob-3/2020']);
});
