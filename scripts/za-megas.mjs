/**
 * Mega Evolutions introduced in Pokémon Legends: Z-A.
 * PokéAPI's is_mega list still stops at the 48 classic Megas, so these are
 * attached as form entries on the existing National Dex species.
 *
 * Artwork is Serebii's official-style art. Filenames stay za*.webp so they
 * do not collide with p*.webp / f*.webp portraits.
 */
import { existsSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ART_BASE = "https://www.serebii.net/pokemon/art/";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function mega(dex, name, types, file, suffixes = ["m"]) {
  return { dex, name, types, file, suffixes };
}

/** Base game, then Mega Dimension DLC. 48 forms, not new ranked species. */
export const ZA_MEGAS = [
  mega(154, "Mega Meganium", ["grass", "fairy"], "za154.webp"),
  mega(500, "Mega Emboar", ["fire", "fighting"], "za500.webp"),
  mega(160, "Mega Feraligatr", ["water", "dragon"], "za160.webp"),
  mega(689, "Mega Barbaracle", ["rock", "fighting"], "za689.webp"),
  mega(121, "Mega Starmie", ["water", "psychic"], "za121.webp"),
  mega(670, "Mega Floette", ["fairy"], "za670.webp"),
  mega(668, "Mega Pyroar", ["fire", "normal"], "za668.webp"),
  mega(36, "Mega Clefable", ["fairy", "flying"], "za36.webp"),
  mega(545, "Mega Scolipede", ["bug", "poison"], "za545.webp"),
  mega(71, "Mega Victreebel", ["grass", "poison"], "za71.webp"),
  mega(530, "Mega Excadrill", ["ground", "steel"], "za530.webp"),
  mega(604, "Mega Eelektross", ["electric"], "za604.webp"),
  mega(149, "Mega Dragonite", ["dragon", "flying"], "za149.webp"),
  mega(687, "Mega Malamar", ["dark", "psychic"], "za687.webp"),
  mega(691, "Mega Dragalge", ["poison", "dragon"], "za691.webp"),
  mega(478, "Mega Froslass", ["ice", "ghost"], "za478.webp"),
  mega(701, "Mega Hawlucha", ["fighting", "flying"], "za701.webp"),
  mega(560, "Mega Scrafty", ["dark", "fighting"], "za560.webp"),
  mega(609, "Mega Chandelure", ["ghost", "fire"], "za609.webp"),
  mega(658, "Mega Greninja", ["water", "dark"], "za658.webp"),
  mega(870, "Mega Falinks", ["fighting"], "za870.webp"),
  mega(652, "Mega Chesnaught", ["grass", "fighting"], "za652.webp"),
  mega(227, "Mega Skarmory", ["steel", "flying"], "za227.webp"),
  mega(655, "Mega Delphox", ["fire", "psychic"], "za655.webp"),
  mega(780, "Mega Drampa", ["normal", "dragon"], "za780.webp"),
  mega(718, "Mega Zygarde", ["dragon", "ground"], "za718.webp"),
  mega(678, "Mega Meowstic", ["psychic"], "za678.webp"),
  mega(26, "Mega Raichu X", ["electric"], "za26-x.webp", ["mx"]),
  mega(26, "Mega Raichu Y", ["electric"], "za26-y.webp", ["my"]),
  mega(445, "Mega Garchomp Z", ["dragon"], "za445-z.webp", ["mz"]),
  mega(359, "Mega Absol Z", ["dark", "ghost"], "za359-z.webp", ["mz"]),
  mega(448, "Mega Lucario Z", ["fighting", "steel"], "za448-z.webp", ["mz"]),
  mega(952, "Mega Scovillain", ["grass", "fire"], "za952.webp"),
  mega(970, "Mega Glimmora", ["rock", "poison"], "za970.webp"),
  mega(978, "Mega Tatsugiri Curly Form", ["dragon", "water"], "za978-curly.webp", ["m"]),
  mega(978, "Mega Tatsugiri Droopy Form", ["dragon", "water"], "za978-droopy.webp", ["md"]),
  mega(978, "Mega Tatsugiri Stretchy Form", ["dragon", "water"], "za978-stretchy.webp", ["ms"]),
  mega(998, "Mega Baxcalibur", ["dragon", "ice"], "za998.webp"),
  mega(358, "Mega Chimecho", ["psychic", "steel"], "za358.webp"),
  mega(768, "Mega Golisopod", ["bug", "steel"], "za768.webp"),
  mega(623, "Mega Golurk", ["ground", "ghost"], "za623.webp"),
  mega(398, "Mega Staraptor", ["fighting", "flying"], "za398.webp"),
  mega(740, "Mega Crabominable", ["fighting", "ice"], "za740.webp"),
  mega(485, "Mega Heatran", ["fire", "steel"], "za485.webp"),
  mega(491, "Mega Darkrai", ["dark"], "za491.webp"),
  mega(801, "Mega Magearna", ["steel", "fairy"], "za801.webp"),
  mega(801, "Mega Magearna Original Color", ["steel", "fairy"], "za801-original.webp", ["mo"]),
  mega(807, "Mega Zeraora", ["electric"], "za807.webp"),
];

const KIND_ORDER = { default: 0, mega: 1, gmax: 2, regional: 3, other: 4 };

const seenFiles = new Set();
const seenNames = new Set();
for (const entry of ZA_MEGAS) {
  if (seenFiles.has(entry.file)) throw new Error(`Duplicate Z-A art file ${entry.file}`);
  if (!/^za[a-z0-9.-]+\.webp$/.test(entry.file)) throw new Error(`Unexpected Z-A art file ${entry.file}`);
  seenFiles.add(entry.file);
  if (seenNames.has(entry.name)) throw new Error(`Duplicate Z-A mega name ${entry.name}`);
  seenNames.add(entry.name);
}
if (ZA_MEGAS.length !== 48) throw new Error(`Expected 48 Z-A megas, found ${ZA_MEGAS.length}`);

export function sortForms(forms) {
  forms.sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || a.name.localeCompare(b.name));
  return forms;
}

