/* Measure the opaque box of each portrait. The page uses this to overlap
 * transparent padding with the other form's artwork. Not part of opening index.html. */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const artDir = path.join(__dirname, "..", "artwork");
const outPath = path.join(__dirname, "..", "data", "ink.js");

async function bounds(file) {
  const size = 48;
  const { data, info } = await sharp(file)
    .resize(size, size, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const alpha = data[(y * w + x) * 4 + 3];
      if (alpha < 16) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return [0, 0, 1000, 1000];
  return [
    Math.round((minX / w) * 1000),
    Math.round((minY / h) * 1000),
    Math.round(((maxX + 1) / w) * 1000),
    Math.round(((maxY + 1) / h) * 1000),
  ];
}

async function main() {
  const files = fs.readdirSync(artDir).filter((name) => name.endsWith(".webp")).sort();
  const ink = {};
  for (let i = 0; i < files.length; i++) {
    ink[files[i]] = await bounds(path.join(artDir, files[i]));
    if ((i + 1) % 200 === 0 || i + 1 === files.length) {
      process.stdout.write(`\rInk ${i + 1}/${files.length}`);
    }
  }
  process.stdout.write("\n");
  const body = "var FORM_INK=" + JSON.stringify(ink) + ";\n";
  fs.writeFileSync(outPath, body);
  console.log("wrote", outPath, "bytes", body.length);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
