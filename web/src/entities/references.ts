import { create } from "@bufbuild/protobuf";
import {
  EntityRefSchema,
  type EntityKind,
  type EntityRef,
} from "../gen/nebula/core/v1/entity_pb";

/**
 * The state a new reference starts in (A§4.2, D107): pinned to the head
 * version when the entity has one, else the draft. `latest` is never a
 * default; it is an opt-in.
 */
export function defaultReference(
  kind: EntityKind,
  id: string,
  headHash: string,
): EntityRef {
  return create(EntityRefSchema, {
    kind,
    id,
    state: headHash
      ? { case: "pinned", value: { versionHash: headHash } }
      : { case: "draft", value: {} },
  });
}

/** Whether a pinned reference trails the entity's head version (D101). */
export function isStale(ref: EntityRef | undefined, headHash: string): boolean {
  return (
    ref?.state.case === "pinned" &&
    headHash !== "" &&
    ref.state.value.versionHash !== headHash
  );
}

export function shortHash(hash: string): string {
  const digest = hash.includes(":") ? hash.slice(hash.indexOf(":") + 1) : hash;
  return digest.slice(0, 10);
}
