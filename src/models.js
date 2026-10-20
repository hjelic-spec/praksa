// Modeli koje administrator može odabrati u Postavkama. Svi podržavaju ono što aplikacija
// šalje (strukturirani izlaz, output_config.effort, fallbacks: "default"); kod modela bez
// zamjenskog modela (Haiku 5.5) zahtjev se tada izvodi samo na odabranom modelu.
// Cijene se ne pišu ovdje nego dolaze iz cjenika (src/pricing.js).
export const MODELS = [
  { id: 'claude-opus-5-5', naziv: 'Claude Opus 5.5', opis: 'zadani; preporučeno za pravnu analizu' },
  { id: 'claude-sonnet-5-5', naziv: 'Claude Sonnet 5.5', opis: 'upola jeftiniji od Opusa; kvalitetu analize treba provjeriti' },
  { id: 'claude-haiku-5-5', naziv: 'Claude Haiku 5.5', opis: 'najjeftiniji i najbrži; namijenjen jednostavnijim zadacima, slabija analiza' },
  { id: 'claude-fable-5-1', naziv: 'Claude Fable 5.1', opis: 'najsposobniji, oko 2,5 puta skuplji od Opusa i sporiji' },
];

export const DEFAULT_MODEL = 'claude-opus-5-5';

export const isKnownModel = (id) => MODELS.some((m) => m.id === id);
