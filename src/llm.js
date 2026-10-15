// Pozivi Claude API-ja: (1) razumijevanje upita, (2) predselekcija kandidata po isječcima,
// (3) analiza pojedine odluke kao presedana, (4) odgovor na upit.
// Svi odgovori su strukturirani (JSON shema), a pipeline.js ih zatim provjerava
// prema stvarnom tekstu odluke.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { config } from './config.js';
import { getApiKey } from './settings.js';

// Klijent se stvara ponovno kad korisnik u postavkama promijeni API ključ.
let client;
let clientKey;
function getClient() {
  const key = getApiKey();
  if (!key) throw new Error('API ključ nije postavljen. Upišite ga u Postavkama.');
  if (!client || clientKey !== key) { client = new Anthropic({ apiKey: key }); clientKey = key; }
  return client;
}

const SYSTEM = `Ti si pravni istraživač specijaliziran za hrvatsku sudsku praksu i pravo Europske unije. Pomažeš odvjetniku pronaći presedane za sudski postupak.
Pravila kojih se strogo držiš:
- Tvrdnje o sadržaju odluke temeljiš isključivo na tekstu odluke koji ti je dan. Ako nešto nije u tekstu, reci da nije navedeno.
- Citate prenosiš doslovno, bez ikakvih izmjena, jer se automatski provjeravaju u izvornom tekstu.
- Ne izmišljaš poslovne brojeve, ECLI oznake, nazive propisa ni predmete Suda EU. Ako nisi siguran, izostavi.
- Moguće poveznice s pravom EU koje nisu izričito navedene u odluci označavaš kao pretpostavke i obrazlažeš ih.
- Pišeš na hrvatskom jeziku, sažeto i precizno, stručnom pravnom terminologijom. Ne daješ pravni savjet.`;

const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };

// track(model, usage): bilježi potrošnju tokena (i kad odgovor ne uspije, jer se i tada naplaćuje).
async function structured(schema, userContent, { effort = 'medium', maxTokens = 16000, track } = {}) {
  const res = await getClient().beta.messages.parse({
    model: config.model,
    max_tokens: maxTokens,
    system: SYSTEM,
    output_config: { effort, format: betaZodOutputFormat(schema) },
    messages: [{ role: 'user', content: userContent }],
    ...FALLBACK,
  });
  track?.(res.model, res.usage);
  if (res.stop_reason === 'refusal') throw new Error('Model je odbio zahtjev.');
  if (res.stop_reason === 'max_tokens') throw new Error('Odgovor modela je prekinut (max_tokens).');
  if (!res.parsed_output) throw new Error('Odgovor modela nije u očekivanom obliku.');
  return res.parsed_output;
}

const EuLinks = z.array(z.object({ akt: z.string(), obrazlozenje: z.string() }));

// ---------- 1. razumijevanje upita ----------

export const PlanSchema = z.object({
  pravno_pitanje: z.string().describe('Precizno pravno pitanje na koje korisnik traži odgovor u sudskoj praksi'),
  trazeno_stajaliste: z.string().describe('Stajalište koje korisnik želi potkrijepiti, ako ga upit izražava (npr. "pretraga je nezakonita"); prazno ako ga nema'),
  kljucne_cinjenice: z.array(z.string()).describe('Činjenice iz upita bitne za usporedbu s odlukama'),
  upiti: z.array(z.string()).describe('5-8 kratkih upita za tražilicu odluka, hrvatskom pravnom terminologijom kakvu sudovi pišu u obrazloženjima'),
  relevantni_propisi_hr: z.array(z.string()).describe('Pretpostavke: hrvatski propisi i članci koji bi se mogli primjenjivati'),
  datum_od: z.string().describe('Ako upit ograničava razdoblje odluka: početni datum u obliku YYYY-MM-DD, inače prazno'),
  datum_do: z.string().describe('Ako upit ograničava razdoblje odluka: završni datum u obliku YYYY-MM-DD, inače prazno'),
});

