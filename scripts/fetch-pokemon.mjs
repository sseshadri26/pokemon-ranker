/**
 * Pull every National Dex species from PokéAPI and write:
 *   data/pokemon.json
 *   data/pokedex.js
 *   artwork/*.webp
 *   artwork/_manifest.json
 *
 * Re-running skips artwork that is already on disk. The page itself does not
 * run this script; the bundle in the repo is what index.html opens.
 * After a refetch, run scripts/fetch-measures.mjs and scripts/fetch-games.mjs
 * so stats, game availability, and evolvesFrom stay on the bundle.
 */
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyZaMegas, downloadPortrait, sortForms } from "./za-megas.mjs";
import { pruneForms } from "./redundant-forms.mjs";

const ENDPOINT = "https://beta.pokeapi.co/graphql/v1beta";
const SPRITE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";
const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "data", "pokemon.json");
const POKEDEX_JS_PATH = path.join(ROOT, "data", "pokedex.js");
const ART_DIR = path.join(ROOT, "artwork");
const MANIFEST_PATH = path.join(ART_DIR, "_manifest.json");

const STARTER_BASES = new Set([
  1, 4, 7, 152, 155, 158, 252, 255, 258, 387, 390, 393, 495, 498, 501, 650, 653, 656, 722,
  725, 728, 810, 813, 816, 906, 909, 912,
]);

