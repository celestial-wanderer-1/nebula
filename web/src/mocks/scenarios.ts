import { create, ScalarType, type DescField } from "@bufbuild/protobuf";
import { anyPack, anyUnpack, type Any } from "@bufbuild/protobuf/wkt";
import { typeNameOf, unwrapComponent } from "../entities/content";
import { ComponentSchema } from "../gen/nebula/core/v1/component_pb";
import { EntityKind } from "../gen/nebula/core/v1/entity_pb";
import { QueueSummarySchema } from "../gen/nebula/core/v1/queue_pb";
import { mockSchema } from "./fixtures";
import { store } from "./state";

const DOUBLES = new Set([ScalarType.DOUBLE, ScalarType.FLOAT]);
const INTEGERS = new Set([
  ScalarType.INT32,
  ScalarType.UINT32,
  ScalarType.SINT32,
  ScalarType.FIXED32,
  ScalarType.SFIXED32,
]);

/**
 * Bumps the first floating-point field of a component's shape by 0.1, else
 * its first 32-bit integer field by 1, whatever the shape type.
 */
function bumpShape(content: Any): Any {
  const component = unwrapComponent(content);
  const desc = mockSchema.getMessage(typeNameOf(component.shape));
  const shape = component.shape && desc && anyUnpack(component.shape, desc);
  if (!desc || !shape) return content;
  const scalar = (types: Set<ScalarType>) =>
    desc.fields.find(
      (field): field is DescField & { fieldKind: "scalar" } =>
        field.fieldKind === "scalar" && types.has(field.scalar),
    );
  const field = scalar(DOUBLES) ?? scalar(INTEGERS);
  if (!field) return content;
  const values = shape as unknown as Record<string, number>;
  values[field.localName] =
    (values[field.localName] ?? 0) + (DOUBLES.has(field.scalar) ? 0.1 : 1);
  return anyPack(
    ComponentSchema,
    create(ComponentSchema, {
      ...component,
      shape: anyPack(desc, shape),
    }),
  );
}

/**
 * Scripted situations for tests and manual checks (docs/UI.md Section 7).
 * Run phases (P4) add their flows here.
 */
export const scenarios = {
  /** The server reports an API version this UI does not speak. */
  versionMismatch(): void {
    store.apiVersion = "0";
  },

  /**
   * An edit by "another client", for example the SDK: renames the entity,
   * changes a component's shape, bumps the draft revision and publishes the
   * change (D148).
   */
  concurrentEdit(projectId: string, kind: EntityKind, id: string): void {
    const record = store.entity(projectId, kind, id);
    if (!record) throw new Error(`No entity ${projectId}/${kind}/${id}`);
    let content = record.draft.content;
    if (content && kind === EntityKind.COMPONENT) content = bumpShape(content);
    store.updateDraft(record, record.draft.revision, {
      name: `${record.draft.name} (edited elsewhere)`,
      content,
    });
  },

  /** Changes the queue counts, as a submitted or finished Run would. */
  setQueue(queued: number, running: number): void {
    store.setQueue(
      create(QueueSummarySchema, { ...store.queue, queued, running }),
    );
  },
};

/** Applies a scenario named in a mock build's URL fragment. */
export function applyNamedScenario(name: string | null): void {
  if (name === "version-mismatch") scenarios.versionMismatch();
}
