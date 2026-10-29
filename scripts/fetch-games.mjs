/**
 * Merge version-group availability and the pre-evolution's National Dex id
 * onto the existing bundle. Does not touch artwork or other fields.
 *
 * A species is marked for a version group when English flavor text or a
 * regional Pokédex in that group includes it. Colosseum, XD, and the
 * Japanese-only Red/Green/Blue groups are left out. PokéAPI has no
 * Legends: Z-A version group, so that game is not invented here.
 *
 *   node scripts/fetch-games.mjs --probe
 *   node scripts/fetch-games.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ENDPOINT = "https://beta.pokeapi.co/graphql/v1beta";
const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "data", "pokemon.json");
const POKEDEX_JS_PATH = path.join(ROOT, "data", "pokedex.js");
const PROBE = process.argv.includes("--probe");

const SKIP = new Set(["colosseum", "xd", "red-green-japan", "blue-japan"]);

const GROUP_QUERY = `
query VersionGroups {
  pokemon_v2_versiongroup {
    name
    pokemon_v2_pokedexversiongroups { pokemon_v2_pokedex { name } }
  }
}`;

const QUERY = `
query Games($min: Int!, $max: Int!) {
  pokemon_v2_pokemonspecies(
    where: { id: { _gte: $min, _lte: $max } }
    order_by: { id: asc }
  ) {
    id
    evolves_from_species_id
    pokemon_v2_pokemondexnumbers { pokedex_number pokemon_v2_pokedex { name } }
    pokemon_v2_pokemonspeciesflavortexts(where: { language_id: { _eq: 9 } }) {
      pokemon_v2_version { pokemon_v2_versiongroup { name } }
    }
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
        await sleep(500 * (attempt + 1));
        continue;
      }
      const body = await res.json();
      if (body.errors) throw new Error(JSON.stringify(body.errors).slice(0, 500));
      return body.data.pokemon_v2_pokemonspecies;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
      await sleep(500 * (attempt + 1));
    }
  }
  throw new Error(`PokéAPI query ${min}-${max} failed: ${last}`);
}

const groupRes = await fetch(ENDPOINT, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({ query: GROUP_QUERY }),
});
if (!groupRes.ok) throw new Error(`HTTP ${groupRes.status} for version groups`);
const groupBody = await groupRes.json();
if (groupBody.errors) throw new Error(JSON.stringify(groupBody.errors).slice(0, 500));
const dexToGames = new Map();
for (const group of groupBody.data.pokemon_v2_versiongroup) {
  if (SKIP.has(group.name)) continue;
  for (const row of group.pokemon_v2_pokedexversiongroups ?? []) {
    const dexName = row.pokemon_v2_pokedex?.name;
    if (!dexName) continue;
    if (!dexToGames.has(dexName)) dexToGames.set(dexName, new Set());
    dexToGames.get(dexName).add(group.name);
  }
}

const pages = [];
const ranges = PROBE
  ? [[1, 10], [990, 1025]]
  : Array.from({ length: 11 }, (_, i) => [i * 100 + 1, i * 100 + 100]);

for (const [min, max] of ranges) {
  const rows = await gql(min, max);
  pages.push(...rows);
  process.stdout.write(`\rFetched species ${min}-${max} (${pages.length} rows)`);
}
process.stdout.write("\n");

const dexOfSpecies = new Map();
for (const species of pages) {
  const national = (species.pokemon_v2_pokemondexnumbers ?? []).find((row) => row.pokemon_v2_pokedex?.name === "national");
  const dex = national?.pokedex_number;
  if (dex) dexOfSpecies.set(species.id, dex);
}

const byDex = new Map();
const groups = new Set();
for (const species of pages) {
  const dex = dexOfSpecies.get(species.id);
  if (!dex) continue;
  const games = new Set();
  for (const text of species.pokemon_v2_pokemonspeciesflavortexts ?? []) {
    const name = text.pokemon_v2_version?.pokemon_v2_versiongroup?.name;
    if (!name || SKIP.has(name)) continue;
    games.add(name);
    groups.add(name);
  }
  for (const entry of species.pokemon_v2_pokemondexnumbers ?? []) {
    const linked = dexToGames.get(entry.pokemon_v2_pokedex?.name);
    if (!linked) continue;
    for (const name of linked) {
      games.add(name);
      groups.add(name);
    }
  }
  const fromId = species.evolves_from_species_id;
  const evolvesFrom = fromId ? (dexOfSpecies.get(fromId) ?? null) : null;
  byDex.set(dex, { games: [...games].sort(), evolvesFrom });
}

console.log("Version groups:", [...groups].sort().join(", "));
for (const id of [1, 2, 6, 1000]) {
  const row = byDex.get(id);
  console.log(`#${id}`, row ? JSON.stringify(row) : "missing");
}

if (PROBE) {
  console.log(`Probe only, ${byDex.size} species, files not written.`);
  process.exit(0);
}

const payload = JSON.parse(await readFile(DATA_PATH, "utf8"));
let filled = 0;
let missing = 0;
for (const mon of payload.pokemon) {
  const extra = byDex.get(mon.id);
  if (!extra) {
    missing += 1;
    mon.games = mon.games ?? [];
    mon.evolvesFrom = mon.evolvesFrom ?? null;
    continue;
  }
  mon.games = extra.games;
  mon.evolvesFrom = extra.evolvesFrom;
  filled += 1;
}
payload.generatedAt = new Date().toISOString();
console.log(`Filled ${filled} of ${payload.pokemon.length} (${missing} missing from the API)`);
const packed = JSON.stringify(payload);
await writeFile(DATA_PATH, packed);
await writeFile(POKEDEX_JS_PATH, `var POKEDEX_BUNDLE = ${packed};\n`);
console.log("Rewrote pokemon.json and pokedex.js");
