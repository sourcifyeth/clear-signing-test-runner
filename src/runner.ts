import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { format } from "@ethereum-sourcify/clear-signing";

import { compareRendered } from "./compare.js";
import { buildExternalDataProvider } from "./data-provider.js";
import { buildIndexFromDescriptorFile } from "./descriptor-index.js";
import { decodeRawTx } from "./raw-tx.js";
import { mapDisplayModel } from "./render-mapper.js";
import type {
  CaseResult,
  ResultsFile,
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
    implementation: `@ethereum-sourcify/clear-signing@${await readImplementationVersion()}`,
    cases,
  };

  await writeAtomic(resolve(opts.outputFile), JSON.stringify(results, null, 2) + "\n");
  return results;
}

async function runOneCase(
  tc: TestsFileInput["tests"][number],
  ctx: {
    descriptorDirectory: string;
    index: import("@ethereum-sourcify/clear-signing").RegistryIndex;
    externalDataProvider: import("@ethereum-sourcify/clear-signing").ExternalDataProvider;
  },
): Promise<CaseResult> {
  try {
    const decoded = decodeRawTx(tc.rawTx);
    const model = await format(
      {
        chainId: decoded.chainId,
        to: decoded.to,
        data: decoded.data,
        value: decoded.value,
      },
      {
        descriptorResolverOptions: {
          type: "embedded",
          index: ctx.index,
          descriptorDirectory: ctx.descriptorDirectory,
        },
        externalDataProvider: ctx.externalDataProvider,
      },
    );

    const rendered = mapDisplayModel(model);
    const cmp = compareRendered(rendered, tc.expected);
    if (cmp.ok) {
      return { description: tc.description, status: "pass", rendered };
    }
    return {
      description: tc.description,
      status: "fail",
      rendered,
      message: cmp.message,
    };
  } catch (err) {
    return {
      description: tc.description,
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function readImplementationVersion(): Promise<string> {
  // The library's `exports` field doesn't expose `package.json`, so we resolve
  // its ESM entrypoint and walk up to the package root.
  try {
    const entryUrl = import.meta.resolve("@ethereum-sourcify/clear-signing");
    const entry = fileURLToPath(entryUrl);
    const pkgPath = resolve(dirname(entry), "..", "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, path);
}
