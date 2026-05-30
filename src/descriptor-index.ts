import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { keccak_256 } from "@noble/hashes/sha3.js";

import { eip712, mergeDescriptors } from "@ethereum-sourcify/clear-signing";
import type {
  Descriptor,
  DescriptorDeployment,
  RegistryIndex,
} from "@ethereum-sourcify/clear-signing";

interface EmbeddedDescriptorBundle {
  /** Filesystem directory containing the descriptor and its `includes` siblings. */
  descriptorDirectory: string;
  /** Index keying CAIP-10 ids to the descriptor's basename under `descriptorDirectory`. */
  index: RegistryIndex;
}

/**
 * Build a RegistryIndex from a descriptor JSON file on disk, pointing the
 * library straight at the registry directory. No staging — the library
 * loads the descriptor via dynamic `import(path, { with: { type: "json" } })`
 * (since @ethereum-sourcify/clear-signing >= 0.1.5), and resolves any
 * `includes` siblings in the same directory natively.
 *
 * For deployments and formats we merge the root with its include chain via
 * the library's `mergeDescriptors`, walking the chain recursively (matches
 * the library's runtime `resolveWithIncludes` since 0.1.7). That gives us
 * the exact same view the library uses at lookup time, including the
 * array-replace behavior of the merge (root's deployments override
 * include's). Without merging we'd miss deployments declared only in an
 * include (the UniswapX / Permit2 pattern), where the root file is just
 * `{ includes, display.formats }` and the deployments live in the common.
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
  const descriptorDirectory = dirname(absolute);
  const file = basename(absolute);

  const descriptor = await loadMergedDescriptor(absolute);

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
 * the library's `resolveWithIncludes` (since 0.1.7), including cycle
 * detection — a repeated path throws so we don't loop forever.
 */
async function loadMergedDescriptor(
  rootPath: string,
  visited: Set<string> = new Set(),
): Promise<Descriptor> {
  const absolute = resolve(rootPath);
  if (visited.has(absolute)) {
    throw new Error(
      `cyclic \`includes\` chain detected at descriptor: ${absolute}`,
    );
  }
  visited.add(absolute);

  const descriptor = JSON.parse(await readFile(absolute, "utf8")) as Descriptor;
  if (typeof descriptor.includes !== "string") return descriptor;

  const includePath = resolve(dirname(absolute), descriptor.includes);
  const included = await loadMergedDescriptor(includePath, visited);
  return mergeDescriptors(descriptor, included);
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
