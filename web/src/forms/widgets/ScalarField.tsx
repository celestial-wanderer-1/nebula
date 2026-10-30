import * as Switch from "@radix-ui/react-switch";
import { ScalarType, type DescField } from "@bufbuild/protobuf";
import { useId, useState } from "react";
import { Widget } from "../../gen/nebula/core/v1/options_pb";
import { fieldLabel, quantityOf, uiHintOf } from "../../schema/annotations";
import { useFormContext } from "../context";
import { useFieldA11y } from "../a11y";
import { FieldShell } from "../FieldShell";
import { boundsHint, boundsWarning } from "../validate";
import { isNumericScalar, numericKind, type NumericValue } from "../values";
import { NumberInput } from "./NumberInput";
import { RawJsonField } from "./RawJsonField";

/** Number, bool and string fields (docs/UI.md Section 5). */
export function ScalarField({
  field,
  scalar,
  value,
  onChange,
  path,
}: {
  field: DescField;
  scalar: ScalarType;
  value: unknown;
  onChange: (value: unknown) => void;
  path: string;
}) {
  if (scalar === ScalarType.BOOL) {
    return (
      <BoolField
        field={field}
        value={Boolean(value)}
        onChange={onChange}
        path={path}
      />
    );
  }
  if (scalar === ScalarType.STRING) {
    return (
      <TextField
        field={field}
        value={String(value ?? "")}
        onChange={onChange}
        path={path}
      />
    );
  }
  if (isNumericScalar(scalar)) {
    return (
      <NumberField
        field={field}
        scalar={scalar}
        value={value as NumericValue}
        onChange={onChange}
        path={path}
      />
    );
  }
  return (
    <RawJsonField
      field={field}
      value={value}
      path={path}
      reason="Binary data is not editable here."
    />
  );
}

function NumberField({
  field,
  scalar,
  value,
  onChange,
  path,
}: {
  field: DescField;
  scalar: ScalarType;
  value: NumericValue;
  onChange: (value: NumericValue) => void;
  path: string;
}) {
  const id = useId();
  const { readOnly } = useFormContext();
  const hint = uiHintOf(field);
  const quantity = quantityOf(field);
  const kind = numericKind(scalar, field);
  const [parseError, setParseError] = useState<string>();
  const range = boundsHint(quantity);
  const a11y = useFieldA11y(id, path, Boolean(hint.help || range));
  const slider =
    hint.widget === Widget.SLIDER &&
    quantity?.min !== undefined &&
    quantity.max !== undefined &&
    !kind.long;
  return (
    <FieldShell
      id={id}
      path={path}
      label={fieldLabel(field)}
      unit={quantity?.unit}
      designVariable={quantity?.designVariable}
      help={hint.help}
      hint={range}
      warning={parseError ?? boundsWarning(quantity, Number(value))}
    >
      <div className="number-control">
        <NumberInput
          id={id}
          value={value}
          kind={kind}
          onChange={onChange}
          onParseError={setParseError}
          readOnly={readOnly}
          {...a11y}
        />
        {slider && (
          <input
            type="range"
            aria-label={`${fieldLabel(field)} slider`}
            min={quantity.min}
            max={quantity.max}
            step={kind.integer ? 1 : "any"}
            value={Number(value)}
            disabled={readOnly}
            onChange={(event) => onChange(Number(event.target.value))}
          />
        )}
      </div>
    </FieldShell>
  );
}

function BoolField({
  field,
  value,
  onChange,
  path,
}: {
  field: DescField;
  value: boolean;
  onChange: (value: boolean) => void;
  path: string;
}) {
  const id = useId();
  const { readOnly } = useFormContext();
  const hint = uiHintOf(field);
  const a11y = useFieldA11y(id, path, Boolean(hint.help));
  return (
    <FieldShell id={id} path={path} label={fieldLabel(field)} help={hint.help}>
      <Switch.Root
        id={id}
        className="switch"
        checked={value}
        disabled={readOnly}
        onCheckedChange={onChange}
        {...a11y}
      >
        <Switch.Thumb className="switch-thumb" />
      </Switch.Root>
    </FieldShell>
  );
}

function TextField({
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
  const hint = uiHintOf(field);
  const a11y = useFieldA11y(id, path, Boolean(hint.help));
  return (
    <FieldShell id={id} path={path} label={fieldLabel(field)} help={hint.help}>
      {hint.widget === Widget.TEXTAREA ? (
        <textarea
          id={id}
          value={value}
          readOnly={readOnly}
          onChange={(event) => onChange(event.target.value)}
          {...a11y}
        />
      ) : (
        <input
          id={id}
          type="text"
          value={value}
          readOnly={readOnly}
          onChange={(event) => onChange(event.target.value)}
          {...a11y}
        />
      )}
    </FieldShell>
  );
}
