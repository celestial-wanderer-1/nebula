import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import type { FieldViolation } from "../gen/nebula/core/v1/errors_pb";
import { FormContext } from "./context";
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
}: {
  schema: Desc;
  value: MessageShape<Desc>;
  onChange: (value: MessageShape<Desc>) => void;
  violations?: readonly FieldViolation[];
  readOnly?: boolean;
  projectId?: string;
}) {
  return (
    <FormContext.Provider value={{ projectId, readOnly, violations }}>
      <div className="config-form" data-message={schema.typeName}>
        <MessageFields
          desc={schema}
          value={value as unknown as MessageValue}
          onChange={(next) => onChange(next as unknown as MessageShape<Desc>)}
          path=""
        />
      </div>
    </FormContext.Provider>
  );
}
