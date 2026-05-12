#!/usr/bin/env node
import { Command } from "commander";

import { runTests } from "./runner.js";

const program = new Command();
program
  .name("clear-signing-test-runner")
  .description(
    "Run ERC-7730 clear-signing tests against @ethereum-sourcify/clear-signing and emit results.json",
  )
  .argument("<tests-file>", "path to a .tests.json input file")
  .requiredOption("-o, --output <results-file>", "path to write results.json")
  .option("-v, --verbose", "log a line to stderr per case", false)
  .action(
    async (
      testsFile: string,
      options: { output: string; verbose: boolean },
    ) => {
      try {
        const results = await runTests({
          testsFile,
          outputFile: options.output,
          verbose: options.verbose,
          log: (line) => process.stderr.write(line + "\n"),
        });
        if (options.verbose) {
          const summary = countByStatus(results.cases);
          process.stderr.write(
            `done: ${summary.pass} pass, ${summary.fail} fail, ${summary.error} error, ${summary.skipped} skipped\n`,
          );
        }
        process.exit(0);
      } catch (err) {
        process.stderr.write(
          `clear-signing-test-runner: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exit(1);
      }
    },
  );

await program.parseAsync(process.argv);

function countByStatus(cases: { status: string }[]) {
  const out = { pass: 0, fail: 0, error: 0, skipped: 0 } as Record<
    string,
    number
  >;
  for (const c of cases) {
    if (c.status in out) out[c.status]!++;
  }
  return out as { pass: number; fail: number; error: number; skipped: number };
}
