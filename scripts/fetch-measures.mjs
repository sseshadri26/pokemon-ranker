/**
 * Add base stats, size, catch rate, happiness, hatch time, growth, and gender
 * onto the existing bundle. Does not touch artwork.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ENDPOINT = "https://beta.pokeapi.co/graphql/v1beta";
const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "data", "pokemon.json");
const POKEDEX_JS_PATH = path.join(ROOT, "data", "pokedex.js");

const QUERY = `
query Measures($min: Int!, $max: Int!) {
  pokemon_v2_pokemon(
    where: { is_default: { _eq: true }, id: { _gte: $min, _lte: $max } }
    order_by: { id: asc }
  ) {
    height
    weight
    pokemon_v2_pokemonstats { base_stat pokemon_v2_stat { name } }
    pokemon_v2_pokemonspecy {
      capture_rate
      base_happiness
      gender_rate
      hatch_counter
      pokemon_v2_growthrate { name }
      pokemon_v2_pokemondexnumbers(where: { pokedex_id: { _eq: 1 } }) { pokedex_number }
    }
  }
}`;

async function gql(min, max) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { min, max } }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${min}-${max}`);
  const body = await res.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors).slice(0, 400));
  return body.data.pokemon_v2_pokemon;
}

const byDex = new Map();
for (let min = 1; min <= 1100; min += 100) {
  const rows = await gql(min, min + 99);
  for (const row of rows) {
    const species = row.pokemon_v2_pokemonspecy;
    const dex = species?.pokemon_v2_pokemondexnumbers?.[0]?.pokedex_number;
    if (!dex) continue;
    const stats = {};
    for (const stat of row.pokemon_v2_pokemonstats ?? []) stats[stat.pokemon_v2_stat.name] = stat.base_stat;
    byDex.set(dex, {
      hp: stats.hp ?? null,
      attack: stats.attack ?? null,
      defense: stats.defense ?? null,
      specialAttack: stats["special-attack"] ?? null,
      specialDefense: stats["special-defense"] ?? null,
      speed: stats.speed ?? null,
      heightM: row.height / 10,
      weightKg: row.weight / 10,
      captureRate: species.capture_rate,
      happiness: species.base_happiness,
      genderRate: species.gender_rate,
      hatch: species.hatch_counter,
      growth: species.pokemon_v2_growthrate?.name ?? null,
    });
  }
  process.stdout.write(`\rMeasures through id ${min + 99} (${byDex.size} species)`);
}
process.stdout.write("\n");

const payload = JSON.parse(await readFile(DATA_PATH, "utf8"));
let filled = 0;
for (const mon of payload.pokemon) {
  const extra = byDex.get(mon.id);
  if (!extra) continue;
  Object.assign(mon, extra);
  filled += 1;
}
console.log(`Filled ${filled} of ${payload.pokemon.length}`);
const packed = JSON.stringify(payload);
await writeFile(DATA_PATH, packed);
await writeFile(POKEDEX_JS_PATH, `var POKEDEX_BUNDLE = ${packed};\n`);
console.log("Rewrote pokemon.json and pokedex.js");
