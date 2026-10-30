/** Drop redundant forms from data/pokemon.json + data/pokedex.js and delete artwork nothing uses. */
import { readFile, writeFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pruneForms } from "./redundant-forms.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const payload = JSON.parse(await readFile(path.join(ROOT, "data", "pokemon.json"), "utf8"));
for (const mon of payload.pokemon) {
  const before = mon.forms.length;
  mon.forms = pruneForms(mon.forms);
  if (mon.forms.length !== before) console.log(`${mon.name}: ${before} -> ${mon.forms.length}`);
}
const used = new Set();
for (const mon of payload.pokemon) {
  if (mon.art) used.add(mon.art);
  for (const form of mon.forms) if (form.art) used.add(form.art);
}
for (const file of await readdir(path.join(ROOT, "artwork"))) {
  if (file.endsWith(".webp") && !used.has(file)) {
    await unlink(path.join(ROOT, "artwork", file));
    console.log(`deleted artwork/${file}`);
  }
}
const packed = JSON.stringify(payload);
await writeFile(path.join(ROOT, "data", "pokemon.json"), packed);
await writeFile(path.join(ROOT, "data", "pokedex.js"), `var POKEDEX_BUNDLE = ${packed};\n`);
