#!/usr/bin/env node
// Validate GravitonKV result files against the canonical schema, then verify
// that every stored aggregate (median, mean, stdev, cv) matches a recompute
// from the raw rep values. Exits non-zero on any failure so CI can gate on it.
//
// Usage: node scripts/validate-results.mjs [files...]
// With no arguments it validates harness/schema/fixtures/*.json plus any
// results/*.json canonical files (results/pilot/ is raw pilot output in a
// pre-schema format and is skipped).

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = join(root, "harness/schema/gravitonkv-results.schema.json");
const EPS = 1e-6;

function collectDefaultTargets() {
  const targets = [];
  const fixtures = join(root, "harness/schema/fixtures");
  if (existsSync(fixtures)) {
    for (const f of readdirSync(fixtures)) {
      if (f.endsWith(".json")) targets.push(join(fixtures, f));
    }
  }
  const results = join(root, "results");
  if (existsSync(results)) {
    for (const f of readdirSync(results)) {
      if (f.endsWith(".json") && f !== "index.json") targets.push(join(results, f));
    }
  }
  return targets;
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function stdev(xs) {
  const mu = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - mu) ** 2, 0) / (xs.length - 1));
}

function checkAggregates(doc, file) {
  const errors = [];
  for (const [ci, cell] of (doc.cells ?? []).entries()) {
    for (const [name, metric] of Object.entries(cell.metrics ?? {})) {
      const { raw } = metric;
      const expected = {
        median: median(raw),
        mean: mean(raw),
        stdev: stdev(raw),
        cv: stdev(raw) / mean(raw),
      };
      for (const key of ["median", "mean", "stdev", "cv"]) {
        const got = metric[key];
        const want = expected[key];
        const tol = Math.max(EPS, Math.abs(want) * 1e-4);
        if (Math.abs(got - want) > tol) {
          errors.push(
            `${file} cells[${ci}].metrics.${name}.${key}: stored ${got}, recomputed ${want}`
          );
        }
      }
    }
  }
  return errors;
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const validate = ajv.compile(schema);

const targets = process.argv.slice(2).length
  ? process.argv.slice(2).map((p) => resolve(p))
  : collectDefaultTargets();

if (targets.length === 0) {
  console.log("validate-results: no target files found (nothing to validate yet)");
  process.exit(0);
}

let failed = false;
for (const file of targets) {
  const doc = JSON.parse(readFileSync(file, "utf8"));
  if (!validate(doc)) {
    failed = true;
    console.error(`SCHEMA FAIL ${file}`);
    for (const err of validate.errors) {
      console.error(`  ${err.instancePath || "/"} ${err.message}`);
    }
    continue;
  }
  const aggErrors = checkAggregates(doc, file);
  if (aggErrors.length) {
    failed = true;
    console.error(`AGGREGATE FAIL ${file}`);
    for (const e of aggErrors) console.error(`  ${e}`);
    continue;
  }
  const tag = doc.fixture_note ? " (fixture)" : "";
  console.log(`OK ${file}${tag}: ${doc.cells.length} cell(s)`);
}

process.exit(failed ? 1 : 0);
