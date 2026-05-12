import type { RenderedDisplay, RenderedValue } from "./types.js";

interface CompareResult {
  ok: boolean;
  /** Human-readable note about the first divergence. Empty when `ok`. */
  message: string;
}

/**
 * Deep structural equality between two RenderedDisplay objects. Strings are
 * compared exactly (no trim, no case normalization). Field key order is
 * irrelevant. On mismatch, `message` describes the first divergence.
 */
export function compareRendered(
  actual: RenderedDisplay,
  expected: RenderedDisplay,
): CompareResult {
  if (actual.intent !== expected.intent) {
    return mismatch("intent", expected.intent, actual.intent);
  }
  if (actual.owner !== expected.owner) {
    return mismatch("owner", expected.owner, actual.owner);
  }
  return compareFieldMap(actual.fields, expected.fields, "fields");
}

function compareFieldMap(
  actual: { [label: string]: RenderedValue },
  expected: { [label: string]: RenderedValue },
  path: string,
): CompareResult {
  const actualKeys = Object.keys(actual);
  const expectedKeys = Object.keys(expected);

  const expectedSet = new Set(expectedKeys);
  for (const k of actualKeys) {
    if (!expectedSet.has(k)) {
      return {
        ok: false,
        message: `${path}: unexpected key '${k}' in actual`,
      };
    }
  }
  const actualSet = new Set(actualKeys);
  for (const k of expectedKeys) {
    if (!actualSet.has(k)) {
      return {
        ok: false,
        message: `${path}: missing key '${k}' in actual`,
      };
    }
  }

  for (const k of expectedKeys) {
    const r = compareValue(actual[k]!, expected[k]!, `${path}.${k}`);
    if (!r.ok) return r;
  }
  return { ok: true, message: "" };
}

function compareValue(
  actual: RenderedValue,
  expected: RenderedValue,
  path: string,
): CompareResult {
  const aIsObj = typeof actual === "object" && actual !== null;
  const eIsObj = typeof expected === "object" && expected !== null;
  if (aIsObj !== eIsObj) {
    return mismatch(path, expected, actual);
  }
  if (aIsObj && eIsObj) {
    return compareFieldMap(
      actual as { [k: string]: RenderedValue },
      expected as { [k: string]: RenderedValue },
      path,
    );
  }
  if (actual !== expected) {
    return mismatch(path, expected, actual);
  }
  return { ok: true, message: "" };
}

function mismatch(
  path: string,
  expected: unknown,
  actual: unknown,
): CompareResult {
  return {
    ok: false,
    message: `${path} mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  };
}
