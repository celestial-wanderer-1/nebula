import { ScalarType, type DescField } from "@bufbuild/protobuf";
import { useState } from "react";
import { fieldLabel, quantityOf } from "../../schema/annotations";
import { useFormContext } from "../context";
import { violationsAt } from "../validate";
import {
  isNumericScalar,
  numericKind,
  zeroValue,
  type NumericValue,
} from "../values";
import { NumberInput } from "./NumberInput";
import { RawJsonField } from "./RawJsonField";

type MapValue = Record<string, unknown>;

/** `map<string, scalar>` as key/value rows; other maps read-only. */
export function MapField({
  field,
  value,
  onChange,
  path,
}: {
  field: DescField & { fieldKind: "map" };
  value: MapValue;
  onChange: (value: MapValue) => void;
  path: string;
}) {
  const { readOnly, violations } = useFormContext();
  const editable =
    field.mapKey === ScalarType.STRING &&
    field.mapKind === "scalar" &&
    (field.scalar === ScalarType.STRING || isNumericScalar(field.scalar));
  if (!editable) {
    return (
      <RawJsonField
        field={field}
        value={value}
        path={path}
        reason="Maps of this type are not editable here yet."
      />
    );
  }
  const scalar = field.scalar;
  const label = fieldLabel(field);
  const unit = quantityOf(field)?.unit;
  const entries = Object.entries(value);

  const rename = (from: string, to: string) =>
    onChange(
      Object.fromEntries(entries.map(([k, v]) => [k === from ? to : k, v])),
    );
  const setValue = (key: string, next: unknown) =>
    onChange({ ...value, [key]: next });
  const remove = (key: string) =>
    onChange(Object.fromEntries(entries.filter(([k]) => k !== key)));
  const add = () => {
    let n = entries.length + 1;
    while (`key${n}` in value) n += 1;
    onChange({ ...value, [`key${n}`]: zeroValue(scalar) });
  };

  return (
    <fieldset className="field list-field" data-path={path}>
      <legend>
        {label}
        {unit && <span className="unit"> [{unit}]</span>}
      </legend>
      <table className="value-table">
        <thead>
          <tr>
            <th scope="col">Key</th>
            <th scope="col">Value</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, item], index) => (
            <tr key={index}>
              <td>
                <KeyInput
                  value={key}
                  label={`${label} key ${index + 1}`}
                  taken={(k) => k !== key && k in value}
                  readOnly={readOnly}
                  onCommit={(next) => rename(key, next)}
                />
              </td>
              <td>
                {isNumericScalar(scalar) ? (
                  <NumberInput
                    aria-label={`${label} ${key}`}
                    value={item as NumericValue}
                    kind={numericKind(scalar)}
                    readOnly={readOnly}
                    onChange={(next) => setValue(key, next)}
                  />
                ) : (
                  <input
                    aria-label={`${label} ${key}`}
                    type="text"
                    value={String(item)}
                    readOnly={readOnly}
                    onChange={(event) => setValue(key, event.target.value)}
                  />
                )}
              </td>
              <td>
                <button
                  type="button"
                  className="icon"
                  aria-label={`Remove ${label} ${key}`}
                  disabled={readOnly}
                  onClick={() => remove(key)}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" disabled={readOnly} onClick={add}>
        Add entry
      </button>
      {violationsAt(violations, path).map((message) => (
        <p key={message} className="field-error" role="alert">
          {message}
        </p>
      ))}
    </fieldset>
  );
}

/** A map key, committed on blur so renaming does not reorder mid-typing. */
function KeyInput({
  value,
  label,
  taken,
  readOnly,
  onCommit,
}: {
  value: string;
  label: string;
  taken: (key: string) => boolean;
  readOnly: boolean;
  onCommit: (key: string) => void;
}) {
  const [text, setText] = useState(value);
  const error = !text
    ? "Enter a key"
    : taken(text)
      ? "Duplicate key"
      : undefined;
  return (
    <>
      <input
        aria-label={label}
        type="text"
        value={text}
        readOnly={readOnly}
        aria-invalid={error ? true : undefined}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          if (error) setText(value);
          else if (text !== value) onCommit(text);
        }}
      />
      {error && (
        <span className="field-warning" role="status">
          {error}
        </span>
      )}
    </>
  );
}
