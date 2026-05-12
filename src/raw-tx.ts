import { parseTransaction, type Hex } from "viem";

export interface DecodedTransaction {
  chainId: number;
  to: string;
  data: string;
  value: bigint;
}

/**
 * Decode a raw signed transaction hex into the fields the clear-signing
 * library needs. Supports EIP-1559, EIP-2930, EIP-7702, and legacy.
 */
export function decodeRawTx(rawTx: string): DecodedTransaction {
  const hex = rawTx.startsWith("0x") ? (rawTx as Hex) : (`0x${rawTx}` as Hex);
  const tx = parseTransaction(hex);

  if (!tx.to) {
    throw new Error("Transaction has no `to` address (contract creation)");
  }
  if (tx.chainId === undefined || tx.chainId === null) {
    throw new Error("Transaction has no chainId");
  }

  return {
    chainId: Number(tx.chainId),
    to: tx.to,
    data: tx.data ?? "0x",
    value: tx.value ?? 0n,
  };
}
