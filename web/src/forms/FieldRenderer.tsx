import { ScalarType, type DescField } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import {
  DatasetRefSchema,
  EntityRefSchema,
  type DatasetRef,
  type EntityRef,
} from "../gen/nebula/core/v1/entity_pb";
import { IdRef } from "../gen/nebula/core/v1/options_pb";
import { unknownCoreOptions, uiHintOf } from "../schema/annotations";
import { AnyField } from "./widgets/AnyField";
import { DatasetRefField } from "./widgets/DatasetRefField";
import { IdRefField } from "./widgets/IdRefField";
import { ListField } from "./widgets/ListField";
import { EntityRefField } from "./widgets/EntityRefField";
import { EnumField } from "./widgets/EnumField";
import { MapField } from "./widgets/MapField";
import { MessageGroup } from "./widgets/MessageGroup";
import { RawJsonField } from "./widgets/RawJsonField";
import { ScalarField } from "./widgets/ScalarField";
import { isWellKnown } from "./values";

export interface FieldProps {
  field: DescField;
  value: unknown;
  onChange: (value: unknown) => void;
  /** Proto field path, such as `grid.nr`, matching `FieldViolation.path`. */
  path: string;
}

/** Picks the widget for one field (docs/UI.md Section 5). */
export function FieldRenderer({ field, value, onChange, path }: FieldProps) {
  if (unknownCoreOptions(field).length > 0) {
    return (
      <RawJsonField
        field={field}
        value={value}
        path={path}
        reason="Uses an option from a newer Nebula core; shown read-only."
      />
    );
  }
  switch (field.fieldKind) {
    case "scalar":
      if (
        field.scalar === ScalarType.STRING &&
        uiHintOf(field).idRef !== IdRef.UNSPECIFIED
      ) {
        return (
          <IdRefField
            field={field}
            value={String(value ?? "")}
            onChange={onChange}
            path={path}
          />
        );
      }
      return (
        <ScalarField
          field={field}
          scalar={field.scalar}
          value={value}
          onChange={onChange}
          path={path}
        />
      );
    case "enum":
      return (
        <EnumField
          field={field}
          desc={field.enum}
          value={value as number}
          onChange={onChange}
          path={path}
        />
      );
    case "message":
      if (field.message.typeName === EntityRefSchema.typeName) {
        return (
          <EntityRefField
            field={field}
            value={value as EntityRef | undefined}
            onChange={onChange}
            path={path}
          />
        );
      }
      if (field.message.typeName === DatasetRefSchema.typeName) {
        return (
          <DatasetRefField
            field={field}
            value={value as DatasetRef | undefined}
            onChange={onChange}
            path={path}
          />
        );
      }
      if (field.message.typeName === AnySchema.typeName) {
        return (
          <AnyField
            field={field}
            value={value as Any | undefined}
            onChange={onChange}
            path={path}
          />
        );
      }
      if (isWellKnown(field.message.typeName)) {
        return (
          <RawJsonField
            field={field}
            value={value}
            path={path}
            reason={`${field.message.name} values are not editable here.`}
          />
        );
      }
      return (
        <MessageGroup
          field={field}
          desc={field.message}
          value={value as Record<string, unknown> | undefined}
          onChange={onChange}
          path={path}
        />
      );
    case "list":
      return (
        <ListField
          field={field}
          value={(value as unknown[] | undefined) ?? []}
          onChange={onChange}
          path={path}
        />
      );
    case "map":
      return (
        <MapField
          field={field}
          value={(value as Record<string, unknown> | undefined) ?? {}}
          onChange={onChange}
          path={path}
        />
      );
  }
}
