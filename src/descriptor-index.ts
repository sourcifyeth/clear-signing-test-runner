import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { keccak_256 } from "@noble/hashes/sha3.js";

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
  /** Filesystem directory containing the descriptor module(s). */
  descriptorDirectory: string;
  /** Index keying CAIP-10 ids to the file under `descriptorDirectory`. */
  index: RegistryIndex;
}

/**
 * Stage the descriptor JSON at `descriptorPath` into a temp directory as a
 * `.mjs` module (so the library's `await import()` works without JSON import
 * attributes), and build a RegistryIndex from the descriptor.
 *
 * Mirrors the library's internal `indexDescriptor`:
 *   - calldata descriptors (`context.contract.deployments`) populate
 *     `calldataIndex`;
 *   - EIP-712 descriptors (`context.eip712.deployments` + `display.formats`)
 *     populate `typedDataIndex` keyed by CAIP-10 → primary type name →
 *     `{path, encodeTypeHashes[]}`. Hashes are `keccak256` over the raw
 *     `display.formats` key (the encodeType string) verbatim, hex-encoded
 *     with a `0x` prefix.
 *
 * A descriptor is one or the other; if both contexts are present, calldata
 * wins (matches library behavior).
 */
export async function buildIndexFromDescriptorFile(
  descriptorPath: string,
): Promise<EmbeddedDescriptorBundle> {
  const raw = await readFile(descriptorPath, "utf8");
  const descriptor = JSON.parse(raw) as DescriptorShape;

  const dir = await mkdtemp(join(tmpdir(), "clear-signing-runner-"));
  const file = "descriptor.mjs";
  await writeFile(join(dir, file), `export default ${raw};\n`, "utf8");

  const index: RegistryIndex = { calldataIndex: {}, typedDataIndex: {} };

  const calldataDeployments = descriptor.context?.contract?.deployments;
  if (calldataDeployments?.length) {
    for (const d of calldataDeployments) {
      if (d.chainId == null || !d.address) continue;
      const key = `eip155:${d.chainId}:${d.address.toLowerCase()}`;
      index.calldataIndex[key] ??= file;
    }
    return { descriptorDirectory: dir, index };
  }

  const eip712Deployments = descriptor.context?.eip712?.deployments;
  const formats = descriptor.display?.formats;
  if (!eip712Deployments?.length || !formats) {
    return { descriptorDirectory: dir, index };
  }

  const hashesByPrimaryType = new Map<string, string[]>();
  for (const encodeTypeStr of Object.keys(formats)) {
    const primaryType = extractPrimaryType(encodeTypeStr);
    if (!primaryType) continue;
    const hash = keccak256Hex(encodeTypeStr);
    const list = hashesByPrimaryType.get(primaryType) ?? [];
    list.push(hash);
    hashesByPrimaryType.set(primaryType, list);
  }
  if (hashesByPrimaryType.size === 0) {
    return { descriptorDirectory: dir, index };
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

  return { descriptorDirectory: dir, index };
}

function extractPrimaryType(encodeTypeStr: string): string | undefined {
  return encodeTypeStr.match(/^(\w+)\(/)?.[1];
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
