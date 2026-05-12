# @ethereum-sourcify/clear-signing-test-runner

A CLI that drives [`@ethereum-sourcify/clear-signing`](https://github.com/sourcifyeth/clear-signing) against ERC-7730 `.tests.json` fixtures and emits a strict `results.json`. Its output is the contract consumed by the `clear-signing-tests` workflow in [`ethereum/clear-signing-erc7730-registry`](https://github.com/ethereum/clear-signing-erc7730-registry).

## What it does

For each test case in a `.tests.json` file, the runner:

1. Loads the referenced ERC-7730 descriptor JSON.
2. Builds an in-memory registry index from the descriptor's `context.contract.deployments` / `context.eip712.deployments`, so the library never hits the network.
3. Decodes the raw signed transaction (viem) to extract `chainId`, `to`, `data`, `value`.
4. Calls `format()` with an `externalDataProvider` shimmed from the fixture's static `dataProvider` block.
5. Maps the library's `DisplayModel` onto the spec's `{ intent, owner, fields }` shape and deep-compares it against `expected`.
6. Writes one entry per case to `results.json` (atomically — written to a temp file and renamed).

## Install

```bash
npm install
npm run build
```

This package has a `postinstall` step that patches the published `@ethereum-sourcify/clear-signing@0.1.1` dist to add `.js` extensions on its internal relative imports. Without that patch, Node ESM can't load the library and TypeScript NodeNext can't follow its type re-exports. The patch is idempotent; remove it once an upstream release ships the fix.

## Usage

```bash
clear-signing-test-runner <tests-file> --output <results-file> [--verbose]
```

Example:

```bash
node dist/cli.js registry/aave/shared-tests/calldata-lpv2.tests.json \
  --output results.json \
  --verbose
```

### Exit codes

| Code | Meaning |
| ---- | ------- |
| `0`  | Runner completed. Every input case produced one output entry (`pass` / `fail` / `error` / `skipped`). A failing test does *not* cause a non-zero exit. |
| `1`  | Runner itself failed: couldn't read the input file, couldn't write the output file, or the library failed to import. |

### Flags

- `--output, -o <path>` — required. Where to write `results.json`.
- `--verbose, -v` — log a one-line status per case to stderr, plus a final summary.

## Input format (`.tests.json`)

```json
{
  "$schema": "...",
  "descriptor": "../calldata-lpv2.json",
  "dataProvider": {
    "tokens": {
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": {
        "symbol": "USDC", "decimals": 6, "name": "USD Coin"
      }
    },
    "addressNames": {
      "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": "WETH",
      "0xd20c9018a5097e922e9c0539aef389c871e76c3f": "sosalkin.eth"
    }
  },
  "tests": [
    {
      "description": "Repay All USDC variable rate",
      "rawTx": "0x02f8ad018189...",
      "txHash": "0xf869d27754...",
      "expected": {
        "intent": "Repay loan",
        "owner": "Aave DAO",
        "fields": {
          "Amount to repay": "All USDC",
          "Interest rate mode": "variable",
          "For debt holder": "0x2Fec9B58d089447d3E5E50578B9F71321713a470"
        }
      }
    }
  ]
}
```

- `descriptor` is resolved **relative to the tests file's directory**.
- `dataProvider.tokens` keys are lowercase addresses; values feed `resolveToken`.
- `dataProvider.addressNames`: entries ending in `.eth` are served from `resolveEnsName`, others from `resolveLocalName`. Both unconditionally return `typeMatch: true` so descriptor type filters don't fire spurious warnings.

## Output format (`results.json`)

```json
{
  "runner": "@ethereum-sourcify/clear-signing-test-runner",
  "implementation": "@ethereum-sourcify/clear-signing@0.1.1",
  "cases": [
    {
      "description": "Repay All USDC variable rate",
      "status": "pass",
      "rendered": {
        "intent": "Repay loan",
        "owner": "Aave DAO",
        "fields": {
          "Amount to repay": "All USDC",
          "Interest rate mode": "variable",
          "For debt holder": "0x2Fec9B58d089447d3E5E50578B9F71321713a470"
        }
      }
    }
  ]
}
```

| Status     | When                                                              | `rendered`?      | `message`?       |
| ---------- | ----------------------------------------------------------------- | ---------------- | ---------------- |
| `pass`     | The mapped display deep-equals `expected`.                        | yes              | omitted          |
| `fail`     | Library returned a model but it differs from `expected`.          | yes              | optional         |
| `error`    | The case threw (decode failure, library import, etc.).            | omitted          | **required**     |
| `skipped`  | The runner chose not to process the case.                         | omitted          | **required**     |

The runner never emits `skipped` on its own — that status exists for future opt-out logic.

`implementation` is `@ethereum-sourcify/clear-signing@<version>` where `<version>` is read at runtime from the installed library's `package.json`.

### Field-value shape

Field values are strings, except:

- **Groups (`DisplayFieldGroup`)** — emitted as `{ groupLabel: { ...inner } }`.
- **`addressName` / `interoperableAddressName` with a resolved name** — emitted as `{ Name, Address }` when the library produced a `rawAddress` and a human-readable `value` distinct from it. When the address didn't resolve, the value falls back to a plain string (the raw address).
- **`calldata` formatters with `embeddedCalldata.display`** — emitted as `{ intent, owner, fields }`, recursively shaped like a top-level `rendered`.

## Verification: aave calldata-lpv2

Tested against the canonical fixture from the registry's `common-test-strategy` branch:

```
registry/aave/shared-tests/calldata-lpv2.tests.json
registry/aave/calldata-lpv2.json
```

All three cases produce well-formed entries (`status` ∈ {`pass`, `fail`, `error`}, plus the required surrounding fields). The actual pass/fail outcome depends on the current state of `@ethereum-sourcify/clear-signing`.

## License

MIT
