# @ethereum-sourcify/clear-signing-test-runner

A CLI that drives [`@ethereum-sourcify/clear-signing`](https://github.com/sourcifyeth/clear-signing) against ERC-7730 `.tests.json` fixtures and emits a strict `results.json`. Its output is the contract consumed by the `clear-signing-tests` workflow in [`ethereum/clear-signing-erc7730-registry`](https://github.com/ethereum/clear-signing-erc7730-registry).

## What it does

For each test case in a `.tests.json` file (v2 schema), the runner:

1. Loads the referenced ERC-7730 descriptor JSON.
2. Builds an in-memory registry index from the descriptor (calldata via `context.contract.deployments`; EIP-712 via `context.eip712.deployments` + `display.formats`, hashing each format key with keccak256 and grouping by primary type), so the library never hits the network.
3. For calldata cases, decodes the raw signed transaction (viem) and calls `format()`. For EIP-712 cases, passes the fixture's `data` block to `formatTypedData()`.
4. Provides an `externalDataProvider` shimmed from the fixture's static `dataProvider` block, plus a `resolveChainInfo` that fetches `chainid.network/chains_mini.json` on first use (with retry/backoff) and serves later lookups from an in-memory cache.
5. Maps the library's `DisplayModel` onto the spec's `{ intent, owner, fields }` shape and deep-compares it against `expected`.
6. Writes one entry per case to `results.json` (atomically — written to a temp file and renamed).

## Usage

This repo is meant to be cloned in CI and invoked directly — it is not published to npm. The canonical CI flow is:

```bash
git clone https://github.com/sourcifyeth/clear-signing-test-runner.git
cd clear-signing-test-runner
npm ci
npm run build
node dist/cli.js <tests-file> --output <results-file> [--verbose]
```

Requires Node >= 22. Example invocation:

```bash
node dist/cli.js registry/aave/testsv2/calldata-lpv2.tests.json \
  --output results.json \
  --verbose
```

The runner reaches `chainid.network` once per invocation to populate the chain registry — make sure outbound HTTPS is permitted in CI.

### Exit codes

| Code | Meaning |
| ---- | ------- |
| `0`  | Runner completed. Every input case produced one output entry (`pass` / `fail` / `error` / `skipped`). A failing test does *not* cause a non-zero exit. |
| `1`  | Runner itself failed: couldn't read the input file, couldn't write the output file, or the library failed to import. |

### Flags

- `--output, -o <path>` — required. Where to write `results.json`.
- `--verbose, -v` — log a one-line status per case to stderr, plus a final summary.

## Input format (`.tests.json`, v2 schema)

The schema is defined at [`specs/erc7730-tests-v2.schema.json`](https://github.com/manuelwedler/clear-signing-erc7730-registry/blob/common-test-strategy/specs/erc7730-tests-v2.schema.json) in the registry. A test file declares one descriptor under test, an optional `dataProvider` block of mock external data, and an array of test cases (either calldata or EIP-712).

```json
{
  "$schema": "../../../specs/erc7730-tests-v2.schema.json",
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
    },
    "nftCollectionNames": {
      "0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d": "Bored Ape Yacht Club"
    },
    "blockTimestamps": {
      "18000000": 1696867200
    }
  },
  "tests": [
    {
      "description": "Repay All USDC variable rate",
      "rawTx": "0x02f8ad018189...",
      "txHash": "0xf869d27754...",
      "expected": { "intent": "Repay loan", "owner": "Aave DAO", "fields": { ... } }
    },
    {
      "description": "Permit 100 USDC",
      "data": {
        "types": { "Permit": [...], "EIP712Domain": [...] },
        "primaryType": "Permit",
        "domain": { "chainId": 1, "verifyingContract": "0x..." },
        "message": { "owner": "0x...", "spender": "0x...", "value": "100", "nonce": 0, "deadline": 0 }
      },
      "expected": { "intent": "Permit", "owner": "...", "fields": { ... } }
    }
  ]
}
```

**Test case dispatch.** A case with `rawTx` is treated as calldata and decoded with viem before calling the library's `format()`. A case with `data` is treated as EIP-712 typed data and passed to `formatTypedData()` (an `account: 0x0…0` placeholder is filled in since the schema doesn't carry one).

**`descriptor`** is resolved relative to the tests file's directory.

**`dataProvider` resolvers.** Lookups are case-insensitive on addresses; a miss returns `null` and the library falls back to raw rendering for that field.

| Block | Library hook | Notes |
| ----- | ------------ | ----- |
| `tokens` (`addr → {symbol, decimals, name}`) | `resolveToken` | `symbol`, `decimals`, `name` are all required per v2 schema. |
| `addressNames` (`addr → name`) | `resolveLocalName` / `resolveEnsName` | Names ending in `.eth` route to `resolveEnsName`, everything else to `resolveLocalName`. Both return `typeMatch: true` so descriptor type filters don't fire spurious warnings. |
| `nftCollectionNames` (`addr → name`) | `resolveNftCollectionName` | Same case-insensitive lookup as tokens. |
| `blockTimestamps` (decimal block height → Unix seconds) | `resolveBlockTimestamp` | The library passes `bigint`; we key on its decimal string. |
| *(none — fetched on the fly)* | `resolveChainInfo` | The runner downloads [`chainid.network/chains_mini.json`](https://chainid.network/chains_mini.json) once per process, with retry/backoff, and caches a filtered `{chainId → {name, nativeCurrency}}` map. Required because cross-chain / bridge descriptors can reference foreign chain IDs the fixture author can't enumerate. |

## Output format (`results.json`)

```json
{
  "runner": "@ethereum-sourcify/clear-signing-test-runner",
  "implementation": "@ethereum-sourcify/clear-signing@0.1.3",
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

`implementation` is `@ethereum-sourcify/clear-signing@<version>` where `<version>` is read at build time via `import pkg from "@ethereum-sourcify/clear-signing/package.json" with { type: "json" }` (the library exposes `./package.json` in its `exports` field).

### Field-value shape

`fields` is a flat `{label: value}` map. Field values are strings, except:

- **`calldata` formatters with `embeddedCalldata.display`** — emitted as `{ intent, owner, fields }`, recursively shaped like a top-level `rendered`.

**Groups are flattened.** When the library returns a `DisplayFieldGroup`, its `label` is dropped and its inner fields are merged directly into the parent `fields` map (nested groups collapse the same way). Author `.tests.json` `expected` blocks the same way — no group wrapper objects.

## Verification: aave calldata-lpv2

Tested against the canonical fixture from the registry's `common-test-strategy` branch:

```
registry/aave/testsv2/calldata-lpv2.tests.json
registry/aave/calldata-lpv2.json
```

With `@ethereum-sourcify/clear-signing >= 0.1.4` all three cases pass.

## License

MIT
