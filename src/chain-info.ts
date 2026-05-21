import type { ChainInfoResult } from "@ethereum-sourcify/clear-signing";

/**
 * Lazy loader for the `chainid.network/chains_mini.json` dataset.
 *
 * The list isn't bundled — we fetch it on the first `lookupChainInfo` call
 * and cache an indexed-and-filtered view for the rest of the process. This
 * keeps the dist self-contained but still avoids per-case network hits.
 *
 * `resolveChainInfo` may be invoked with any chainId referenced by a
 * descriptor (bridge / cross-chain descriptors include foreign chains), so
 * we resolve from the global registry rather than restricting to a single
 * connected chain.
 */

const SOURCE_URL = "https://chainid.network/chains_mini.json";

interface RawChainEntry {
  chainId: number;
  name?: string;
  nativeCurrency?: { name: string; symbol: string; decimals: number };
}

type ChainInfoMap = Record<string, ChainInfoResult>;

let cache: ChainInfoMap | null = null;
let inflight: Promise<ChainInfoMap> | null = null;

/** Look up chain info by chainId. Returns null when not known. */
export async function lookupChainInfo(
  chainId: number,
): Promise<ChainInfoResult | null> {
  const map = await loadChainInfoMap();
  return map[String(chainId)] ?? null;
}

async function loadChainInfoMap(): Promise<ChainInfoMap> {
  if (cache) return cache;
  if (inflight) return inflight;

  inflight = fetchWithRetry(SOURCE_URL).then((raw) => {
    const map: ChainInfoMap = {};
    for (const entry of raw) {
      if (!entry.name || !entry.nativeCurrency) continue;
      map[String(entry.chainId)] = {
        name: entry.name,
        nativeCurrency: entry.nativeCurrency,
      };
    }
    cache = map;
    inflight = null;
    return map;
  });

  try {
    return await inflight;
  } catch (err) {
    inflight = null;
    throw err;
  }
}

const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 250;

async function fetchWithRetry(url: string): Promise<RawChainEntry[]> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as RawChainEntry[];
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_ATTEMPTS) break;
      const delay = BASE_DELAY_MS * Math.pow(3, attempt - 1);
      await sleep(delay);
    }
  }
  throw new Error(
    `failed to fetch chain info from ${url} after ${MAX_ATTEMPTS} attempts: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
