/**
 * Types for the .tests.json input and results.json output.
 * These mirror the contract documented in
 *   .github/test-results/README.md of the clear-signing-erc7730-registry.
 */

/** Rendered shape — recursive map of label → string | nested map. */
export type RenderedValue = string | { [label: string]: RenderedValue };

export interface RenderedDisplay {
  intent: string;
  owner: string;
  fields: { [label: string]: RenderedValue };
}

export interface DataProviderInput {
  tokens?: Record<
    string,
    { symbol?: string; decimals?: number; name?: string }
  >;
  addressNames?: Record<string, string>;
}

export interface TestCaseInput {
  description: string;
  rawTx: string;
  txHash?: string;
  expected: RenderedDisplay;
}

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
