import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

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
  /** Index keying CAIP-10 ids to the descriptor's path under `descriptorDirectory`. */
  index: RegistryIndex;
}

interface MergeResult {
  descriptor: Descriptor;
  /** Every absolute path the include walk touched, in visit order. */
  visited: string[];
}

/**
 * Build a RegistryIndex from a descriptor JSON file on disk. No staging —
 * the library loads files via `import(path, { with: { type: "json" } })`
 * directly from the registry checkout (since
 * `@ethereum-sourcify/clear-signing >= 0.1.5`).
 *
 * `descriptorDirectory` is set to the **common ancestor directory** of every
 * file the include chain touches, not just the leaf's parent. Why: the
 * library's `resolveWithIncludes` (through 0.1.8 at least) joins the index
 * value's path with the descriptor's `includes` segment by segment, and a
 * `..` walked off the root of that joined path is silently dropped. If the
 * index value is a bare basename, an include like `"../../ercs/foo.json"`
 * loses its traversal entirely and the lookup ends up at the wrong
 * filesystem location. By rooting `descriptorDirectory` at the common
 * ancestor of every visited file and storing the leaf as a relative path
 * beneath it, every chain step has enough path context for the library's
 * `..` math to land correctly. Sibling-only chains keep working — the
 * ancestor reduces to the leaf's dirname in that case.
 *
 * Deployments and formats are read off the merged descriptor (built via the
 * library's `mergeDescriptors`, recursively, with cycle detection). The
 * merge mirrors what the library produces at runtime, so deployments
 * declared only in an include (e.g. UniswapX / Permit2 / kiln-vault) are
 * indexed correctly.
 *
 * Mirrors the library's `indexDescriptor` selection:
 *   - if the merged descriptor has `context.contract.deployments`, treat as
 *     calldata and populate `calldataIndex`;
 *   - else if `context.eip712.deployments` + `display.formats` are both
 *     present, populate `typedDataIndex` keyed by CAIP-10 → primary type
 *     name → `{path, encodeTypeHashes[]}`. Hashes are `keccak256` over
 *     each `display.formats` key verbatim, hex-encoded with a `0x` prefix.
 */
export async function buildIndexFromDescriptorFile(
  descriptorPath: string,
): Promise<EmbeddedDescriptorBundle> {
  const absolute = resolve(descriptorPath);
  const { descriptor, visited } = await loadMergedDescriptor(absolute);

  const descriptorDirectory = commonAncestorDir(visited);
  const file = relative(descriptorDirectory, absolute);

  const index: RegistryIndex = { calldataIndex: {}, typedDataIndex: {} };

  const contractDeployments = descriptor.context?.contract?.deployments;
  if (contractDeployments?.length) {
    for (const d of contractDeployments) {
      if (d.chainId == null || !d.address) continue;
      const key = `eip155:${d.chainId}:${d.address.toLowerCase()}`;
      index.calldataIndex[key] ??= file;
    }
    return { descriptorDirectory, index };
  }

  const eip712Deployments = descriptor.context?.eip712?.deployments;
  const formats = descriptor.display?.formats;
  if (!eip712Deployments?.length || !formats) {
    return { descriptorDirectory, index };
  }

  const hashesByPrimaryType = new Map<string, string[]>();
  for (const encodeTypeStr of Object.keys(formats)) {
    const primaryType = eip712.extractPrimaryType(encodeTypeStr);
    if (!primaryType) continue;
    const hash = keccak256Hex(encodeTypeStr);
    const list = hashesByPrimaryType.get(primaryType) ?? [];
    list.push(hash);
    hashesByPrimaryType.set(primaryType, list);
  }
  if (hashesByPrimaryType.size === 0) {
    return { descriptorDirectory, index };
  }

  for (const d of eip712Deployments as DescriptorDeployment[]) {
    if (d.chainId == null || !d.address) continue;
    const caip = `eip155:${d.chainId}:${d.address.toLowerCase()}`;
    const byPrimaryType = (index.typedDataIndex[caip] ??= {});
    for (const [primaryType, encodeTypeHashes] of hashesByPrimaryType) {
      const entries = (byPrimaryType[primaryType] ??= []);
      entries.push({ path: file, encodeTypeHashes });
    }
  }

  return { descriptorDirectory, index };
}

/**
 * Load the descriptor at `rootPath` and recursively follow its `includes`
 * chain, merging each level via the library's `mergeDescriptors`. Mirrors
 * the library's `resolveWithIncludes`, including cycle detection. Also
 * returns every absolute path visited so callers can use them to pick a
 * `descriptorDirectory` that covers the whole chain.
 */
async function loadMergedDescriptor(rootPath: string): Promise<MergeResult> {
  const visited: string[] = [];
  const seen = new Set<string>();

  async function walk(filePath: string): Promise<Descriptor> {
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
    const included = await walk(includePath);
    return mergeDescriptors(descriptor, included);
  }

  const descriptor = await walk(rootPath);
  return { descriptor, visited };
}

/**
 * Longest directory prefix shared by every absolute file path. For a single
 * path, returns its dirname. Used as `descriptorDirectory` so the library
 * has enough path context to resolve `..` traversals correctly when walking
 * the include chain.
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
