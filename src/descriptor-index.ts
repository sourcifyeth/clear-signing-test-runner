import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RegistryIndex } from "@ethereum-sourcify/clear-signing";

interface Deployment {
  chainId?: number;
  address?: string;
}

interface DescriptorShape {
  context?: {
    contract?: { deployments?: Deployment[] };
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
 * attributes), and build a RegistryIndex from the descriptor's
 * `context.contract.deployments`. EIP-712 typed-data descriptors are not
 * indexed — they need encodeType hashes the library now demands, and no
 * current fixture exercises that path.
 */
export async function buildIndexFromDescriptorFile(
  descriptorPath: string,
): Promise<EmbeddedDescriptorBundle> {
  const raw = await readFile(descriptorPath, "utf8");
  const descriptor = JSON.parse(raw) as DescriptorShape;

  const dir = await mkdtemp(join(tmpdir(), "clear-signing-runner-"));
  const file = "descriptor.mjs";
  const moduleSource = `export default ${raw};\n`;
  await writeFile(join(dir, file), moduleSource, "utf8");

  const index: RegistryIndex = { calldataIndex: {}, typedDataIndex: {} };

  for (const d of descriptor.context?.contract?.deployments ?? []) {
    if (d.chainId == null || !d.address) continue;
    index.calldataIndex[`eip155:${d.chainId}:${d.address.toLowerCase()}`] =
      file;
  }

  return { descriptorDirectory: dir, index };
}
