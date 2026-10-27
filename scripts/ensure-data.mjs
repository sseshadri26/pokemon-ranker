import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

const data = path.join(process.cwd(), "src", "data", "pokemon.json");
const manifest = path.join(process.cwd(), "public", "artwork", "_manifest.json");

if (existsSync(data) && existsSync(manifest)) {
  process.exit(0);
}

console.log("National Dex bundle is missing. Fetching it from PokéAPI (first run only)...");
const child = spawn(process.execPath, [path.join(process.cwd(), "scripts", "fetch-pokemon.mjs")], {
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 1));
