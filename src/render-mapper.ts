import type {
  DisplayField,
  DisplayFieldGroup,
  DisplayModel,
} from "@ethereum-sourcify/clear-signing";
import { isFieldGroup } from "@ethereum-sourcify/clear-signing";

import type { RenderedDisplay, RenderedValue } from "./types.js";

/**
 * Map a clear-signing DisplayModel onto the RenderedDisplay shape the test
 * results contract expects:
 *   { intent: string, owner: string, fields: { label: string | nested } }
 *
 * Fields are a flat `{label: value}` map. Groups (`DisplayFieldGroup`) are
 * flattened — their `label` is dropped and their inner fields are merged into
 * the parent map. Test fixtures' `expected` blocks are authored this way too.
 *
 * The only nesting comes from `calldata` embedded calldata fields, which
 * emit a `{intent, owner, fields}` object recursively shaped like a
 * top-level RenderedDisplay.
 */
export function mapDisplayModel(model: DisplayModel): RenderedDisplay {
  return {
    intent: renderIntent(model.intent),
    owner: model.metadata?.owner ?? "",
    fields: mapFields(model.fields ?? []),
  };
}

function renderIntent(
  intent: DisplayModel["intent"],
): string {
  if (intent == null) return "";
  if (typeof intent === "string") return intent;
  return Object.entries(intent)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
}

function mapFields(
  fields: ReadonlyArray<DisplayField | DisplayFieldGroup>,
): { [label: string]: RenderedValue } {
  const out: { [label: string]: RenderedValue } = {};
  for (const f of fields) {
    if (isFieldGroup(f)) {
      // Groups are flattened: drop the group label, merge inner entries
      // into the parent map. Nested groups recurse and collapse as well.
      for (const [label, value] of Object.entries(mapFields(f.fields))) {
        out[label] = value;
      }
    } else {
      out[f.label] = mapField(f);
    }
  }
  return out;
}

function mapField(field: DisplayField): RenderedValue {
  if (field.embeddedCalldata?.display) {
    const inner = mapDisplayModel(field.embeddedCalldata.display);
    return { intent: inner.intent, owner: inner.owner, fields: inner.fields };
  }

  return field.value;
}
