#!/usr/bin/env node
/**
 * Patch @ethereum-sourcify/clear-signing@0.1.1's dist/ to add `.js`
 * extensions on relative imports/exports.
 *
 * The published package is ESM (`"type": "module"`) but its compiled output
 * uses extensionless relative specifiers like `from "./resolver"`. Node ESM
 * rejects those with ERR_MODULE_NOT_FOUND, and TypeScript NodeNext
 * resolution can't follow the type re-exports either. We rewrite the
 * relevant files in place. The script is idempotent.
 *
 * Remove this once an upstream release ships the fix.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(
  here,
  "..",
  "node_modules",
  "@ethereum-sourcify",
  "clear-signing",
  "dist",
);

const SPEC_RE =
  /((?:^|[\s;])(?:import|export)[^'"`]*?from\s*)(['"])(\.{1,2}\/[^'"`]+?)\2/g;

function rewriteSpecifier(spec) {
  if (/\.[mc]?js$/.test(spec)) return spec;
  if (/\.d\.ts$/.test(spec)) return spec;
  if (spec.endsWith("/")) return spec;
  return spec + ".js";
}

async function patchFile(path) {
  const src = await readFile(path, "utf8");
  const out = src.replace(SPEC_RE, (_m, prefix, quote, spec) => {
    return `${prefix}${quote}${rewriteSpecifier(spec)}${quote}`;
  });
  if (out !== src) {
    await writeFile(path, out, "utf8");
    return true;
  }
  return false;
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walk(p)));
    } else if (/\.(js|d\.ts)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

async function main() {
  let touched = 0;
  let scanned = 0;
  try {
    const files = await walk(distDir);
    for (const f of files) {
      scanned++;
      if (await patchFile(f)) touched++;
    }
  } catch (err) {
    if (err && err.code === "ENOENT") {
      // Library not installed yet — nothing to do.
      return;
    }
    throw err;
  }
  if (touched > 0) {
    console.log(
      `patched @ethereum-sourcify/clear-signing: rewrote ${touched}/${scanned} dist files`,
    );
  }
}

await main();
