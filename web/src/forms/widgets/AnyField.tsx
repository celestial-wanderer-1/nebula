import type { DescField, DescMessage } from "@bufbuild/protobuf";
import { anyPack, anyUnpack, type Any } from "@bufbuild/protobuf/wkt";
import { useId } from "react";
import { typeNameOf } from "../../entities/content";
import { fieldLabel, messageLabel, uiHintOf } from "../../schema/annotations";
import { useSchema } from "../../schema/context";
import { useFormContext } from "../context";
import { newMessage } from "../defaults";
import { MessageFields, type MessageValue } from "../MessageFields";
import { violationsAt } from "../validate";
import { RawJsonField } from "./RawJsonField";

/** Messages an Any field accepts: those with its `ui.any_role`. */
function useCandidates(field: DescField): DescMessage[] {
  const schema = useSchema();
  const role = uiHintOf(field).anyRole;
  return role ? schema.messagesWithRole(role) : [];
}

/**
 * One `google.protobuf.Any` value: a type picked from the messages with the
 * field's role (core or plugin), then that message's generated form. A value
 * of a type this build cannot resolve is shown read-only, never dropped.
 */
function AnyValue({
  field,
  candidates,
  value,
  onChange,
  path,
  label,
}: {
  field: DescField;
  candidates: readonly DescMessage[];
  value: Any | undefined;
  onChange: (value: Any | undefined) => void;
  path: string;
  label: string;
}) {
  const id = useId();
  const schema = useSchema();
  const { readOnly } = useFormContext();
  const typeName = typeNameOf(value);
  const desc = typeName ? schema.getMessage(typeName) : undefined;
  const message = value && desc ? anyUnpack(value, desc) : undefined;
  if (typeName && !message) {
    return (
      <RawJsonField
        field={field}
        value={value}
        path={path}
        reason={`Type ${typeName} is not known to this build; shown read-only.`}
      />
    );
  }
  return (
    <div className="any-value" data-path={path}>
      <div className="field">
        <label htmlFor={id}>{label} type</label>
        <select
          id={id}
          value={typeName}
          disabled={readOnly}
          onChange={(event) => {
            const next = candidates.find(
              (c) => c.typeName === event.target.value,
            );
            onChange(next ? anyPack(next, newMessage(next)) : undefined);
          }}
        >
          <option value="">None</option>
          {candidates.map((candidate) => (
            <option key={candidate.typeName} value={candidate.typeName}>
              {messageLabel(candidate)}
            </option>
          ))}
        </select>
      </div>
      {desc && message && (
        <MessageFields
          desc={desc}
          value={message as unknown as MessageValue}
          onChange={(next) => onChange(anyPack(desc, next as never))}
          path={path}
        />
      )}
    </div>
  );
}

/** A singular Any field restricted to a role (`ui.any_role`). */
export function AnyField({
  field,
  value,
  onChange,
  path,
}: {
  field: DescField;
  value: Any | undefined;
  onChange: (value: Any | undefined) => void;
  path: string;
}) {
  const candidates = useCandidates(field);
  if (candidates.length === 0) {
    return (
      <RawJsonField
        field={field}
        value={value}
        path={path}
        reason="No message type is declared for this field."
      />
    );
  }
  return (
    <fieldset className="field any-field" data-path={path}>
      <legend>{fieldLabel(field)}</legend>
      <AnyValue
        field={field}
        candidates={candidates}
        value={value}
        onChange={onChange}
        path={path}
        label={fieldLabel(field)}
      />
    </fieldset>
  );
}

/** A repeated Any field restricted to a role: add, edit and remove items. */
export function AnyListField({
  field,
  value,
  onChange,
  path,
}: {
  field: DescField;
  value: readonly Any[];
  onChange: (value: Any[]) => void;
  path: string;
}) {
  const id = useId();
  const candidates = useCandidates(field);
  const { readOnly, violations } = useFormContext();
  const label = fieldLabel(field);
  if (candidates.length === 0) {
    return (
      <RawJsonField
        field={field}
        value={value}
        path={path}
        reason="No message type is declared for this field."
      />
    );
  }
  return (
    <fieldset className="field list-field any-field" data-path={path}>
      <legend>{label}</legend>
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
                  aria-label={`Remove ${itemLabel}`}
                  disabled={readOnly}
                  onClick={() => onChange(value.filter((_, i) => i !== index))}
                >
                  ×
                </button>
              </div>
              <AnyValue
                field={field}
                candidates={candidates}
                value={item}
                label={itemLabel}
                path={`${path}[${index}]`}
                onChange={(next) =>
                  onChange(
                    next
                      ? value.map((old, i) => (i === index ? next : old))
                      : value.filter((_, i) => i !== index),
                  )
                }
              />
            </li>
          );
        })}
      </ol>
      <div className="add-any">
        <label htmlFor={id}>Add {label.toLowerCase()}</label>
        <select
          id={id}
          value=""
          disabled={readOnly}
          onChange={(event) => {
            const desc = candidates.find(
              (c) => c.typeName === event.target.value,
            );
            if (desc) onChange([...value, anyPack(desc, newMessage(desc))]);
          }}
        >
          <option value="" disabled>
            Choose a type…
          </option>
          {candidates.map((candidate) => (
            <option key={candidate.typeName} value={candidate.typeName}>
              {messageLabel(candidate)}
            </option>
          ))}
        </select>
      </div>
      {violationsAt(violations, path).map((message) => (
        <p key={message} className="field-error" role="alert">
          {message}
        </p>
      ))}
    </fieldset>
  );
}
