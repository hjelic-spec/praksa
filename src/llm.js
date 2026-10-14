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

// Opis i stajalište su anonimizirani prije slanja (oznake poput OSOBA_1, ADRESA_1).
const ANON_NOTE = 'Osobni podaci u opisu zamijenjeni su oznakama (npr. OSOBA_1, ADRESA_1, DATUM_1); tretiraj ih kao imena/podatke iz predmeta.';

const stanceBlock = (stajaliste) => (stajaliste
  ? `\n<stajaliste_korisnika>\n${stajaliste}\n</stajaliste_korisnika>\n`
  : '\n<stajaliste_korisnika>nije navedeno</stajaliste_korisnika>\n');

export async function planQuery(opis, stajaliste = '') {
  return structured(PlanSchema, `Korisnik (odvjetnik) traži sudsku praksu za sljedeći opis (pojam, primjer ili događaj). ${ANON_NOTE}

<opis>
${opis}
</opis>
${stanceBlock(stajaliste)}
Razradi pravni problem i predloži upite za tražilicu odluka hrvatskih sudova (odluke.sudovi.hr). Upiti trebaju biti kratki (2-6 riječi), koristiti izraze kakve sudovi pišu u obrazloženjima (npr. "naknada nematerijalne štete prometna nesreća", "ništetnost valutne klauzule CHF"), a mogu sadržavati i oznaku propisa i članka.
Ako je navedeno stajalište korisnika, predloži upite koji pronalaze odluke u prilog tom stajalištu, ali i odluke koje mu se protive, jer i njih treba poznavati. Oznake anonimizacije ne stavljaj u upite.`, { effort: 'medium', maxTokens: 8000 });
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
  smjer: z.enum(['u prilog', 'protiv', 'mješovito', 'neutralno'])
    .describe('Odnos odluke prema stajalištu korisnika; "neutralno" ako stajalište nije navedeno ili odluka o njemu ne govori'),
  smjer_obrazlozenje: z.string().describe('Zašto odluka ide u prilog stajalištu ili protiv njega; prazno ako stajalište nije navedeno'),
  kako_iskoristiti: z.string()
    .describe('Ako je u prilog: kako se na nju pozvati u podnesku. Ako je protiv: po čemu se predmet korisnika razlikuje i kako joj se suprotstaviti. Prazno ako nije primjenjivo.'),
  primjenjivost: z.object({
    upozorenje: z.boolean(),
    razlog: z.string(),
  }).describe('Može li se odluka i danas primijeniti: je li donesena prema propisu koji je u međuvremenu izmijenjen ili zamijenjen (npr. ZOO 1978./2005., ZKP 1997./2008., kune/euri), ili je stajalište napušteno. Ovo je procjena modela; upozorenje=true samo ako postoji konkretan razlog.'),
});

export async function assessDecision(opis, plan, decision, tekst, stajaliste = '') {
  const meta = decision.meta ?? {};
  return structured(AssessmentSchema, `${ANON_NOTE}

<opis_korisnika>
${opis}
</opis_korisnika>
${stanceBlock(stajaliste)}
<metapodaci_odluke>${JSON.stringify({ sud: meta.sud, datum: meta.datum, vrsta: meta.vrsta, pravomocnost: meta.pravomocnost })}</metapodaci_odluke>

<razrada>
${JSON.stringify({ pravna_pitanja: plan.pravna_pitanja, kljucne_cinjenice: plan.kljucne_cinjenice })}
</razrada>

<odluka izvor="${decision.izvor}" url="${decision.url}">
${tekst}
</odluka>

Ocijeni odnosi li se ova odluka na opisani primjer ili događaj, kakav je njezin odnos prema stajalištu korisnika i analiziraj je prema shemi.`, { effort: 'medium' });
}

export const SynthesisSchema = z.object({
  pregled: z.string(),
  prevladavajuce_stajaliste: z.string(),
  razlike_u_praksi: z.string().describe('Proturječne ili razlikujuće odluke; prazno ako ih nema'),
  argumenti_u_prilog: z.string().describe('Najjači argumenti iz prakse za stajalište korisnika, s oznakama odluka; prazno ako stajalište nije navedeno'),
  argumenti_protiv_i_odgovor: z.string().describe('Odluke i argumenti protiv stajališta korisnika te kako im se suprotstaviti; prazno ako stajalište nije navedeno'),
  veza_s_pravom_eu: z.string().describe('Samo na temelju referenci navedenih u odlukama i jasno označenih pretpostavki'),
  preporuke_za_daljnje_istrazivanje: z.array(z.string()),
});

export async function synthesize(opis, analyses, stajaliste = '') {
  const compact = analyses.map((a) => ({
    oznaka: a.meta?.poslovniBroj ?? a.naslov,
    sud: a.meta?.sud,
    datum: a.meta?.datum,
    pravomocna: a.tezina?.pravomocna,
    podudaranje: a.analiza.podudaranje,
    relevantnost: a.analiza.relevantnost,
    smjer: a.analiza.smjer,
    smjer_obrazlozenje: a.analiza.smjer_obrazlozenje,
    ishod: a.analiza.ishod,
    pravno_shvacanje: a.analiza.pravno_shvacanje,
    upozorenje_primjenjivost: a.analiza.primjenjivost?.upozorenje ? a.analiza.primjenjivost.razlog : undefined,
    eu_reference_u_tekstu: a.euReference.map((r) => r.oznaka),
  }));
  return structured(SynthesisSchema, `${ANON_NOTE}

<opis_korisnika>
${opis}
</opis_korisnika>
${stanceBlock(stajaliste)}
Pri ocjeni prakse veću težinu daj odlukama viših sudova (Ustavni, Vrhovni) i pravomoćnim odlukama.

<analizirane_odluke>
${JSON.stringify(compact, null, 1)}
</analizirane_odluke>

Napravi sintezu sudske prakse isključivo na temelju ovih analiza.`, { effort: 'high' });
}
