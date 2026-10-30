import { create, toJson, type DescField } from "@bufbuild/protobuf";
import { useId } from "react";
import { getTypeRegistry } from "../../api/registry";
import { fieldLabel } from "../../schema/annotations";
import { FieldShell } from "../FieldShell";

/** The protobuf JSON of one field value, via a message holding only it. */
function fieldJson(field: DescField, value: unknown): string {
  try {
    const holder = create(field.parent) as Record<string, unknown>;
    if (field.oneof) {
      holder[field.oneof.localName] = { case: field.localName, value };
    } else {
      holder[field.localName] = value;
    }
    const json = toJson(field.parent, holder as never, {
      registry: getTypeRegistry(),
      alwaysEmitImplicit: true,
    }) as Record<string, unknown>;
    return JSON.stringify(json[field.jsonName] ?? null, null, 2);
  } catch {
    return JSON.stringify(value, (_, v: unknown) =>
      typeof v === "bigint" ? v.toString() : v,
    );
  }
}

/**
 * Read-only fallback for fields the form engine cannot render, such as a
 * field carrying a core option from a newer build (docs/UI.md Section 5).
 * The value is shown, never dropped.
 */
export function RawJsonField({
  field,
  value,
  path,
  reason,
}: {
  field: DescField;
  value: unknown;
  path: string;
  reason: string;
}) {
  const id = useId();
  return (
    <FieldShell
      id={id}
      path={path}
      label={fieldLabel(field)}
      help={reason}
      labelElement="span"
    >
      <pre
        id={id}
        className="raw-json"
        role="textbox"
        aria-readonly="true"
        aria-multiline="true"
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-help`}
        tabIndex={0}
      >
        {fieldJson(field, value)}
      </pre>
    </FieldShell>
  );
}
