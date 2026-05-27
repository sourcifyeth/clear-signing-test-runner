import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { keccak_256 } from "@noble/hashes/sha3.js";

import { eip712 } from "@ethereum-sourcify/clear-signing";
import type { RegistryIndex } from "@ethereum-sourcify/clear-signing";

interface Deployment {
  chainId?: number;
  address?: string;
}

interface DescriptorShape {
  context?: {
    contract?: { deployments?: Deployment[] };
    eip712?: { deployments?: Deployment[] };
  };
  display?: {
    formats?: Record<string, unknown>;
  };
}

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
 * Mirrors the library's internal `indexDescriptor`:
 *   - calldata descriptors (`context.contract.deployments`) populate
 *     `calldataIndex`;
 *   - EIP-712 descriptors (`context.eip712.deployments` + `display.formats`)
 *     populate `typedDataIndex` keyed by CAIP-10 → primary type name →
 *     `{path, encodeTypeHashes[]}`. Hashes are `keccak256` over the raw
 *     `display.formats` key verbatim, hex-encoded with a `0x` prefix.
 *
 * A descriptor is one or the other; if both contexts are present, calldata
 * wins (matches library behavior).
 */
export async function buildIndexFromDescriptorFile(
  descriptorPath: string,
): Promise<EmbeddedDescriptorBundle> {
  const absolute = resolve(descriptorPath);
  const descriptorDirectory = dirname(absolute);
  const file = basename(absolute);

  const descriptor = JSON.parse(
    await readFile(absolute, "utf8"),
  ) as DescriptorShape;

  const index: RegistryIndex = { calldataIndex: {}, typedDataIndex: {} };

  const calldataDeployments = descriptor.context?.contract?.deployments;
  if (calldataDeployments?.length) {
    for (const d of calldataDeployments) {
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

  for (const d of eip712Deployments) {
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
