// Pozivi Claude API-ja: (1) razrada upita, (2) analiza pojedine odluke, (3) sinteza.
// Svi odgovori su strukturirani (JSON shema), a pipeline.js ih zatim provjerava
// prema stvarnom tekstu odluke.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { config } from './config.js';

let client;
const getClient = () => (client ??= new Anthropic());

const SYSTEM = `Ti si pravni istraživač specijaliziran za hrvatsku sudsku praksu i pravo Europske unije.
Pravila kojih se strogo držiš:
- Tvrdnje o sadržaju odluke temeljiš isključivo na tekstu odluke koji ti je dan. Ako nešto nije u tekstu, reci da nije navedeno.
- Citate prenosiš doslovno, bez ikakvih izmjena, jer se automatski provjeravaju u izvornom tekstu.
- Ne izmišljaš poslovne brojeve, ECLI oznake, nazive propisa ni predmete Suda EU. Ako nisi siguran, izostavi.
- Moguće poveznice s pravom EU koje nisu izričito navedene u odluci označavaš kao pretpostavke i obrazlažeš ih.
- Pišeš na hrvatskom jeziku, sažeto i precizno. Ne daješ pravni savjet.`;

const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };

async function structured(schema, userContent, { effort = 'medium', maxTokens = 16000 } = {}) {
  const res = await getClient().beta.messages.parse({
    model: config.model,
    max_tokens: maxTokens,
    system: SYSTEM,
    output_config: { effort, format: betaZodOutputFormat(schema) },
    messages: [{ role: 'user', content: userContent }],
    ...FALLBACK,
  });
  if (res.stop_reason === 'refusal') throw new Error('Model je odbio zahtjev.');
  if (res.stop_reason === 'max_tokens') throw new Error('Odgovor modela je prekinut (max_tokens).');
  if (!res.parsed_output) throw new Error('Odgovor modela nije u očekivanom obliku.');
  return res.parsed_output;
}

export const PlanSchema = z.object({
  sazetak_problema: z.string(),
  pravna_pitanja: z.array(z.string()),
  kljucne_cinjenice: z.array(z.string()),
  upiti: z.array(z.string()).describe('3-8 kratkih upita za tražilicu odluka, na hrvatskom, pravnom terminologijom koju sudovi koriste'),
  pravna_podrucja: z.array(z.string()),
  relevantni_propisi_hr: z.array(z.string()).describe('Pretpostavke: hrvatski propisi koji bi se mogli primjenjivati'),
  moguce_eu_poveznice: z.array(z.object({ akt: z.string(), obrazlozenje: z.string() })).describe('Pretpostavke, ne utvrđene činjenice'),
});

export async function planQuery(opis) {
  return structured(PlanSchema, `Korisnik traži sudsku praksu za sljedeći opis (pojam, primjer ili događaj):

<opis>
${opis}
</opis>

Razradi pravni problem i predloži upite za tražilicu odluka hrvatskih sudova (odluke.sudovi.hr). Upiti trebaju biti kratki (2-6 riječi), koristiti izraze kakve sudovi pišu u obrazloženjima (npr. "naknada nematerijalne štete prometna nesreća", "ništetnost valutne klauzule CHF"), a mogu sadržavati i oznaku propisa i članka.`, { effort: 'medium', maxTokens: 8000 });
}

export const AssessmentSchema = z.object({
  relevantnost: z.number().int().describe('0-100'),
  podudaranje: z.enum(['da', 'djelomično', 'ne']).describe('Odnosi li se odluka na opisani primjer/događaj'),
  objasnjenje: z.string().describe('Zašto odluka jest ili nije relevantna za opis'),
  cinjenice_predmeta: z.string(),
  ishod: z.string().describe('Kako je sud odlučio'),
  pravno_shvacanje: z.string().describe('Ključno pravno stajalište suda'),
  zasto_je_vazno: z.string(),
  citat: z.string().describe('Doslovni citat iz teksta odluke koji najbolje potkrepljuje relevantnost; prazno ako nema'),
  primijenjeni_propisi: z.array(z.string()).describe('Samo propisi navedeni u tekstu odluke'),
  moguce_eu_poveznice: z.array(z.object({ akt: z.string(), obrazlozenje: z.string() })).describe('Pretpostavke o vezi s pravom EU koje NISU izričito navedene u odluci'),
});

export async function assessDecision(opis, plan, decision, tekst) {
  return structured(AssessmentSchema, `<opis_korisnika>
${opis}
</opis_korisnika>

<razrada>
${JSON.stringify({ pravna_pitanja: plan.pravna_pitanja, kljucne_cinjenice: plan.kljucne_cinjenice })}
</razrada>

<odluka izvor="${decision.izvor}" url="${decision.url}">
${tekst}
</odluka>

Ocijeni odnosi li se ova odluka na opisani primjer ili događaj i analiziraj je prema shemi.`, { effort: 'medium' });
}

export const SynthesisSchema = z.object({
  pregled: z.string(),
  prevladavajuce_stajaliste: z.string(),
  razlike_u_praksi: z.string().describe('Proturječne ili razlikujuće odluke; prazno ako ih nema'),
  veza_s_pravom_eu: z.string().describe('Samo na temelju referenci navedenih u odlukama i jasno označenih pretpostavki'),
  preporuke_za_daljnje_istrazivanje: z.array(z.string()),
});

export async function synthesize(opis, analyses) {
  const compact = analyses.map((a) => ({
    oznaka: a.meta?.poslovniBroj ?? a.naslov,
    sud: a.meta?.sud,
    podudaranje: a.analiza.podudaranje,
    relevantnost: a.analiza.relevantnost,
    ishod: a.analiza.ishod,
    pravno_shvacanje: a.analiza.pravno_shvacanje,
    eu_reference_u_tekstu: a.euReference.map((r) => r.oznaka),
  }));
  return structured(SynthesisSchema, `<opis_korisnika>
${opis}
</opis_korisnika>

<analizirane_odluke>
${JSON.stringify(compact, null, 1)}
</analizirane_odluke>

Napravi sintezu sudske prakse isključivo na temelju ovih analiza.`, { effort: 'high' });
}
