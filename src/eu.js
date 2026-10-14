// Provjera EU akata u službenom repozitoriju Ureda za publikacije EU (CELLAR, SPARQL).
// Upit nije testiran iz razvojnog okruženja (pristup je bio blokiran) – zato svaki
// neuspjeh vraća status "neprovjereno", a nikad "ne postoji".
import { config } from './config.js';

const ENDPOINT = 'https://publications.europa.eu/webapi/rdf/sparql';
const cache = new Map();

export async function verifyCelex(celex) {
  if (!config.verifyEuViaSparql || !/^[0-9A-Z/]+$/.test(celex)) return 'neprovjereno';
  if (cache.has(celex)) return cache.get(celex);
  const query = `PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
ASK { ?w cdm:resource_legal_id_celex ?c . FILTER(?c = "${celex}"^^xsd:string) }`;
  let status = 'neprovjereno';
  try {
    const url = `${ENDPOINT}?query=${encodeURIComponent(query)}&format=${encodeURIComponent('application/sparql-results+json')}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/sparql-results+json' } });
    if (res.ok) {
      const json = await res.json();
      status = json.boolean === true ? 'potvrđeno' : 'nije potvrđeno u CELLAR-u';
    }
  } catch { /* mreža nedostupna – ostaje neprovjereno */ }
  cache.set(celex, status);
  return status;
}

export async function verifyAll(refs) {
  return Promise.all(refs.map(async (r) => (r.celex ? { ...r, provjera: await verifyCelex(r.celex) } : r)));
}
