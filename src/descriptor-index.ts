import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

import { keccak_256 } from "@noble/hashes/sha3.js";

import { eip712, mergeDescriptors } from "@ethereum-sourcify/clear-signing";
import type {
  Descriptor,
  DescriptorDeployment,
  RegistryIndex,
} from "@ethereum-sourcify/clear-signing";

interface EmbeddedDescriptorBundle {
  /** Filesystem directory the library treats as the embedded resolver's root. */
  descriptorDirectory: string;
  /** Index keying CAIP-10 ids to descriptor paths under `descriptorDirectory`. */
  index: RegistryIndex;
}

interface MergeResult {
  descriptor: Descriptor;
  /** Every absolute path the include walk touched, in visit order. */
  visited: string[];
}

/**
 * Build a RegistryIndex by walking the entire registry checkout that
 * contains the given descriptor.
 *
 * Why whole-registry: descriptors with `calldata`-formatted fields embed
 * inner calls into other contracts (e.g., kiln-fee-splitter-factory →
 * any of the sibling Vault descriptors). The library renders those inner
 * calls by recursively invoking `format()` with the same resolver options,
 * so every contract that *could* be embed-called needs to be indexed too.
 * Indexing only the root descriptor leaves the inner call as
 * `NO_DESCRIPTOR`. Empirically, indexing the full upstream registry (~650
 * descriptors with recursive include merge) takes ~60ms — invisible next
 * to the chain-info network fetch we already do.
 *
 * Registry root detection: walks up from the descriptor's path looking
 * for a `registry/` directory; the root is its parent. If that fails
 * (synthetic fixtures outside the registry layout), falls back to the
 * single-descriptor common-ancestor approach.
 *
 * `descriptorDirectory` is set to the registry root (or the chain's
 * common ancestor in the fallback path) so the library's include-path
 * resolution has enough leading directory segments to land `..` walks
 * correctly. See git history for the prior single-descriptor +
 * common-ancestor-only design.
 */
export async function buildIndexFromDescriptorFile(
  descriptorPath: string,
): Promise<EmbeddedDescriptorBundle> {
  const absolute = resolve(descriptorPath);
  const registryRoot = findRegistryRoot(absolute);
  if (registryRoot) {
    return buildIndexForRegistry(registryRoot, absolute);
  }
  return buildIndexForSingleDescriptor(absolute);
}

async function buildIndexForRegistry(
  registryRoot: string,
  requestedDescriptor: string,
): Promise<EmbeddedDescriptorBundle> {
  const files = await collectDescriptorFiles(registryRoot);
  if (!files.includes(requestedDescriptor)) files.push(requestedDescriptor);

  const index: RegistryIndex = { calldataIndex: {}, typedDataIndex: {} };
  for (const file of files) {
    try {
      const { descriptor } = await loadMergedDescriptor(file);
      indexOneDescriptor(descriptor, relative(registryRoot, file), index);
    } catch {
      // A bad descriptor (parse error, missing include, cycle) shouldn't
      // poison the whole index. Skip it and keep walking — the requested
      // descriptor itself will surface any real failure when format() runs.
    }
  }
  return { descriptorDirectory: registryRoot, index };
}

async function buildIndexForSingleDescriptor(
  absolute: string,
): Promise<EmbeddedDescriptorBundle> {
  const { descriptor, visited } = await loadMergedDescriptor(absolute);
  const descriptorDirectory = commonAncestorDir(visited);
  const file = relative(descriptorDirectory, absolute);
  const index: RegistryIndex = { calldataIndex: {}, typedDataIndex: {} };
  indexOneDescriptor(descriptor, file, index);
  return { descriptorDirectory, index };
}

function indexOneDescriptor(
  descriptor: Descriptor,
  file: string,
  index: RegistryIndex,
): void {
  const contractDeployments = descriptor.context?.contract?.deployments;
  if (contractDeployments?.length) {
    for (const d of contractDeployments) {
      if (d.chainId == null || !d.address) continue;
      const key = `eip155:${d.chainId}:${d.address.toLowerCase()}`;
      index.calldataIndex[key] ??= file;
    }
    return;
  }

  const eip712Deployments = descriptor.context?.eip712?.deployments;
  const formats = descriptor.display?.formats;
  if (!eip712Deployments?.length || !formats) return;

  const hashesByPrimaryType = new Map<string, string[]>();
  for (const encodeTypeStr of Object.keys(formats)) {
    const primaryType = eip712.extractPrimaryType(encodeTypeStr);
    if (!primaryType) continue;
    const hash = keccak256Hex(encodeTypeStr);
    const list = hashesByPrimaryType.get(primaryType) ?? [];
    list.push(hash);
    hashesByPrimaryType.set(primaryType, list);
  }
  if (hashesByPrimaryType.size === 0) return;

  for (const d of eip712Deployments as DescriptorDeployment[]) {
    if (d.chainId == null || !d.address) continue;
    const caip = `eip155:${d.chainId}:${d.address.toLowerCase()}`;
    const byPrimaryType = (index.typedDataIndex[caip] ??= {});
    for (const [primaryType, encodeTypeHashes] of hashesByPrimaryType) {
      const entries = (byPrimaryType[primaryType] ??= []);
      entries.push({ path: file, encodeTypeHashes });
    }
  }
}

