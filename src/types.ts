/**
 * Types for the .tests.json input and results.json output.
 * These mirror the contract documented in
 *   .github/test-results/README.md of the clear-signing-erc7730-registry.
 */

/**
 * A single rendered field — `{label, value}` carried in an ordered array.
 * `value` is a plain string, or — for `format: "calldata"` fields — a
 * nested `RenderedDisplay` whose `fields` is itself an array. Nesting is
 * recursive.
 */
export interface RenderedField {
  label: string;
  value: RenderedValue;
}

export type RenderedValue = string | RenderedDisplay;

export interface RenderedDisplay {
  intent: string;
  interpolatedIntent?: string;
  /**
   * Optional per the v2 test schema — a descriptor may legitimately declare
   * no `metadata.owner`. Omitted (not coerced to "") when the library
   * reports none, so a fixture that omits it compares equal.
   */
  owner?: string;
  /**
   * Ordered list of `{label, value}` entries. Labels are not unique
   * (array-iteration paths and groups can produce repeated labels). Entry
   * order matches the descriptor's field declaration order.
   */
  fields: RenderedField[];
}

export interface DataProviderInput {
  tokens?: Record<string, { symbol: string; decimals: number; name: string }>;
  /** Local (non-ENS) display names — feeds `resolveLocalName`. */
  addressNames?: Record<string, string>;
  /** ENS names — feeds `resolveEnsName`. */
  ensNames?: Record<string, string>;
  nftCollectionNames?: Record<string, string>;
  /** Block height (decimal string key) → Unix timestamp in seconds. */
  blockTimestamps?: Record<string, number>;
}

/** EIP-712 typed-data input as carried in a test case. */
export interface Eip712TypedDataInput {
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  domain: Record<string, unknown>;
  message: Record<string, unknown>;
}

export interface CalldataTestCaseInput {
  description: string;
  /** Raw unsigned transaction hex (0x-prefixed). */
  rawTx: string;
  /**
   * Checksummed signer address. Optional — only set when the descriptor
   * references the signer via `@.from`. Passed through to the library's
   * `Transaction.from`.
   */
  from?: string;
  txHash?: string;
  expected: RenderedDisplay;
}

export interface Eip712TestCaseInput {
  description: string;
  data: Eip712TypedDataInput;
  expected: RenderedDisplay;
}

export type TestCaseInput = CalldataTestCaseInput | Eip712TestCaseInput;

export interface TestsFileInput {
  $schema?: string;
  descriptor: string;
  dataProvider?: DataProviderInput;
  tests: TestCaseInput[];
}

export type CaseStatus = "pass" | "fail" | "error" | "skipped";

export interface CaseResult {
  description: string;
  status: CaseStatus;
  rendered?: RenderedDisplay;
  message?: string;
}

export interface ResultsFile {
  runner: "@ethereum-sourcify/clear-signing-test-runner";
  implementation: string;
  cases: CaseResult[];
}
