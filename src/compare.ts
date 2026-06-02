import type {
  RenderedDisplay,
  RenderedField,
  RenderedValue,
} from "./types.js";

interface CompareResult {
  ok: boolean;
  /** Human-readable note about the first divergence. Empty when `ok`. */
  message: string;
}

/**
 * Deep structural equality between two RenderedDisplay objects. Strings are
 * compared exactly (no trim, no case normalization). `fields` is compared
 * as an ordered array — entries are diffed by index, including labels.
 * Duplicate labels are first-class. On mismatch, `message` describes the
 * first divergence using `fields[i]` / `fields[i].label` /
 * `fields[i].value` paths.
 */
export function compareRendered(
  actual: RenderedDisplay,
  expected: RenderedDisplay,
): CompareResult {
  if (actual.intent !== expected.intent) {
    return mismatch("intent", expected.intent, actual.intent);
  }
  if (actual.interpolatedIntent !== expected.interpolatedIntent) {
    return mismatch(
      "interpolatedIntent",
      expected.interpolatedIntent,
      actual.interpolatedIntent,
    );
  }
  if (actual.owner !== expected.owner) {
    return mismatch("owner", expected.owner, actual.owner);
  }
  return compareFieldArray(actual.fields, expected.fields, "fields");
}

function compareFieldArray(
  actual: RenderedField[],
  expected: RenderedField[],
  path: string,
): CompareResult {
  if (actual.length !== expected.length) {
    return {
      ok: false,
      message: `${path}: length mismatch — expected ${expected.length} entries, got ${actual.length}`,
    };
  }
  for (let i = 0; i < expected.length; i++) {
    const a = actual[i]!;
    const e = expected[i]!;
    if (a.label !== e.label) {
      return mismatch(`${path}[${i}].label`, e.label, a.label);
    }
    const r = compareValue(a.value, e.value, `${path}[${i}].value`);
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
    return compareNestedDisplay(
      actual as RenderedDisplay,
      expected as RenderedDisplay,
      path,
    );
  }
  if (actual !== expected) {
    return mismatch(path, expected, actual);
  }
  return { ok: true, message: "" };
}

function compareNestedDisplay(
  actual: RenderedDisplay,
  expected: RenderedDisplay,
  path: string,
): CompareResult {
  if (actual.intent !== expected.intent) {
    return mismatch(`${path}.intent`, expected.intent, actual.intent);
  }
  if (actual.interpolatedIntent !== expected.interpolatedIntent) {
    return mismatch(
      `${path}.interpolatedIntent`,
      expected.interpolatedIntent,
      actual.interpolatedIntent,
    );
  }
  if (actual.owner !== expected.owner) {
    return mismatch(`${path}.owner`, expected.owner, actual.owner);
  }
  return compareFieldArray(actual.fields, expected.fields, `${path}.fields`);
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