export async function planQuery(opis, track) {
  return structured(PlanSchema, `Odvjetnik traži sudsku praksu (presedane) za sljedeći upit:

<upit>
${opis}
</upit>

Odredi precizno pravno pitanje i, ako ga upit izražava, stajalište koje korisnik želi potkrijepiti.
Predloži upite za tražilicu odluka hrvatskih sudova (odluke.sudovi.hr): kratke (2-6 riječi), izrazima kakve sudovi pišu u obrazloženjima (npr. "naknada nematerijalne štete prometna nesreća", "nezakonit dokaz pretraga bez naloga"), po potrebi s oznakom propisa i članka. Uključi upite koji pronalaze i odluke protiv traženog stajališta.
Ako upit spominje razdoblje (npr. "od 2020."), upiši datume; inače ih ostavi prazne.`, { effort: 'medium', maxTokens: 8000, track });
}

// ---------- 2. predselekcija po isječcima ----------

export const ScreeningSchema = z.object({
  odabrane: z.array(z.object({
    id: z.number().int().describe('Redni broj kandidata iz popisa'),
    ocjena: z.number().int().describe('0-100: koliko je vjerojatno da odluka odgovara na pravno pitanje'),
  })).describe('Najrelevantniji kandidati, od najboljeg prema slabijem'),
});

export async function screenCandidates(plan, candidates, n, track) {
  const list = candidates.map((c, i) => `[${i}] ${[c.naslov, c.sud, c.datum, c.pravomocnost].filter(Boolean).join(' · ')}\n${(c.isjecak ?? '').slice(0, 700)}`).join('\n\n');
  return structured(ScreeningSchema, `<pravno_pitanje>${plan.pravno_pitanje}</pravno_pitanje>
<kljucne_cinjenice>${plan.kljucne_cinjenice.join('; ')}</kljucne_cinjenice>

<kandidati>
${list}
</kandidati>

Na temelju isječaka odaberi najviše ${n} odluka koje najvjerojatnije odgovaraju na pravno pitanje (sudovi odlučuju o istom ili vrlo sličnom pitanju). Prednost daj višim sudovima kad su isječci podjednako relevantni. Ne odabiri odluke koje se samo površno podudaraju pojmovima.`, { effort: 'low', maxTokens: 4000, track });
}

// ---------- 3. analiza odluke kao presedana ----------

export const AssessmentSchema = z.object({
  relevantnost: z.number().int().describe('0-100: koliko odluka odgovara na pravno pitanje korisnika'),
  podudaranje: z.enum(['da', 'djelomično', 'ne']).describe('Odlučuje li sud o istom pravnom pitanju'),
  odgovor_na_upit: z.string().describe('Jedna kratka rečenica (najviše 30 riječi): što ova odluka govori o pravnom pitanju korisnika'),
  pravno_pitanje: z.string().describe('Pravno pitanje o kojem je sud odlučivao'),
  pravno_shvacanje: z.string().describe('Ratio decidendi: pravno pravilo na kojem odluka počiva, općenito formulirano tako da se može primijeniti na druge predmete; 1-3 rečenice, najviše 60 riječi'),
  citati: z.array(z.object({
    tekst: z.string().describe('Doslovni citat iz obrazloženja, bez ikakvih izmjena'),
    znacaj: z.string().describe('Što citat potvrđuje (npr. "pravno shvaćanje", "ocjena dokaza")'),
  })).describe('1-3 doslovna citata koja se mogu navesti u podnesku; prvi je najvažniji'),
  bitne_cinjenice: z.string().describe('Činjenice na kojima je sud utemeljio odluku'),
  razlike_od_upita: z.string().describe('Po čemu se činjenice ili pravno pitanje razlikuju od korisnikova slučaja; prazno ako nema bitnih razlika'),
  ishod: z.string().describe('Kako je sud odlučio (izreka)'),
  primijenjeni_propisi: z.array(z.string()).describe('Samo propisi i članci navedeni u tekstu odluke'),
  smjer: z.enum(['u prilog', 'protiv', 'mješovito', 'neutralno'])
    .describe('Odnos odluke prema traženom stajalištu; "neutralno" ako stajalište nije navedeno'),
  kako_iskoristiti: z.string()
    .describe('Ako je u prilog: kako se na nju pozvati. Ako je protiv: kako je razlikovati ili joj se suprotstaviti. Prazno ako nije primjenjivo.'),
  primjenjivost: z.object({ upozorenje: z.boolean(), razlog: z.string() })
    .describe('Može li se odluka i danas primijeniti (izmijenjen ili zamijenjen propis, napušteno stajalište). Procjena modela; upozorenje=true samo uz konkretan razlog.'),
  moguce_eu_poveznice: EuLinks.describe('Pretpostavke o vezi s pravom EU koje NISU izričito navedene u odluci'),
});

