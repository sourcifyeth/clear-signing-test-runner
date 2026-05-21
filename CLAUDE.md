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
  runner.ts           orchestration — load → format/formatTypedData →
                      compare → write atomic. Dispatches calldata vs
                      EIP-712 by presence of `rawTx` vs `data` on the case.
  raw-tx.ts           viem.parseTransaction → {chainId, to, data, value}
  descriptor-index.ts builds RegistryIndex from descriptor deployments,
                      stages descriptor JSON as a .mjs module in os.tmpdir()
  data-provider.ts    maps fixture dataProvider → ExternalDataProvider
                      (tokens/addressNames/nftCollectionNames/blockTimestamps)
  chain-info.ts       lazy fetch + cache of chainid.network/chains_mini.json
                      with retry/backoff; powers resolveChainInfo
  render-mapper.ts    DisplayModel → {intent, owner, fields} (the spec shape)
  compare.ts          deep-equal + first-divergence message for fail status
  types.ts            input/output shapes (RenderedDisplay, ResultsFile,
                      v2 calldata + eip712 test case unions, etc.)
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

- **String** by default — `field.value` verbatim. This includes `addressName` / `interoperableAddressName` fields: emit the library's resolved string (whether it's a human-readable name or a raw address fallback). **Do not** split into a `{Name, Address}` object — only the `calldata` formatter produces a nested object.
- **Group (`DisplayFieldGroup`)**: **flatten**. Drop the group `label` and merge inner entries into the parent `fields` map. Nested groups recurse and collapse the same way. Test fixtures author `expected` blocks this way too — no group wrappers. (The registry spec README implies groups should be nested objects, but the project's convention here is flat. Don't reintroduce wrapping without checking with the user.)
- **`calldata` with `embeddedCalldata.display`**: emit `{intent, owner, fields}` — a nested `RenderedDisplay`-shaped object. The aave fixture doesn't exercise this path, so the exact shape is a judgment call; revisit when a real fixture appears.

`compareRendered` is order-independent on object keys, exact-match on strings (no trim, no case normalization).

## Verified outcome on aave

Against `registry/aave/testsv2/calldata-lpv2.tests.json` on the `common-test-strategy` branch (use [`manuelwedler/clear-signing-erc7730-registry`](https://github.com/manuelwedler/clear-signing-erc7730-registry/tree/common-test-strategy), not upstream) with library `>= 0.1.4`, all three cases pass:

- Repay All USDC variable rate — pass
- Manage collateral — disable WETH — pass
- Withdraw Max WETH to sosalkin.eth — pass

The earlier `threshold`/`message` constant-substitution and addressName rendering issues were resolved upstream (library 0.1.4) and locally (mapper change to emit plain strings for `addressName`). Future regressions on this fixture should be tracked back to the library before the runner.

## v2 test schema

Source of truth: [`specs/erc7730-tests-v2.schema.json`](https://github.com/manuelwedler/clear-signing-erc7730-registry/blob/common-test-strategy/specs/erc7730-tests-v2.schema.json). Tests live at `registry/<entity>/testsv2/<descriptor>.tests.json` (not the legacy `shared-tests/`). A case is either:

- **Calldata** — has `rawTx` (and optional `txHash`). Decoded via viem, routed through `format()`.
- **EIP-712** — has `data: {types, primaryType, domain, message}` (no `rawTx`). Routed through `formatTypedData()`. We inject `account: "0x0…0"` because the schema doesn't carry one; the library uses it only for `@.from` references.

`dataProvider` supports four static blocks (`tokens`, `addressNames`, `nftCollectionNames`, `blockTimestamps`) plus the dynamically-fetched chain info — see the data-provider table in the README.

## EIP-712 typed-data indexing

`descriptor-index.ts` handles both branches:
- **Calldata**: walks `context.contract.deployments`, populates `calldataIndex["eip155:chainId:addr"] = file`.
- **Typed-data**: walks `display.formats` keys, extracts primary type via the library's `eip712.extractPrimaryType`, hashes each key with `keccak256` (`@noble/hashes` — the library doesn't expose hashing primitives), and emits `typedDataIndex[caip][primaryType].push({path, encodeTypeHashes})` per `context.eip712.deployments`.

This mirrors the library's internal `indexDescriptor`. When `context.contract` is present, the typed-data branch is skipped — descriptors are one or the other.

If `indexDescriptor` ever lands in the public exports, replace `descriptor-index.ts`'s body with a single call and drop the `@noble/hashes` dep — until then we keep parity with the library by porting the same shape.

## chainid.network fetch

`chain-info.ts` lazy-fetches `https://chainid.network/chains_mini.json` on the first `resolveChainInfo` call, filters each entry to `{name, nativeCurrency}` keyed by chainId string, and caches the result in module-level state for the rest of the process. Up to 4 attempts with exponential backoff (250ms × 3^(attempt-1)) so transient network errors don't fail a CI run.

If a chain isn't in the list, the resolver returns `null` and the library falls back to raw rendering for that field. Do not fail the runner on a missing chain — that's a "we couldn't enrich" outcome, not a runner-level failure.

## Conventions when working in this repo

- Don't read sibling local projects under `/home/manuel/Projects/sourcify/*` (e.g., the local clear-signing checkout). Fetch from GitHub if needed — the user wants this CLI built against the published library.
- Don't re-fetch the library's source files from GitHub one by one. The README is the source of truth; `node_modules/@ethereum-sourcify/clear-signing/dist/*.d.ts` covers anything the README doesn't.
- The test registry fork to consult: `manuelwedler/clear-signing-erc7730-registry`, branch `common-test-strategy`. The upstream `ethereum/clear-signing-erc7730-registry` does **not** yet have the newest test strategy.
