import {
  parseTransaction,
  recoverTransactionAddress,
  type Hex,
  type TransactionSerialized,
} from "viem";

export interface DecodedTransaction {
  chainId: number;
  to: string;
  data: string;
  value: bigint;
  /**
   * EOA that signed the transaction, ecrecovered from the rawTx signature.
   * Absent when the rawTx is unsigned. The clear-signing library uses this
   * to resolve `@.from` references in descriptors.
   */
  from?: string;
}

/**
 * Decode a raw signed transaction hex into the fields the clear-signing
 * library needs. Supports EIP-1559, EIP-2930, EIP-7702, and legacy.
 *
 * Recovers the sender (`from`) from the signature when present. If the rawTx
 * is unsigned, `from` is left undefined and recovery errors are swallowed —
 * the fixture is still useful for descriptors that don't reference `@.from`.
 */
export async function decodeRawTx(rawTx: string): Promise<DecodedTransaction> {
  const hex = rawTx.startsWith("0x") ? (rawTx as Hex) : (`0x${rawTx}` as Hex);
  const tx = parseTransaction(hex);

  if (!tx.to) {
    throw new Error("Transaction has no `to` address (contract creation)");
  }
  if (tx.chainId === undefined || tx.chainId === null) {
    throw new Error("Transaction has no chainId");
  }

  let from: string | undefined;
  try {
    // viem's TransactionSerialized is a branded union of typed-prefixed hex
    // (`0x01..` etc.); cast through after parseTransaction has already
    // accepted the input.
    from = await recoverTransactionAddress({
      serializedTransaction: hex as TransactionSerialized,
    });
  } catch {
    // Unsigned rawTx — `from` will stay undefined.
  }

  return {
    chainId: Number(tx.chainId),
    to: tx.to,
    data: tx.data ?? "0x",
    value: tx.value ?? 0n,
    from,
  };
}