export async function assessDecision(opis, plan, decision, tekst, track) {
  const meta = decision.meta ?? {};
  return structured(AssessmentSchema, `<upit_korisnika>
${opis}
</upit_korisnika>

<razrada>${JSON.stringify({ pravno_pitanje: plan.pravno_pitanje, trazeno_stajaliste: plan.trazeno_stajaliste, kljucne_cinjenice: plan.kljucne_cinjenice })}</razrada>

<metapodaci_odluke>${JSON.stringify({ sud: meta.sud, datum: meta.datum, vrsta: meta.vrsta, pravomocnost: meta.pravomocnost })}</metapodaci_odluke>

<odluka url="${decision.url}">
${tekst}
</odluka>

Analiziraj odluku kao mogući presedan za upit korisnika, prema shemi.`, { effort: 'medium', track });
}

// ---------- 4. odgovor na upit ----------

export const AnswerSchema = z.object({
  kratki_odgovor: z.string().describe('Izravan odgovor na upit u 2-3 rečenice (najviše 70 riječi), s uputama na odluke u obliku [1], [2]'),
  vodeca_praksa: z.string().describe('Prevladavajuće stajalište sudova u jednoj ili dvije rečenice (najviše 45 riječi), s uputama [n]; bez ponavljanja kratkog odgovora i bez nabrajanja pojedinosti iz odluka'),
  suprotna_praksa: z.string().describe('Odluke koje odstupaju ili idu protiv traženog stajališta, jednom rečenicom (najviše 35 riječi) s uputama [n]; prazno ako ih nema'),
  upozorenja: z.array(z.string()).describe('Najviše 3 kratka upozorenja (npr. nema odluka viših sudova, odluke su stare), svako do 20 riječi'),
  dalje_provjeriti: z.array(z.string()).describe('Što još provjeriti ili potražiti'),
  veza_s_pravom_eu: z.string().describe('Samo na temelju referenci u odlukama i jasno označenih pretpostavki; prazno ako je nema'),
});

export async function answerQuery(opis, plan, items, track) {
  const compact = items.map((a, i) => ({
    br: i + 1,
    oznaka: a.meta?.poslovniBroj ?? a.naslov,
    sud: a.meta?.sud,
    datum: a.meta?.datum,
    pravomocna: a.tezina?.pravomocna,
    relevantnost: a.analiza.relevantnost,
    smjer: a.analiza.smjer,
    odgovor_na_upit: a.analiza.odgovor_na_upit,
    pravno_shvacanje: a.analiza.pravno_shvacanje,
    ishod: a.analiza.ishod,
    upozorenje_primjenjivost: a.analiza.primjenjivost?.upozorenje ? a.analiza.primjenjivost.razlog : undefined,
    eu_reference_u_tekstu: a.euReference.map((r) => r.oznaka),
  }));
  return structured(AnswerSchema, `<upit_korisnika>
${opis}
</upit_korisnika>

<razrada>${JSON.stringify({ pravno_pitanje: plan.pravno_pitanje, trazeno_stajaliste: plan.trazeno_stajaliste })}</razrada>

<odluke>
${JSON.stringify(compact, null, 1)}
</odluke>

Odgovori na upit isključivo na temelju ovih odluka, sažeto – pojedinosti su na karticama odluka, pa ih ne ponavljaj. Upućuj na odluke njihovim brojem [br]. Veću težinu daj višim sudovima (Ustavni, Vrhovni) i pravomoćnim odlukama.`, { effort: 'high', track });
}
