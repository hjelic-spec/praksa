// Izvoz odabranih odluka predmeta u .docx: citat za podnesak, doslovni citat iz odluke,
// pravno shvaćanje, kako odluku iskoristiti i bilješka odvjetnika.
import { Document, Packer, Paragraph, TextRun, HeadingLevel, ExternalHyperlink } from 'docx';

const GROUPS = [
  ['u prilog', 'Odluke u prilog našem stajalištu'],
  ['protiv', 'Odluke protiv našeg stajališta'],
  ['mješovito', 'Odluke s mješovitim stajalištem'],
  ['neutralno', 'Ostale odluke'],
];

// "Presuda Vrhovnog suda…" zahtijeva padež naziva suda, pa se koristi neutralan zapis:
// "Vrhovni sud Republike Hrvatske, Rev-49/2024-2 od 5.6.2024. (presuda), ECLI:…"
export function citationLine(d) {
  const m = d.meta ?? {};
  const parts = [m.sud, [m.poslovniBroj ?? d.naslov, m.datum && `od ${m.datum}`].filter(Boolean).join(' ')].filter(Boolean);
  let s = parts.join(', ');
  if (m.vrsta) s += ` (${m.vrsta.toLowerCase()})`;
  if (m.ecli) s += `, ${m.ecli}`;
  return s;
}

const p = (text, opts = {}) => new Paragraph({ children: [new TextRun({ text, ...opts })], spacing: { after: 120 } });
const labeled = (label, text) => (text
  ? new Paragraph({ children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun(text)], spacing: { after: 120 } })
  : null);

function decisionBlock(d) {
  const a = d.analiza;
  const t = d.tezina ?? {};
  const notes = [
    t.pravomocna === false && 'odluka nije pravomoćna',
    t.stara && `odluka je stara ${t.starost} godina – provjerite važeći propis`,
    a.primjenjivost?.upozorenje && `primjenjivost (procjena modela): ${a.primjenjivost.razlog}`,
  ].filter(Boolean);
  return [
    new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(citationLine(d))] }),
    new Paragraph({
      children: [new ExternalHyperlink({ link: d.url, children: [new TextRun({ text: d.url, style: 'Hyperlink' })] })],
      spacing: { after: 120 },
    }),
    a.citat ? p(`„${a.citat}“`, { italics: true }) : null,
    a.citat ? p(d.citatProvjeren ? 'Citat je provjeren u tekstu odluke.' : 'Upozorenje: citat nije pronađen doslovno u tekstu odluke – provjerite izvornik.', { size: 18, color: d.citatProvjeren ? '555555' : 'A12A2A' }) : null,
    labeled('Pravno shvaćanje', a.pravno_shvacanje),
    labeled('Ishod', a.ishod),
    labeled('Odnos prema našem stajalištu', a.smjer_obrazlozenje),
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