/** Zero-padded (Serebii's usual 3-digit path), then unpadded, then 4-digit. */
export function artUrls(entry) {
  const id = String(entry.dex);
  const stems = [id.padStart(3, "0"), id, id.padStart(4, "0")];
  const urls = [];
  const seen = new Set();
  for (const suffix of entry.suffixes) {
    for (const stem of stems) {
      const url = `${ART_BASE}${stem}-${suffix}.png`;
      if (seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
}

function isImage(bytes, contentType) {
  if (bytes.length < 80) return false;
  if (bytes[0] === 0x3c) return false;
  if ((contentType || "").startsWith("image/")) return true;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
  return false;
}

/**
 * Save one portrait. An existing non-empty file is left untouched.
 * Returns { ok, url, cached }.
 */
export async function downloadPortrait(urls, dest) {
  if (existsSync(dest) && statSync(dest).size > 0) return { ok: true, url: null, cached: true };
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "image/png,image/*,*/*",
          Referer: "https://www.serebii.net/",
        },
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) continue;
      const bytes = Buffer.from(await res.arrayBuffer());
      if (!isImage(bytes, res.headers.get("content-type") || "")) continue;
      await sharp(bytes)
        .resize({ width: 360, height: 360, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 72 })
        .toFile(dest);
      return { ok: true, url, cached: false };
    } catch {
      try {
        if (existsSync(dest)) unlinkSync(dest);
      } catch {
        // The next filename can still be tried.
      }
    }
  }
  return { ok: false, url: null, cached: false };
}

/**
 * Add missing Z-A mega forms onto species that are already in the dex.
 * Does not remove or rewrite any form that is already there.
 * With `{ jobs: true }`, each new form carries a `_job` the artwork downloader understands.
 * Returns the new form objects (empty when every mega was already present).
 */
export function applyZaMegas(speciesList, options = {}) {
  const jobs = Boolean(options.jobs);
  const byId = new Map(speciesList.map((species) => [species.id, species]));
  const added = [];
  for (const entry of ZA_MEGAS) {
    const species = byId.get(entry.dex);
    if (!species) {
      console.warn(`No National Dex species #${entry.dex} for ${entry.name}`);
      continue;
    }
    if (species.forms.some((form) => form.name === entry.name)) continue;
    const form = {
      name: entry.name,
      art: entry.file,
      types: entry.types.slice(),
      kind: "mega",
      pixel: false,
    };
    if (jobs) {
      form._job = {
        file: entry.file,
        primary: false,
        pixel: false,
        urls: artUrls(entry),
      };
    }
    species.forms.push(form);
    sortForms(species.forms);
    added.push(form);
  }
  return added;
}
