import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import type { FieldViolation } from "../gen/nebula/core/v1/errors_pb";
import { FormContext, type IdChoices } from "./context";
import { MessageFields, type MessageValue } from "./MessageFields";

/**
 * A config form generated from a message descriptor (D87, A§13.5): core and
 * plugin messages alike. Edits produce new message objects; the caller owns
 * the value. `violations` are the server's validation errors by field path.
 */
export function ConfigForm<Desc extends DescMessage>({
  schema,
  value,
  onChange,
  violations = [],
  readOnly = false,
  projectId,
  idChoices,
  fields,
}: {
  schema: Desc;
  value: MessageShape<Desc>;
  onChange: (value: MessageShape<Desc>) => void;
  violations?: readonly FieldViolation[];
  readOnly?: boolean;
  projectId?: string;
  /** IDs offered by ID fields (`ui.id_ref`), from the editing context. */
  idChoices?: IdChoices;
  /** Top-level fields to render, for editors that lay out the rest. */
  fields?: readonly string[];
}) {
  return (
    <FormContext.Provider
      value={{ projectId, readOnly, violations, idChoices }}
    >
      <div className="config-form" data-message={schema.typeName}>
        <MessageFields
          desc={schema}
          value={value as unknown as MessageValue}
          onChange={(next) => onChange(next as unknown as MessageShape<Desc>)}
          path=""
          only={fields}
        />
      </div>
    </FormContext.Provider>
  );
}
