// Izvoz spremljenih odluka predmeta u .docx, složenih kao presedani: navod za podnesak,
// pravno shvaćanje, doslovni citati (s oznakom provjere), bitne činjenice, razlike u odnosu
// na upit, ishod, propisi i bilješka odvjetnika.
import { Document, Packer, Paragraph, TextRun, HeadingLevel, ExternalHyperlink } from 'docx';
import { citationLine } from './authority.js';

export { citationLine };

const GROUPS = [
  ['u prilog', 'Odluke u prilog traženom stajalištu'],
  ['protiv', 'Odluke protiv traženog stajališta'],
  ['mješovito', 'Odluke s mješovitim stajalištem'],
  ['neutralno', 'Odluke'],
];

const p = (text, opts = {}) => new Paragraph({ children: [new TextRun({ text, ...opts })], spacing: { after: 120 } });
const labeled = (label, text) => (text
  ? new Paragraph({ children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun(text)], spacing: { after: 120 } })
  : null);

// Spremljeni rezultati starijih verzija imaju jedan citat (citat + citatProvjeren).
export function quotesOf(d) {
  const a = d.analiza;
  if (Array.isArray(a.citati)) return a.citati;
  return a.citat ? [{ tekst: a.citat, znacaj: '', provjeren: Boolean(d.citatProvjeren) }] : [];
}

function decisionBlock(d) {
  const a = d.analiza;
  const t = d.tezina ?? {};
  const notes = [
    t.pravomocna === false && 'odluka nije pravomoćna',
    t.stara && `odluka je stara ${t.starost} godina – provjerite važeći propis`,
    a.primjenjivost?.upozorenje && `primjenjivost (procjena modela): ${a.primjenjivost.razlog}`,
  ].filter(Boolean);
  const quotes = quotesOf(d).flatMap((c) => [
    p(`„${c.tekst}“`, { italics: true }),
    p(c.provjeren ? `Citat je provjeren u tekstu odluke${c.znacaj ? ` (${c.znacaj})` : ''}.` : 'Upozorenje: citat nije pronađen doslovno u tekstu odluke – provjerite izvornik.',
      { size: 18, color: c.provjeren ? '555555' : 'A12A2A' }),
  ]);
  return [
    new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(d.navod ?? citationLine(d))] }),
    new Paragraph({
      children: [new ExternalHyperlink({ link: d.url, children: [new TextRun({ text: d.url, style: 'Hyperlink' })] })],
      spacing: { after: 120 },
    }),
    labeled('Pravno shvaćanje', a.pravno_shvacanje),
    ...quotes,
    labeled('Pravno pitanje', a.pravno_pitanje),
    labeled('Bitne činjenice', a.bitne_cinjenice ?? a.cinjenice_predmeta),
    labeled('Razlike u odnosu na naš predmet', a.razlike_od_upita),
    labeled('Ishod', a.ishod),
    labeled('Primijenjeni propisi', (a.primijenjeni_propisi ?? []).join('; ')),
    labeled(a.smjer === 'protiv' ? 'Kako se suprotstaviti' : 'Kako iskoristiti', a.kako_iskoristiti),
    labeled('Napomene', notes.join('; ')),
    labeled('Bilješka', d.biljeska),
  ].filter(Boolean);
}

export async function buildDocx(predmet, decisions) {
  const children = [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(`Sudska praksa – ${predmet.naziv}`)] }),
    p(`Izvezeno ${new Date().toLocaleDateString('hr-HR')} Odabrano odluka: ${decisions.length}.`, { color: '555555' }),
  ];
  for (const [key, title] of GROUPS) {
    const group = decisions.filter((d) => (d.analiza.smjer ?? 'neutralno') === key)
      .sort((a, b) => (a.tezina?.razina ?? 9) - (b.tezina?.razina ?? 9) || b.analiza.relevantnost - a.analiza.relevantnost);
    if (!group.length) continue;
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(title)] }));
    for (const d of group) children.push(...decisionBlock(d));
  }
  children.push(p('Analize, sažetke i ocjene izradio je jezični model; prije upotrebe u podnesku provjerite izvornu odluku.', { size: 18, color: '555555', italics: true }));
  const doc = new Document({
    creator: 'Preglednik sudske prakse',
    title: `Sudska praksa – ${predmet.naziv}`,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}
