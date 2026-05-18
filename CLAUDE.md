# CLAUDE.md

Context for future Claude sessions on `@ethereum-sourcify/clear-signing-test-runner`.

## What this is

A CLI that drives [`@ethereum-sourcify/clear-signing`](https://github.com/sourcifyeth/clear-signing) against ERC-7730 `.tests.json` fixtures and emits a strict `results.json`. The output is consumed by the `clear-signing-tests` workflow in [`ethereum/clear-signing-erc7730-registry`](https://github.com/ethereum/clear-signing-erc7730-registry) — **the output shape is a hard external contract**, defined in `.github/test-results/README.md` of that registry. Do not invent fields; do not rename; do not reorder optional keys in ways that break the spec.

## Build & run

```bash
npm install
npm run build        # tsc + chmod +x dist/cli.js
node dist/cli.js <tests-file> -o <results-file> [--verbose]
```

Node >= 22. ESM only. TypeScript with `moduleResolution: "NodeNext"`. Requires `@ethereum-sourcify/clear-signing >= 0.1.3` — earlier versions ship extensionless relative imports that break Node ESM at runtime. If you must work with 0.1.1, see the git history for the postinstall patch + `Bundler` resolution workaround.

## Module layout

```
src/
  cli.ts              commander entrypoint, shebang preserved by tsc
  runner.ts           orchestration — load → format → compare → write atomic
  raw-tx.ts           viem.parseTransaction → {chainId, to, data, value}
  descriptor-index.ts builds RegistryIndex from descriptor deployments,
                      stages descriptor JSON as a .mjs module in os.tmpdir()
  data-provider.ts    maps fixture dataProvider → ExternalDataProvider
  render-mapper.ts    DisplayModel → {intent, owner, fields} (the spec shape)
  compare.ts          deep-equal + first-divergence message for fail status
  types.ts            input/output shapes (RenderedDisplay, ResultsFile, etc.)
  index.ts            library surface — exports runTests + types
```

## Output contract — the four statuses

Source of truth: `.github/test-results/README.md` in the registry, plus the four `*.example.json` files alongside.

| `status`   | `rendered` | `message`            | When |
| ---------- | ---------- | -------------------- | ---- |
| `pass`     | required   | omitted              | mapped output deep-equals `expected` |
| `fail`     | required   | optional             | model rendered but diverges from `expected` |
| `error`    | omitted    | **required**         | case threw (decode failure, library error, etc.) |
| `skipped`  | omitted    | **required**         | runner opted out of running it |

`runner` is a literal constant. `implementation` is `@ethereum-sourcify/clear-signing@<version>` where version is imported at build time via `import pkg from "@ethereum-sourcify/clear-signing/package.json" with { type: "json" }` (the library's `exports` field exposes `./package.json` since 0.1.3).

Exit code is `0` iff the runner ran to completion. A failing case does **not** cause a non-zero exit. Non-zero is reserved for runner-level failures (bad input path, library import failure).

## Field-value mapping rules

The library returns a `DisplayModel`; we flatten it to `{intent: string, owner: string, fields: {label: RenderedValue}}` where `RenderedValue = string | {label: RenderedValue}`. Specifically:

- **String** by default — `field.value` verbatim.
- **`addressName` / `interoperableAddressName`**: emit `{Name, Address}` *only* when `field.rawAddress` exists and `field.value.toLowerCase() !== field.rawAddress.toLowerCase()` (i.e., a human-readable name actually resolved). Otherwise emit the plain string. Lowercase compare matters — `rawAddress` is EIP-55 checksum.
- **Group (`DisplayFieldGroup`)**: emit `{groupLabel: {...recursed fields}}`. Empty groups → `{}`.
- **`calldata` with `embeddedCalldata.display`**: emit `{intent, owner, fields}` — a nested `RenderedDisplay`-shaped object. The aave fixture doesn't exercise this path, so the exact shape is a judgment call; revisit when a real fixture appears.

`compareRendered` is order-independent on object keys, exact-match on strings (no trim, no case normalization).

## The fixture-vs-library divergence

When verified against `registry/aave/shared-tests/calldata-lpv2.tests.json` on the `common-test-strategy` branch (use [`manuelwedler/clear-signing-erc7730-registry`](https://github.com/manuelwedler/clear-signing-erc7730-registry/tree/common-test-strategy), not upstream), all three cases produce well-formed entries but all three currently `fail`:

1. **Repay All USDC** — library renders max-uint amounts literally instead of substituting the descriptor's `params.message: "All"`. Likely a `threshold` / constants-resolution gap in the library.
2. **Manage collateral — disable WETH** — fixture's `expected` is `"For asset": "WETH"` (bare string). Our mapper produces `{Name: "WETH", Address: "0xC02..."}` because the library resolved the contract-label name and gave us `rawAddress`. Two equally defensible interpretations of the spec — the README pass example shows nested, the aave fixture expects bare. Don't change the mapper to match one fixture's convention without confirming the registry's official position.
3. **Withdraw Max WETH** — same two issues combined.

These are real disagreements, not runner bugs. The task explicitly said "the actual pass/fail outcome depends on the current state of the Sourcify library."

## EIP-712 typed-data fixtures are not supported

`descriptor-index.ts` only indexes `context.contract.deployments` (calldata). The library's `RegistryIndex.typedDataIndex` requires `Record<string, Record<string, TypedDataIndexEntry[]>>` — keyed on encodeType hashes — and we have no fixture exercising that path yet. Build out the typed-data branch when a real `.tests.json` needs it; don't reintroduce a stub that hands the library bogus index shape.

## Conventions when working in this repo

- Don't read sibling local projects under `/home/manuel/Projects/sourcify/*` (e.g., the local clear-signing checkout). Fetch from GitHub if needed — the user wants this CLI built against the published library.
- Don't re-fetch the library's source files from GitHub one by one. The README is the source of truth; `node_modules/@ethereum-sourcify/clear-signing/dist/*.d.ts` covers anything the README doesn't.
- The test registry fork to consult: `manuelwedler/clear-signing-erc7730-registry`, branch `common-test-strategy`. The upstream `ethereum/clear-signing-erc7730-registry` does **not** yet have the newest test strategy.
