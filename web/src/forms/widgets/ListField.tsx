import {
  ScalarType,
  type DescField,
  type DescMessage,
} from "@bufbuild/protobuf";
import { useId, type ReactNode } from "react";
import { Widget } from "../../gen/nebula/core/v1/options_pb";
import { EntityRefSchema } from "../../gen/nebula/core/v1/entity_pb";
import { fieldLabel, quantityOf, uiHintOf } from "../../schema/annotations";
import { useFormContext } from "../context";
import { newMessage } from "../defaults";
import { MessageFields, type MessageValue } from "../MessageFields";
import { boundsWarning, violationsAt } from "../validate";
import {
  isNumericScalar,
  isWellKnown,
  numericKind,
  zeroValue,
  type NumericValue,
} from "../values";
import { NumberInput } from "./NumberInput";
import { RawJsonField } from "./RawJsonField";

/** `repeated` fields: scalar lists and lists of messages. */
export function ListField({
  field,
  value,
  onChange,
  path,
}: {
  field: DescField & { fieldKind: "list" };
  value: unknown[];
  onChange: (value: unknown[]) => void;
  path: string;
}) {
  if (
    field.listKind === "message" &&
    field.message.typeName !== EntityRefSchema.typeName &&
    !isWellKnown(field.message.typeName)
  ) {
    return (
      <RepeatedMessageField
        field={field}
        desc={field.message}
        value={value as MessageValue[]}
        onChange={onChange}
        path={path}
      />
    );
  }
  if (
    field.listKind === "scalar" &&
    (field.scalar === ScalarType.STRING || isNumericScalar(field.scalar))
  ) {
    return (
      <RepeatedScalarField
        field={field}
        scalar={field.scalar}
        value={value}
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
      reason="Lists of this type are not editable here yet."
    />
  );
}

function ListShell({
  field,
  path,
  warning,
  children,
}: {
  field: DescField;
  path: string;
  warning?: string;
  children: ReactNode;
}) {
  const { violations } = useFormContext();
  const quantity = quantityOf(field);
  const help = uiHintOf(field).help;
  return (
    <fieldset className="field list-field" data-path={path}>
      <legend>
        {fieldLabel(field)}
        {quantity?.unit && <span className="unit"> [{quantity.unit}]</span>}
      </legend>
      {help && <p className="field-help">{help}</p>}
      {children}
      {warning && (
        <p className="field-warning" role="status">
          {warning}
        </p>
      )}
      {violationsAt(violations, path).map((message) => (
        <p key={message} className="field-error" role="alert">
          {message}
        </p>
      ))}
    </fieldset>
  );
}

function moved<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

function RepeatedScalarField({
  field,
  scalar,
  value,
  onChange,
  path,
}: {
  field: DescField;
  scalar: ScalarType;
  value: unknown[];
  onChange: (value: unknown[]) => void;
  path: string;
}) {
  const id = useId();
  const { readOnly } = useFormContext();
  const label = fieldLabel(field);
  const numeric = isNumericScalar(scalar);
  const kind = numericKind(scalar, field);
  const quantity = quantityOf(field);
  const asTable = uiHintOf(field).widget === Widget.TABLE;
  const warning = numeric
    ? value
        .map((item, i) => {
          const w = boundsWarning(quantity, Number(item));
          return w && `${label} ${i + 1}: ${w}`;
        })
        .find(Boolean)
    : undefined;

  const setItem = (index: number, item: unknown) =>
    onChange(value.map((old, i) => (i === index ? item : old)));

  const rows = value.map((item, index) => {
    const itemLabel = `${label} ${index + 1}`;
    const input = numeric ? (
      <NumberInput
        id={`${id}-${index}`}
        aria-label={itemLabel}
        value={item as NumericValue}
        kind={kind}
        readOnly={readOnly}
        onChange={(next) => setItem(index, next)}
      />
    ) : (
      <input
        id={`${id}-${index}`}
        aria-label={itemLabel}
        type="text"
        value={String(item)}
        readOnly={readOnly}
        onChange={(event) => setItem(index, event.target.value)}
      />
    );
    const remove = (
      <button
        type="button"
        className="icon"
        aria-label={`Remove ${itemLabel}`}
        disabled={readOnly}
        onClick={() => onChange(value.filter((_, i) => i !== index))}
      >
        ×
      </button>
    );
    return asTable ? (
      <tr key={index}>
        <th scope="row">{index + 1}</th>
        <td>{input}</td>
        <td>{remove}</td>
      </tr>
    ) : (
      <li key={index}>
        {input}
        {remove}
      </li>
    );
  });

  return (
    <ListShell field={field} path={path} warning={warning}>
      {asTable ? (
        <table className="value-table">
          <tbody>{rows}</tbody>
        </table>
      ) : (
        <ul className="value-list">{rows}</ul>
      )}
      <button
        type="button"
        disabled={readOnly}
        onClick={() => onChange([...value, zeroValue(scalar, field)])}
      >
        Add {label.toLowerCase()}
      </button>
    </ListShell>
  );
}

function RepeatedMessageField({
  field,
  desc,
  value,
  onChange,
  path,
}: {
  field: DescField;
  desc: DescMessage;
  value: MessageValue[];
  onChange: (value: MessageValue[]) => void;
  path: string;
}) {
  const { readOnly } = useFormContext();
  const label = fieldLabel(field);
  return (
    <ListShell field={field} path={path}>
      <ol className="message-list">
        {value.map((item, index) => {
          const itemLabel = `${label} ${index + 1}`;
          return (
            <li
              key={index}
              className="message-list-item"
              aria-label={itemLabel}
            >
              <div className="message-list-header">
                <span>{itemLabel}</span>
                <button
                  type="button"
                  className="icon"
                  aria-label={`Move ${itemLabel} up`}
                  disabled={readOnly || index === 0}
                  onClick={() => onChange(moved(value, index, index - 1))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="icon"
                  aria-label={`Move ${itemLabel} down`}
                  disabled={readOnly || index === value.length - 1}
                  onClick={() => onChange(moved(value, index, index + 1))}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="icon"
                  aria-label={`Remove ${itemLabel}`}
                  disabled={readOnly}
                  onClick={() => onChange(value.filter((_, i) => i !== index))}
                >
                  ×
                </button>
              </div>
              <MessageFields
                desc={desc}
                value={item}
                onChange={(next) =>
                  onChange(value.map((old, i) => (i === index ? next : old)))
                }
                path={`${path}[${index}]`}
              />
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        disabled={readOnly}
        onClick={() => onChange([...value, newMessage(desc) as MessageValue])}
      >
        Add {label.toLowerCase()}
      </button>
    </ListShell>
  );
}
