/**
 * Replace the 96px game sprites used for cosmetic forms (Unown letters, Vivillon
 * patterns, Alcremie, Squawkabilly, ...) with the form's official artwork, or its
 * HOME render when there is no official artwork. Forms keep their f{formId}.webp
 * file name; the file is overwritten and the form's `pixel` flag is cleared.
 *
 *   node scripts/upgrade-form-art.mjs
 *
 * Needs `sharp` (npm install sharp). Rewrites data/pokemon.json and data/pokedex.js.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_PATH = path.join(ROOT, "data", "pokemon.json");
const POKEDEX_JS_PATH = path.join(ROOT, "data", "pokedex.js");
const ART_DIR = path.join(ROOT, "artwork");

async function json(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function hiresFor(formId) {
  const form = await json(`https://pokeapi.co/api/v2/pokemon-form/${formId}/`);
  const other = form.sprites?.other ?? {};
  return [other["official-artwork"]?.front_default, other.home?.front_default].filter(Boolean);
}

async function save(urls, dest) {
  for (const url of urls) {
    const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
    if (!res.ok) continue;
    const bytes = Buffer.from(await res.arrayBuffer());
    // sharp applies one resize per pipeline, so trim and scale first, then pad to 360.
    const fitted = await sharp(bytes).trim({ threshold: 1 }).resize({ width: 330, height: 330, fit: "inside" }).toBuffer();
    await sharp(fitted)
      .resize({ width: 360, height: 360, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 72 })
      .toFile(dest);
    return url;
  }
  return null;
}

const payload = JSON.parse(await readFile(DATA_PATH, "utf8"));
const targets = [];
for (const mon of payload.pokemon) {
  for (const form of mon.forms ?? []) {
    const match = /^f(\d+)\.webp$/.exec(form.art ?? "");
    if (form.pixel && match) targets.push({ mon, form, formId: Number(match[1]) });
  }
}
console.log(`Upgrading ${targets.length} pixel form portraits...`);
const failed = [];
let cursor = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (cursor < targets.length) {
    const job = targets[cursor++];
    try {
      const url = await save(await hiresFor(job.formId), path.join(ART_DIR, job.form.art));
      if (url) job.form.pixel = false;
      else failed.push(job);
    } catch (error) {
      failed.push(job);
    }
  }
}));
const packed = JSON.stringify(payload);
await writeFile(DATA_PATH, packed);
await writeFile(POKEDEX_JS_PATH, `var POKEDEX_BUNDLE = ${packed};\n`);
console.log(`Done. ${targets.length - failed.length} upgraded, ${failed.length} kept as sprites.`);
for (const job of failed) console.log(`  kept: ${job.form.name} ${job.form.art}`);