/**
 * Walk up `startPath` looking for a directory named `registry`. The
 * registry root is its parent (so `<root>/registry/<entity>/...` and
 * `<root>/ercs/...` both sit beneath it).
 */
function findRegistryRoot(startPath: string): string | undefined {
  let current = dirname(startPath);
  while (current !== dirname(current)) {
    if (basename(current) === "registry") return dirname(current);
    current = dirname(current);
  }
  return undefined;
}

/**
 * Collect every `calldata-*.json` / `eip712-*.json` under `<root>/registry`
 * and `<root>/ercs`, excluding `tests/` and `testsv2/` subtrees and
 * `.tests.json` files. Missing subdirectories are silently skipped.
 */
async function collectDescriptorFiles(
  registryRoot: string,
): Promise<string[]> {
  const out: string[] = [];
  for (const sub of ["registry", "ercs"]) {
    await walk(join(registryRoot, sub), out);
  }
  return out;
}

async function walk(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // directory missing
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "tests" || e.name === "testsv2") continue;
      if (e.name.startsWith(".")) continue;
      await walk(p, out);
    } else if (
      e.isFile() &&
      /^(calldata|eip712)-/.test(e.name) &&
      e.name.endsWith(".json") &&
      !e.name.endsWith(".tests.json")
    ) {
      out.push(p);
    }
  }
}

/**
 * Load the descriptor at `rootPath` and recursively follow its `includes`
 * chain, merging each level via the library's `mergeDescriptors`. Mirrors
 * the library's `resolveWithIncludes`, including cycle detection. Returns
 * every absolute path visited so callers can compute a covering directory.
 */
async function loadMergedDescriptor(rootPath: string): Promise<MergeResult> {
  const visited: string[] = [];
  const seen = new Set<string>();

  async function load(filePath: string): Promise<Descriptor> {
    const absolute = resolve(filePath);
    if (seen.has(absolute)) {
      throw new Error(
        `cyclic \`includes\` chain detected at descriptor: ${absolute}`,
      );
    }
    seen.add(absolute);
    visited.push(absolute);

    const descriptor = JSON.parse(
      await readFile(absolute, "utf8"),
    ) as Descriptor;
    if (typeof descriptor.includes !== "string") return descriptor;

    const includePath = resolve(dirname(absolute), descriptor.includes);
    const included = await load(includePath);
    return mergeDescriptors(descriptor, included);
  }

  const descriptor = await load(rootPath);
  return { descriptor, visited };
}

/**
 * Longest directory prefix shared by every absolute file path. Used by the
 * single-descriptor fallback so the library has enough path context to
 * resolve `..` traversals correctly.
 */
function commonAncestorDir(absolutePaths: string[]): string {
  if (absolutePaths.length === 0) {
    throw new Error("commonAncestorDir: no paths");
  }
  if (absolutePaths.length === 1) {
    const only = absolutePaths[0];
    if (only === undefined) throw new Error("commonAncestorDir: empty path");
    return dirname(only);
  }
  const segmentLists = absolutePaths.map((p) => p.split("/"));
  const first = segmentLists[0];
  if (!first) throw new Error("commonAncestorDir: empty path list");
  let prefixLen = first.length;
  for (let listIdx = 1; listIdx < segmentLists.length; listIdx++) {
    const other = segmentLists[listIdx];
    if (!other) continue;
    const limit = Math.min(prefixLen, other.length);
    let i = 0;
    while (i < limit && other[i] === first[i]) i++;
    prefixLen = i;
  }
  const joined = first.slice(0, prefixLen).join("/");
  return joined === "" ? "/" : joined;
}

function keccak256Hex(asciiInput: string): string {
  const bytes = new Uint8Array(asciiInput.length);
  for (let i = 0; i < asciiInput.length; i++) {
    bytes[i] = asciiInput.charCodeAt(i);
  }
  const hash = keccak_256(bytes);
  let hex = "0x";
  for (const byte of hash) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}
