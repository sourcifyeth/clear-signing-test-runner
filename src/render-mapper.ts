import type {
  DisplayField,
  DisplayFieldGroup,
  DisplayModel,
} from "@ethereum-sourcify/clear-signing";
import { isFieldGroup } from "@ethereum-sourcify/clear-signing";

import type {
  RenderedDisplay,
  RenderedField,
  RenderedValue,
} from "./types.js";

/**
 * Map a clear-signing DisplayModel onto the RenderedDisplay shape the test
 * results contract expects:
 *   { intent, interpolatedIntent?, owner?, fields: Array<{label, value}> }
 *
 * `fields` is an ordered array — duplicate labels are preserved (array
 * iteration paths like `signers.[]` legitimately emit the same label
 * multiple times). Groups (`DisplayFieldGroup`) are flattened in place:
 * their `label` is dropped and their inner entries are appended to the
 * parent array in order. Nested groups recurse and flatten the same way.
 * Test fixtures' `expected.fields` are authored in the same shape.
 *
 * The only nesting comes from `calldata` embedded calldata fields, where
 * the entry's `value` is a recursive `{intent, owner, fields: [...]}`
 * RenderedDisplay.
 */
export function mapDisplayModel(model: DisplayModel): RenderedDisplay {
  const out: RenderedDisplay = {
    intent: renderIntent(model.intent),
    fields: mapFields(model.fields ?? []),
  };
  if (model.interpolatedIntent !== undefined) {
    out.interpolatedIntent = model.interpolatedIntent;
  }
  if (model.metadata?.owner !== undefined) {
    out.owner = model.metadata.owner;
  }
  return out;
}

function renderIntent(intent: DisplayModel["intent"]): string {
  if (intent == null) return "";
  if (typeof intent === "string") return intent;
  return Object.entries(intent)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
}

function mapFields(
  fields: ReadonlyArray<DisplayField | DisplayFieldGroup>,
): RenderedField[] {
  const out: RenderedField[] = [];
  for (const f of fields) {
    if (isFieldGroup(f)) {
      // Groups are flattened in place — append inner entries in order.
      out.push(...mapFields(f.fields));
    } else {
      out.push({ label: f.label, value: mapField(f) });
    }
  }
  return out;
}

function mapField(field: DisplayField): RenderedValue {
  if (field.embeddedCalldata?.display) {
    const display = field.embeddedCalldata.display;
    // When the library couldn't resolve / render the inner call (no
    // descriptor for the target, decode error, etc.) it returns a model
    // with only top-level warnings — no intent, no fields, no owner. In
    // that case emit `field.value` (the raw embedded calldata hex) so the
    // wallet has something to display, rather than an empty nested object.
    if (isUnresolvedDisplay(display)) {
      return field.value;
    }
    return mapDisplayModel(display);
  }

  return field.value;
}

function isUnresolvedDisplay(display: DisplayModel): boolean {
  return Boolean(display.warnings?.length);
}
