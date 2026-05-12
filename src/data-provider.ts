import type {
  AddressNameResult,
  ExternalDataProvider,
  TokenResult,
} from "@ethereum-sourcify/clear-signing";

import type { DataProviderInput } from "./types.js";

/**
 * Build an ExternalDataProvider from the test file's static dataProvider block.
 * Lookups are case-insensitive on addresses. The provider never hits the
 * network — anything not present in the mock returns null, which lets the
 * library fall back to raw rendering.
 */
export function buildExternalDataProvider(
  input: DataProviderInput | undefined,
): ExternalDataProvider {
  const tokens: Record<
    string,
    { symbol?: string; decimals?: number; name?: string }
  > = {};
  for (const [addr, meta] of Object.entries(input?.tokens ?? {})) {
    tokens[addr.toLowerCase()] = meta;
  }

  const localNames: Record<string, string> = {};
  const ensNames: Record<string, string> = {};
  for (const [addr, name] of Object.entries(input?.addressNames ?? {})) {
    if (name.toLowerCase().endsWith(".eth")) {
      ensNames[addr.toLowerCase()] = name;
    } else {
      localNames[addr.toLowerCase()] = name;
    }
  }

  return {
    resolveToken: async (
      _chainId: number,
      tokenAddress: string,
    ): Promise<TokenResult | null> => {
      const meta = tokens[tokenAddress.toLowerCase()];
      if (!meta) return null;
      return {
        name: meta.name ?? meta.symbol ?? "Unknown",
        symbol: meta.symbol ?? "",
        decimals: meta.decimals ?? 0,
      };
    },
    resolveLocalName: async (
      address: string,
    ): Promise<AddressNameResult | null> => {
      const name = localNames[address.toLowerCase()];
      if (!name) return null;
      return { name, typeMatch: true };
    },
    resolveEnsName: async (
      address: string,
    ): Promise<AddressNameResult | null> => {
      const name = ensNames[address.toLowerCase()];
      if (!name) return null;
      return { name, typeMatch: true };
    },
  };
}
