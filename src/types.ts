/**
 * Types for the .tests.json input and results.json output.
 * These mirror the contract documented in
 *   .github/test-results/README.md of the clear-signing-erc7730-registry.
 */

/** Rendered shape — recursive map of label → string | nested map. */
export type RenderedValue = string | { [label: string]: RenderedValue };

export interface RenderedDisplay {
  intent: string;
  interpolatedIntent?: string;
  owner: string;
  fields: { [label: string]: RenderedValue };
}

export interface DataProviderInput {
  tokens?: Record<string, { symbol: string; decimals: number; name: string }>;
  addressNames?: Record<string, string>;
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
  rawTx: string;
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
