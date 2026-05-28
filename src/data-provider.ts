import type {
  AddressNameResult,
  BlockTimestampResult,
  ChainInfoResult,
  ExternalDataProvider,
  NftCollectionNameResult,
  TokenResult,
} from "@ethereum-sourcify/clear-signing";

import { lookupChainInfo } from "./chain-info.js";
import type { DataProviderInput } from "./types.js";

/**
 * Build an ExternalDataProvider from the test file's static dataProvider
 * block (tokens, addressNames, ensNames, nftCollectionNames,
 * blockTimestamps).
 *
 * Address lookups are case-insensitive; anything not present in the mock
 * returns null, which lets the library fall back to raw rendering for that
 * field. Chain info is resolved on the fly against
 * `chainid.network/chains_mini.json` because descriptors may reference
 * cross-chain identifiers that the fixture author can't reasonably enumerate.
 */
export function buildExternalDataProvider(
  input: DataProviderInput | undefined,
): ExternalDataProvider {
  const tokens = lowercaseKeys(input?.tokens ?? {});
  const localNames = lowercaseKeys(input?.addressNames ?? {});
  const ensNames = lowercaseKeys(input?.ensNames ?? {});
  const nftCollectionNames = lowercaseKeys(input?.nftCollectionNames ?? {});
  const blockTimestamps = input?.blockTimestamps ?? {};

  return {
    resolveToken: async (
      _chainId: number,
      tokenAddress: string,
    ): Promise<TokenResult | null> => {
      const meta = tokens[tokenAddress.toLowerCase()];
      if (!meta) return null;
      return { name: meta.name, symbol: meta.symbol, decimals: meta.decimals };
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

    resolveNftCollectionName: async (
      _chainId: number,
      collectionAddress: string,
    ): Promise<NftCollectionNameResult | null> => {
      const name = nftCollectionNames[collectionAddress.toLowerCase()];
      if (!name) return null;
      return { name };
    },

    resolveBlockTimestamp: async (
      _chainId: number,
      blockHeight: bigint,
    ): Promise<BlockTimestampResult | null> => {
      const ts = blockTimestamps[blockHeight.toString()];
      if (ts == null) return null;
      return { timestamp: ts };
    },

    resolveChainInfo: async (
      chainId: number,
    ): Promise<ChainInfoResult | null> => lookupChainInfo(chainId),
  };
}

function lowercaseKeys<V>(input: Record<string, V>): Record<string, V> {
  const out: Record<string, V> = {};
  for (const [k, v] of Object.entries(input)) {
    out[k.toLowerCase()] = v;
  }
  return out;
}
