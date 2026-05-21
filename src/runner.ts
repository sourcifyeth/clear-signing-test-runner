import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { format, formatTypedData } from "@ethereum-sourcify/clear-signing";
import type { Warning } from "@ethereum-sourcify/clear-signing";
import implementationPkg from "@ethereum-sourcify/clear-signing/package.json" with { type: "json" };

import { compareRendered } from "./compare.js";
import { buildExternalDataProvider } from "./data-provider.js";
import { buildIndexFromDescriptorFile } from "./descriptor-index.js";
import { decodeRawTx } from "./raw-tx.js";
import { mapDisplayModel } from "./render-mapper.js";
import type {
  CaseResult,
  Eip712TestCaseInput,
  CalldataTestCaseInput,
  ResultsFile,
  TestCaseInput,
  TestsFileInput,
} from "./types.js";

const RUNNER_ID = "@ethereum-sourcify/clear-signing-test-runner" as const;

export interface RunOptions {
  testsFile: string;
  outputFile: string;
  verbose?: boolean;
  /** Receives one line per case when verbose. */
  log?: (line: string) => void;
}

export async function runTests(opts: RunOptions): Promise<ResultsFile> {
  const testsPath = resolve(opts.testsFile);
  const raw = await readFile(testsPath, "utf8");
  const input = JSON.parse(raw) as TestsFileInput;

  if (!input.descriptor) throw new Error("tests file missing `descriptor`");
  if (!Array.isArray(input.tests)) throw new Error("tests file missing `tests` array");

  const descriptorPath = resolve(dirname(testsPath), input.descriptor);
  const { descriptorDirectory, index } = await buildIndexFromDescriptorFile(
    descriptorPath,
  );

  const externalDataProvider = buildExternalDataProvider(input.dataProvider);

  const cases: CaseResult[] = [];
  for (const tc of input.tests) {
    const result = await runOneCase(tc, {
      descriptorDirectory,
      index,
      externalDataProvider,
    });
    cases.push(result);
    if (opts.verbose) {
      opts.log?.(`[${result.status}] ${result.description}${result.message ? ` — ${result.message}` : ""}`);
    }
  }

  const results: ResultsFile = {
    runner: RUNNER_ID,
    implementation: `@ethereum-sourcify/clear-signing@${implementationPkg.version}`,
    cases,
  };

  await writeAtomic(resolve(opts.outputFile), JSON.stringify(results, null, 2) + "\n");
  return results;
}

type RunContext = {
  descriptorDirectory: string;
  index: import("@ethereum-sourcify/clear-signing").RegistryIndex;
  externalDataProvider: import("@ethereum-sourcify/clear-signing").ExternalDataProvider;
};

async function runOneCase(
  tc: TestCaseInput,
  ctx: RunContext,
): Promise<CaseResult> {
  try {
    const model = isEip712Case(tc)
      ? await formatTypedDataCase(tc, ctx)
      : await formatCalldataCase(tc, ctx);

    const rendered = mapDisplayModel(model);
    const cmp = compareRendered(rendered, tc.expected);
    if (cmp.ok) {
      return { description: tc.description, status: "pass", rendered };
    }
    return {
      description: tc.description,
      status: "fail",
      rendered,
      message: appendWarnings(cmp.message, model.warnings),
    };
  } catch (err) {
    return {
      description: tc.description,
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function isEip712Case(tc: TestCaseInput): tc is Eip712TestCaseInput {
  return "data" in tc;
}

/**
 * Surface library warnings on a `fail`. Without this, an empty render
 * (e.g. when no descriptor matched) bottoms out at a generic
 * "intent mismatch: expected 'Borrow', got ''" with no clue as to why
 * everything is empty — the warning is what tells you.
 */
function appendWarnings(
  message: string,
  warnings: Warning[] | undefined,
): string {
  if (!warnings?.length) return message;
  const formatted = warnings.map((w) => `${w.code}: ${w.message}`).join("; ");
  return `${message} (library warnings: ${formatted})`;
}

function resolverOptions(ctx: RunContext) {
  return {
    descriptorResolverOptions: {
      type: "embedded" as const,
      index: ctx.index,
      descriptorDirectory: ctx.descriptorDirectory,
    },
    externalDataProvider: ctx.externalDataProvider,
  };
}

async function formatCalldataCase(tc: CalldataTestCaseInput, ctx: RunContext) {
  const decoded = decodeRawTx(tc.rawTx);
  return format(
    {
      chainId: decoded.chainId,
      to: decoded.to,
      data: decoded.data,
      value: decoded.value,
    },
    resolverOptions(ctx),
  );
}

async function formatTypedDataCase(tc: Eip712TestCaseInput, ctx: RunContext) {
  // The fixture's `data` doesn't carry `account`; the library uses it only
  // for `@.from` references. Pass the zero address as a placeholder — if a
  // descriptor really depends on a signer-specific value, it'll surface as
  // a warning in the rendered output.
  return formatTypedData(
    { account: "0x0000000000000000000000000000000000000000", ...tc.data },
    resolverOptions(ctx),
  );
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, path);
}
