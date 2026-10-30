/* Small base64 thumbnails of every portrait, as classic scripts in data/thumbs/.
 * Grid PNG export draws these when the page runs from file://, where drawing the
 * artwork files themselves would taint the canvas. Chunk = thumbChunk(name) below,
 * the same hash js/grids.js uses. Run: node scripts/build-thumbs.cjs (needs sharp). */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const CHUNKS = 16;
function thumbChunk(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % CHUNKS;
}

(async () => {
  const artDir = path.join(__dirname, "..", "artwork");
  const outDir = path.join(__dirname, "..", "data", "thumbs");
  fs.mkdirSync(outDir, { recursive: true });
  const chunks = Array.from({ length: CHUNKS }, () => ({}));
  const files = fs.readdirSync(artDir).filter((f) => f.endsWith(".webp")).sort();
  for (const file of files) {
    const buf = await sharp(path.join(artDir, file))
      .resize(96, 96, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 65 })
      .toBuffer();
    chunks[thumbChunk(file)][file] = "data:image/webp;base64," + buf.toString("base64");
  }
  chunks.forEach((map, i) => {
    const name = "t" + String(i).padStart(2, "0") + ".js";
    fs.writeFileSync(path.join(outDir, name),
      "(globalThis.POKERANKER_THUMBS = globalThis.POKERANKER_THUMBS || {}, Object.assign(globalThis.POKERANKER_THUMBS, " +
      JSON.stringify(map) + "));\n");
  });
  console.log("wrote", files.length, "thumbnails in", CHUNKS, "files");
})();
