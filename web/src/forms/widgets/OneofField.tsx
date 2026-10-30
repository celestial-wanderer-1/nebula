import type { DescField, DescOneof } from "@bufbuild/protobuf";
import { useId } from "react";
import { fieldLabel, humanize } from "../../schema/annotations";
import { useFormContext } from "../context";
import { newMessage } from "../defaults";
import { FieldRenderer } from "../FieldRenderer";
import type { OneofValue } from "../MessageFields";
import { joinPath } from "../validate";
import { zeroValue } from "../values";

function initialValue(field: DescField): unknown {
  switch (field.fieldKind) {
    case "message":
      return newMessage(field.message);
    case "enum":
      return field.enum.values[0]?.number ?? 0;
    case "scalar":
      return zeroValue(field.scalar, field);
    default:
      return undefined;
  }
}

/** A variant selector, then the selected variant's fields. */
export function OneofField({
  oneof,
  fields,
  value,
  onChange,
  path,
}: {
  oneof: DescOneof;
  fields: DescField[];
  value: OneofValue | undefined;
  onChange: (value: OneofValue) => void;
  path: string;
}) {
  const id = useId();
  const { readOnly } = useFormContext();
  const selected = fields.find((field) => field.localName === value?.case);
  return (
    <div className="oneof" data-path={joinPath(path, oneof.name)}>
      <div className="field">
        <label htmlFor={id}>{humanize(oneof.name)}</label>
        <select
          id={id}
          value={selected?.localName ?? ""}
          disabled={readOnly}
          onChange={(event) => {
            const field = fields.find(
              (f) => f.localName === event.target.value,
            );
            onChange(
              field
                ? { case: field.localName, value: initialValue(field) }
                : { case: undefined },
            );
          }}
        >
          <option value="">None</option>
          {fields.map((field) => (
            <option key={field.localName} value={field.localName}>
              {fieldLabel(field)}
            </option>
          ))}
        </select>
      </div>
      {selected && (
        <FieldRenderer
          field={selected}
          value={value?.value}
          onChange={(next) =>
            onChange({ case: selected.localName, value: next })
          }
          path={joinPath(path, selected.name)}
        />
      )}
    </div>
  );
}
