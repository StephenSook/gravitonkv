#!/usr/bin/env node
// Copy the repo's canonical results into the package's bundled data/ dir so
// the published npx server ships its data. Run before publish and in the
// remote app build.
import { readdirSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const resultsDir = resolve(here, "../../results");
const outDir = resolve(here, "../data");
mkdirSync(outDir, { recursive: true });
let n = 0;
if (existsSync(resultsDir)) {
  for (const f of readdirSync(resultsDir)) {
    if (f.endsWith(".json") && f !== "index.json") {
      copyFileSync(join(resultsDir, f), join(outDir, f));
      n++;
    }
  }
}
console.log(`sync-data: bundled ${n} canonical result file(s)`);
