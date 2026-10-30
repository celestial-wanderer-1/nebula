import type { DescEnum, DescField } from "@bufbuild/protobuf";
import { useId } from "react";
import { Widget } from "../../gen/nebula/core/v1/options_pb";
import { enumValueLabel, fieldLabel, uiHintOf } from "../../schema/annotations";
import { useFormContext } from "../context";
import { useFieldA11y } from "../a11y";
import { FieldShell } from "../FieldShell";

/** Values a user may choose: all but the `*_UNSPECIFIED` zero value. */
function choices(desc: DescEnum) {
  return desc.values.filter(
    (value) => !(value.number === 0 && value.name.endsWith("_UNSPECIFIED")),
  );
}

export function EnumField({
  field,
  desc,
  value,
  onChange,
  path,
}: {
  field: DescField;
  desc: DescEnum;
  value: number;
  onChange: (value: number) => void;
  path: string;
}) {
  const id = useId();
  const { readOnly } = useFormContext();
  const hint = uiHintOf(field);
  const a11y = useFieldA11y(id, path, Boolean(hint.help));
  const options = choices(desc);
  const label = fieldLabel(field);

  if (hint.widget === Widget.RADIO) {
    return (
      <FieldShell id={id} path={path} label={label} help={hint.help}>
        <div
          id={id}
          role="radiogroup"
          aria-label={label}
          className="radio-group"
          {...a11y}
        >
          {options.map((option) => (
            <label key={option.number}>
              <input
                type="radio"
                name={id}
                checked={value === option.number}
                disabled={readOnly}
                onChange={() => onChange(option.number)}
              />
              {enumValueLabel(option)}
            </label>
          ))}
        </div>
      </FieldShell>
    );
  }

  const known = desc.values.some((option) => option.number === value);
  return (
    <FieldShell id={id} path={path} label={label} help={hint.help}>
      <select
        id={id}
        value={value}
        disabled={readOnly}
        onChange={(event) => onChange(Number(event.target.value))}
        {...a11y}
      >
        {!options.some((option) => option.number === value) && (
          <option value={value} disabled>
            {known ? "Choose…" : `Unknown value ${value}`}
          </option>
        )}
        {options.map((option) => (
          <option key={option.number} value={option.number}>
            {enumValueLabel(option)}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}
