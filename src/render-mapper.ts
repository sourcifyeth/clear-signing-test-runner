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
 * Nested objects appear for:
 *   - groups (DisplayFieldGroup) — emitted as { groupLabel: { ...inner } }
 *   - addressName fields whose value is a human-readable name distinct from
 *     the underlying address — emitted as { Name, Address }
 *   - embedded calldata fields — emitted as a nested RenderedDisplay
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
      const label = f.label ?? "";
      out[label] = mapFields(f.fields);
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

  if (
    (field.format === "addressName" ||
      field.format === "interoperableAddressName") &&
    field.rawAddress &&
    field.value &&
    field.value.toLowerCase() !== field.rawAddress.toLowerCase()
  ) {
    return { Name: field.value, Address: field.rawAddress };
  }

  return field.value;
}
