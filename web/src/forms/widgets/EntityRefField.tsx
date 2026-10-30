import type { DescField } from "@bufbuild/protobuf";
import { EntityKind, type EntityRef } from "../../gen/nebula/core/v1/entity_pb";
import { ReferencePicker } from "../../entities/ReferencePicker";
import { fieldLabel, uiHintOf } from "../../schema/annotations";
import { useFormContext } from "../context";
import { violationsAt } from "../validate";
import { RawJsonField } from "./RawJsonField";

/** An `EntityRef` field, edited with the shared picker (D107). */
export function EntityRefField({
  field,
  value,
  onChange,
  path,
}: {
  field: DescField;
  value: EntityRef | undefined;
  onChange: (value: EntityRef) => void;
  path: string;
}) {
  const { projectId, readOnly, violations } = useFormContext();
  const kind = uiHintOf(field).refKind;
  if (kind === EntityKind.UNSPECIFIED || !projectId) {
    return (
      <RawJsonField
        field={field}
        value={value}
        path={path}
        reason={
          projectId
            ? "The schema does not say which entity kind this references (ui.ref_kind)."
            : "References can be picked inside a project."
        }
      />
    );
  }
  return (
    <div className="field" data-path={path}>
      <ReferencePicker
        projectId={projectId}
        kind={kind}
        value={value}
        onChange={onChange}
        label={fieldLabel(field)}
        disabled={readOnly}
      />
      {violationsAt(violations, path).map((message) => (
        <p key={message} className="field-error" role="alert">
          {message}
        </p>
      ))}
    </div>
  );
}