const QUERY = `
query Species($min: Int!, $max: Int!) {
  pokemon_v2_pokemonspecies(
    where: { id: { _gte: $min, _lte: $max } }
    order_by: { id: asc }
  ) {
    id
    name
    generation_id
    is_legendary
    is_mythical
    is_baby
    evolves_from_species_id
    pokemon_v2_pokemoncolor { name }
    pokemon_v2_pokemonshape { name }
    pokemon_v2_pokemonhabitat { name }
    pokemon_v2_pokemonegggroups { pokemon_v2_egggroup { name } }
    pokemon_v2_pokemonspeciesnames(where: { language_id: { _eq: 9 } }) { name }
    pokemon_v2_pokemondexnumbers(where: { pokedex_id: { _eq: 1 } }) { pokedex_number }
    pokemon_v2_pokemons {
      id
      name
      is_default
      pokemon_v2_pokemontypes(order_by: { slot: asc }) {
        slot
        pokemon_v2_type { name }
      }
      pokemon_v2_pokemonforms(order_by: { form_order: asc }) {
        id
        name
        form_name
        is_mega
        is_default
        form_order
        pokemon_v2_pokemonformnames(where: { language_id: { _eq: 9 } }) {
          name
          pokemon_name
        }
      }
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
        await sleep(400 * (attempt + 1));
        continue;
      }
      const body = await res.json();
      if (body.errors) {
        throw new Error(JSON.stringify(body.errors).slice(0, 500));
      }
      return body.data.pokemon_v2_pokemonspecies;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
      await sleep(400 * (attempt + 1));
    }
  }
  throw new Error(`PokéAPI query ${min}-${max} failed: ${last}`);
}

function typesOf(variety) {
  return (variety?.pokemon_v2_pokemontypes ?? [])
    .slice()
    .sort((a, b) => a.slot - b.slot)
    .map((row) => row.pokemon_v2_type.name);
}

function formKind(formName, isMega, speciesDefault) {
  const name = (formName || "").toLowerCase();
  if (isMega || name.includes("mega")) return "mega";
  if (name.includes("gmax")) return "gmax";
  if (/(alola|galar|hisui|paldea)/.test(name)) return "regional";
  if (speciesDefault) return "default";
  return "other";
}

function formDisplayName(speciesName, form) {
  const localized = form?.pokemon_v2_pokemonformnames?.[0];
  const pokemonName = localized?.pokemon_name?.trim();
  const label = localized?.name?.trim();
  if (pokemonName) return pokemonName;
  if (label) return `${speciesName} (${label})`;
  if (form?.form_name) return `${speciesName} (${form.form_name})`;
  return speciesName;
}

function stageOf(id, parentOf, guard = new Set()) {
  if (guard.has(id)) return 1;
  const parent = parentOf.get(id);
  if (parent == null) return 1;
  guard.add(id);
  return stageOf(parent, parentOf, guard) + 1;
}

function starterLine(id, parentOf) {
  const guard = new Set();
  let current = id;
  while (current != null && !guard.has(current)) {
    if (STARTER_BASES.has(current)) return true;
    guard.add(current);
    current = parentOf.get(current) ?? null;
  }
  return false;
}

/**
 * Sprite files are named by pokemon id, not pokemon-form id. Those numbers
 * collide: Spewpa's polar form is form 10290, and pokemon 10290 is Mega
 * Eelektross. Fetching sprites/pokemon/{formId}.png painted that mega onto Spewpa.
 */
function artworkUrls({ pokemonId, formName, hiresFirst }) {
  const urls = [];
  if (hiresFirst) {
    urls.push(`${SPRITE}/other/official-artwork/${pokemonId}.png`);
    urls.push(`${SPRITE}/other/home/${pokemonId}.png`);
  }
  if (formName) {
    // Cosmetic forms (Unown, Vivillon, Alcremie...) have official art or a HOME render
    // under {pokemonId}-{formName}. Prefer those to the 96px game sprite.
    // scripts/upgrade-form-art.mjs applies the same upgrade to an existing artwork folder.
    urls.push(`${SPRITE}/other/official-artwork/${pokemonId}-${formName}.png`);
    urls.push(`${SPRITE}/other/home/${pokemonId}-${formName}.png`);
    urls.push(`${SPRITE}/${pokemonId}-${formName}.png`);
  }
  urls.push(`${SPRITE}/${pokemonId}.png`);
  if (!hiresFirst) urls.push(`${SPRITE}/other/official-artwork/${pokemonId}.png`);
  return [...new Set(urls)];
}

function isBaseSpeciesSprite(url, pokemonId) {
  if (!url || pokemonId == null) return false;
  const id = String(pokemonId);
  return (
    url.endsWith(`/pokemon/${id}.png`) ||
    url.endsWith(`/official-artwork/${id}.png`) ||
    url.endsWith(`/home/${id}.png`)
  );
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

async function downloadArtwork(urls, dest) {
  const result = await downloadPortrait(urls, dest);
  return { url: result.url, cached: result.cached };
}

function isPixelSource(url) {
  return !url.includes("official-artwork") && !url.includes("/home/");
}

async function main() {
  await mkdir(path.dirname(DATA_PATH), { recursive: true });
  await mkdir(ART_DIR, { recursive: true });

  const pages = [];
  for (let min = 1; min <= 1100; min += 100) {
    const rows = await gql(min, min + 99);
    pages.push(...rows);
    process.stdout.write(`\rFetched species metadata through #${min + 99} (${pages.length} rows)`);
  }
  process.stdout.write("\n");

  const dexOfSpecies = new Map();
  for (const species of pages) {
    const dex = species.pokemon_v2_pokemondexnumbers?.[0]?.pokedex_number;
    if (dex) dexOfSpecies.set(species.id, dex);
  }
  const parentOf = new Map();
  for (const species of pages) {
    const dex = dexOfSpecies.get(species.id);
    if (!dex) continue;
    const from = species.evolves_from_species_id;
    parentOf.set(dex, from ? (dexOfSpecies.get(from) ?? null) : null);
  }
  const children = new Map();
  for (const [dex, parent] of parentOf) {
    if (parent == null || parent === dex) continue;
    if (!children.has(parent)) children.set(parent, new Set());
    children.get(parent).add(dex);
  }

  const jobs = [];
  const drafted = [];
  for (const species of pages) {
    const id = dexOfSpecies.get(species.id);
    if (!id) continue;
    const name = species.pokemon_v2_pokemonspeciesnames?.[0]?.name ?? species.name;
    const varieties = species.pokemon_v2_pokemons ?? [];
    const defaultVariety = varieties.find((variety) => variety.is_default) ?? varieties[0];
    const forms = [];
    for (const variety of varieties) {
      const varietyTypes = typesOf(variety);
      const rawForms = variety.pokemon_v2_pokemonforms ?? [];
      const entries = rawForms.length > 0 ? rawForms : [null];
      for (const form of entries) {
        const speciesDefault = Boolean(variety.is_default && (form?.is_default ?? true));
        const primary = form?.is_default ?? true;
        const kind = formKind(form?.form_name ?? "", Boolean(form?.is_mega), speciesDefault);
        const file = primary ? `p${variety.id}.webp` : `f${form.id}.webp`;
        forms.push({
          name: form ? formDisplayName(name, form) : name,
          art: file,
          types: varietyTypes,
          kind,
          pixel: !primary,
          _job: {
            file,
            primary,
            pokemonId: variety.id,
            urls: artworkUrls({
              pokemonId: variety.id,
              formName: form?.form_name || "",
              hiresFirst: primary,
            }),
          },
        });
        jobs.push(forms[forms.length - 1]._job);
      }
    }
    sortForms(forms);
    drafted.push({
      id,
      name,
      generation: species.generation_id,
      types: typesOf(defaultVariety),
      color: species.pokemon_v2_pokemoncolor?.name ?? null,
      shape: species.pokemon_v2_pokemonshape?.name ?? null,
      habitat: species.pokemon_v2_pokemonhabitat?.name ?? null,
      eggGroups: (species.pokemon_v2_pokemonegggroups ?? [])
        .map((row) => row.pokemon_v2_egggroup.name)
        .sort(),
      legendary: Boolean(species.is_legendary),
      mythical: Boolean(species.is_mythical),
      baby: Boolean(species.is_baby),
      stage: stageOf(id, parentOf),
      evolves: children.has(id),
      evolvesFrom: parentOf.get(id) ?? null,
      starter: starterLine(id, parentOf),
      forms,
    });
  }

  drafted.sort((a, b) => a.id - b.id);
  for (const form of applyZaMegas(drafted, { jobs: true })) jobs.push(form._job);
  const uniqueJobs = [];
  const seenFiles = new Set();
  for (const job of jobs) {
    if (seenFiles.has(job.file)) continue;
    seenFiles.add(job.file);
    uniqueJobs.push(job);
  }

  console.log(`Downloading ${uniqueJobs.length} form portraits for ${drafted.length} species...`);
  let finished = 0;
  let failed = 0;
  const saved = new Map();
  await mapPool(uniqueJobs, 10, async (job) => {
    const dest = path.join(ART_DIR, job.file);
    const result = await downloadArtwork(job.urls, dest);
    finished += 1;
    if (!result.cached && !result.url) {
      failed += 1;
      saved.set(job.file, null);
    } else if (result.url && job.pokemonId != null && !job.primary && isBaseSpeciesSprite(result.url, job.pokemonId)) {
      // No portrait of its own. Keep the base species sprite on the default form only.
      saved.set(job.file, { drop: true });
      try {
        await unlink(dest);
      } catch {
        // The form is still omitted when the file is already gone.
      }
    } else if (result.url) {
      saved.set(job.file, { pixel: job.pixel ?? isPixelSource(result.url) });
    } else {
      saved.set(job.file, { pixel: job.pixel ?? !job.primary, cached: true });
    }
    if (finished % 50 === 0 || finished === uniqueJobs.length) {
      process.stdout.write(`\rArtwork ${finished}/${uniqueJobs.length} (${failed} missing)`);
    }
  });
  process.stdout.write("\n");

  const pokemon = drafted.map((species) => {
    // Totems and other look-alike forms are merged away (see redundant-forms.mjs).
    const forms = pruneForms(species.forms).flatMap((form) => {
      const meta = saved.get(form._job.file);
      if (meta?.drop) return [];
      const art = meta ? form.art : null;
      const pixel = meta ? Boolean(meta.pixel) : false;
      return [{ name: form.name, art, types: form.types, kind: form.kind, pixel }];
    });
    const lead = forms.find((form) => form.kind === "default" && form.art) ?? forms.find((form) => form.art);
    return {
      id: species.id,
      name: species.name,
      generation: species.generation,
      types: species.types,
      color: species.color,
      shape: species.shape,
      habitat: species.habitat,
      eggGroups: species.eggGroups,
      legendary: species.legendary,
      mythical: species.mythical,
      baby: species.baby,
      stage: species.stage,
      evolves: species.evolves,
      evolvesFrom: species.evolvesFrom,
      starter: species.starter,
      art: lead?.art ?? null,
      forms,
    };
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    source: "https://pokeapi.co",
    count: pokemon.length,
    pokemon,
  };
  const packed = JSON.stringify(payload);
  await writeFile(DATA_PATH, packed);
  await writeFile(POKEDEX_JS_PATH, `var POKEDEX_BUNDLE = ${packed};\n`);
  await writeFile(
    MANIFEST_PATH,
    JSON.stringify({ species: pokemon.length, files: uniqueJobs.length - failed, failed }, null, 2),
  );
  console.log(`Wrote ${pokemon.length} species to ${path.relative(ROOT, DATA_PATH)}`);
  if (failed > 0) console.log(`${failed} portraits could not be downloaded; those forms render a monogram.`);
}

await main();
