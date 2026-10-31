import type { DescField } from "@bufbuild/protobuf";
import { useId } from "react";
import { IdRef } from "../../gen/nebula/core/v1/options_pb";
import { fieldLabel, uiHintOf } from "../../schema/annotations";
import { useFieldA11y } from "../a11y";
import { useFormContext, type IdChoice } from "../context";
import { FieldShell } from "../FieldShell";
import { violationsAt } from "../validate";

const KIND_LABELS: Readonly<Record<IdRef, string>> = {
  [IdRef.UNSPECIFIED]: "item",
  [IdRef.COMPONENT]: "component",
  [IdRef.CIRCUIT]: "circuit",
  [IdRef.ELEMENT]: "element",
  [IdRef.SUPPLY]: "power supply",
};

function useChoices(field: DescField): {
  kind: IdRef;
  choices: readonly IdChoice[];
} {
  const { idChoices } = useFormContext();
  const kind = uiHintOf(field).idRef;
  return { kind, choices: idChoices?.[kind] ?? [] };
}

/**
 * A string holding a stable ID (`ui.id_ref`), picked from the IDs the
 * editing context offers, such as the circuits of the referenced geometry
 * (D114). An ID that is not offered stays selected and is flagged.
 */
export function IdRefField({
  field,
  value,
  onChange,
  path,
}: {
  field: DescField;
  value: string;
  onChange: (value: string) => void;
  path: string;
}) {
  const id = useId();
  const { readOnly } = useFormContext();
  const { kind, choices } = useChoices(field);
  const hint = uiHintOf(field);
  const a11y = useFieldA11y(id, path, Boolean(hint.help));
  const known = !value || choices.some((choice) => choice.id === value);
  return (
    <FieldShell
      id={id}
      path={path}
      label={fieldLabel(field)}
      help={hint.help}
      warning={known ? undefined : `No ${KIND_LABELS[kind]} “${value}” here`}
    >
      <select
        id={id}
        value={value}
        disabled={readOnly}
        onChange={(event) => onChange(event.target.value)}
        {...a11y}
      >
        <option value="">None</option>
        {!known && <option value={value}>{value} (unknown)</option>}
        {choices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

/** A repeated ID field: a checkbox per offered ID. */
export function IdRefListField({
  field,
  value,
  onChange,
  path,
}: {
  field: DescField;
  value: readonly string[];
  onChange: (value: string[]) => void;
  path: string;
}) {
  const { readOnly, violations } = useFormContext();
  const { kind, choices } = useChoices(field);
  const unknown = value.filter((v) => !choices.some((c) => c.id === v));
  const toggle = (id: string, on: boolean) =>
    onChange(on ? [...value, id] : value.filter((v) => v !== id));
  const errors = violationsAt(violations, path);
  return (
    <fieldset className="field list-field" data-path={path}>
      <legend>{fieldLabel(field)}</legend>
      {choices.length === 0 && (
        <p className="muted small">No {KIND_LABELS[kind]}s to choose from.</p>
      )}
      <ul className="value-list">
        {choices.map((choice) => (
          <li key={choice.id}>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={value.includes(choice.id)}
                disabled={readOnly}
                onChange={(event) => toggle(choice.id, event.target.checked)}
              />
              {choice.label}
            </label>
          </li>
        ))}
        {unknown.map((id) => (
          <li key={id}>
            <label className="checkbox">
              <input
                type="checkbox"
                checked
                disabled={readOnly}
                onChange={() => toggle(id, false)}
              />
              {id} (unknown)
            </label>
          </li>
        ))}
      </ul>
      {unknown.length > 0 && (
        <p className="field-warning" role="status">
          Not found here: {unknown.join(", ")}
        </p>
      )}
      {errors.map((message) => (
        <p key={message} className="field-error" role="alert">
          {message}
        </p>
      ))}
    </fieldset>
  );
}
