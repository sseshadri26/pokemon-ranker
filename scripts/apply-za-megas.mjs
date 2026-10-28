/**
 * Patch the current bundle in place:
 *   - `evolves` from PokéAPI (a species evolves when another National Dex
 *     species lists it as evolves_from)
 *   - Legends Z-A mega forms from scripts/za-megas.mjs
 *
 * Downloads only za*.webp portraits. Existing p*.webp / f*.webp files are not fetched.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ZA_MEGAS, applyZaMegas, artUrls, downloadPortrait } from "./za-megas.mjs";

const ENDPOINT = "https://beta.pokeapi.co/graphql/v1beta";
const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "data", "pokemon.json");
const POKEDEX_JS_PATH = path.join(ROOT, "data", "pokedex.js");
const ART_DIR = path.join(ROOT, "artwork");

const QUERY = `
query SpeciesParents($min: Int!, $max: Int!) {
  pokemon_v2_pokemonspecies(
    where: { id: { _gte: $min, _lte: $max } }
    order_by: { id: asc }
  ) {
    id
    evolves_from_species_id
    pokemon_v2_pokemondexnumbers(where: { pokedex_id: { _eq: 1 } }) { pokedex_number }
  }
}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function gql(min, max) {
  let last = "unknown error";
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ query: QUERY, variables: { min, max } }),
      });
      if (!res.ok) {
        last = `HTTP ${res.status}`;
        await sleep(400 * (attempt + 1));
        continue;
      }
      const body = await res.json();
      if (body.errors) throw new Error(JSON.stringify(body.errors).slice(0, 500));
      return body.data.pokemon_v2_pokemonspecies;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
      await sleep(400 * (attempt + 1));
    }
  }
  throw new Error(`PokéAPI query ${min}-${max} failed: ${last}`);
}

/** Species ids that some other National Dex species evolves from. */
export function evolvesIdsFrom(rows) {
  const dexOf = new Map();
  for (const row of rows) {
    const dex = row.pokemon_v2_pokemondexnumbers?.[0]?.pokedex_number;
    if (dex) dexOf.set(row.id, dex);
  }
  const children = new Map();
  for (const row of rows) {
    const child = dexOf.get(row.id);
    const parent = row.evolves_from_species_id ? dexOf.get(row.evolves_from_species_id) : null;
    if (child == null || parent == null || parent === child) continue;
    if (!children.has(parent)) children.set(parent, new Set());
    children.get(parent).add(child);
  }
  return children;
}

function withEvolves(mon, evolves) {
  const next = {};
  for (const [key, value] of Object.entries(mon)) {
    if (key === "evolves") continue;
    next[key] = value;
    if (key === "stage") next.evolves = evolves;
  }
  if (next.evolves === undefined) next.evolves = evolves;
  return next;
}

async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}

async function main() {
  const rows = [];
  for (let min = 1; min <= 1100; min += 100) {
    rows.push(...(await gql(min, min + 99)));
    process.stdout.write(`\rEvolution links through species id ${min + 99} (${rows.length} rows)`);
  }
  process.stdout.write("\n");
  const children = evolvesIdsFrom(rows);

  const payload = JSON.parse(await readFile(DATA_PATH, "utf8"));
  const before = payload.pokemon.length;
  payload.pokemon = payload.pokemon.map((mon) => withEvolves(mon, children.has(mon.id)));
  const added = applyZaMegas(payload.pokemon);
  payload.generatedAt = new Date().toISOString();

  console.log(`Patching ${before} species. New Z-A forms: ${added.length}. Downloading only za*.webp.`);
  let done = 0;
  const results = await mapPool(ZA_MEGAS, 6, async (entry) => {
    const dest = path.join(ART_DIR, entry.file);
    const result = await downloadPortrait(artUrls(entry), dest);
    done += 1;
    if (done % 8 === 0 || done === ZA_MEGAS.length) {
      process.stdout.write(`\rZ-A artwork ${done}/${ZA_MEGAS.length}`);
    }
    return { entry, result };
  });
  process.stdout.write("\n");

  const failed = [];
  const byId = new Map(payload.pokemon.map((mon) => [mon.id, mon]));
  for (const { entry, result } of results) {
    const form = byId.get(entry.dex)?.forms.find((item) => item.name === entry.name);
    if (!form) continue;
    if (result.ok) form.art = entry.file;
    else {
      form.art = null;
      failed.push(entry);
    }
  }

  const packed = JSON.stringify(payload);
  await writeFile(DATA_PATH, packed);
  await writeFile(POKEDEX_JS_PATH, `var POKEDEX_BUNDLE = ${packed};\n`);

  const evolving = payload.pokemon.filter((mon) => mon.evolves).length;
  console.log(`evolves=true for ${evolving} of ${payload.pokemon.length} species`);
  const show = [1, 2, 6, 21, 22, 128, 132];
  for (const id of show) {
    const mon = byId.get(id);
    console.log(`  #${id} ${mon.name} stage ${mon.stage} evolves ${mon.evolves}`);
  }
  const stage3 = payload.pokemon.filter((mon) => mon.stage >= 3 && mon.evolves);
  console.log(`stage >= 3 that still evolve: ${stage3.length}`);
  if (failed.length === 0) console.log("All Z-A mega artwork downloaded.");
  else {
    console.log(`Art download failed (${failed.length}):`);
    for (const entry of failed) console.log(`  ${entry.name} #${entry.dex} ${entry.file}`);
  }
}

await main();
