import {
  create,
  type DescMessage,
  type MessageInitShape,
} from "@bufbuild/protobuf";
import { anyPack, timestampFromDate, type Any } from "@bufbuild/protobuf/wkt";
import {
  EntityDraftSchema,
  EntityKind,
  EntityRefSchema,
  MintedBy,
  VersionMetaSchema,
  type EntityDraft,
  type EntityRef,
  type VersionMeta,
} from "../gen/nebula/core/v1/entity_pb";

// Building blocks of the mock's entity fixtures, built with the generated
// types so they stay schema-correct (docs/UI.md Section 7).

export const at = (iso: string) => timestampFromDate(new Date(iso));

export interface EntityRecord {
  projectId: string;
  draft: EntityDraft;
  /** Newest first. */
  versions: VersionMeta[];
  /** Content of each version by hash, for pinned and latest references. */
  versionContents?: Record<string, Any>;
}

export function pack<Desc extends DescMessage>(
  schema: Desc,
  init: MessageInitShape<Desc>,
) {
  return anyPack(schema, create(schema, init));
}

export function version(
  hash: string,
  iso: string,
  sourceId: string,
  draftRevision: number,
): VersionMeta {
  return create(VersionMetaSchema, {
    hash,
    mintedAt: at(iso),
    mintedBy: MintedBy.RUN_SUBMISSION,
    sourceId,
    draftRevision,
  });
}

export interface RecordInit {
  kind: EntityKind;
  id: string;
  name: string;
  content?: Any;
  revision?: number;
  updatedAt?: string;
  versions?: VersionMeta[];
  versionContents?: Record<string, Any>;
}

export function entity(projectId: string, init: RecordInit): EntityRecord {
  return {
    projectId,
    draft: create(EntityDraftSchema, {
      kind: init.kind,
      id: init.id,
      name: init.name,
      revision: init.revision ?? 1,
      updatedAt: at(init.updatedAt ?? "2026-10-30T08:00:00Z"),
      content: init.content,
    }),
    versions: init.versions ?? [],
    versionContents: init.versionContents,
  };
}

type RefState = "draft" | "latest" | { pinned: string };

export function entityRef(
  kind: EntityKind,
  id: string,
  state: RefState = "draft",
): EntityRef {
  return create(EntityRefSchema, {
    kind,
    id,
    state:
      state === "draft"
        ? { case: "draft", value: {} }
        : state === "latest"
          ? { case: "latest", value: {} }
          : { case: "pinned", value: { versionHash: state.pinned } },
  });
}

export function componentRef(id: string, state: RefState = "draft"): EntityRef {
  return entityRef(EntityKind.COMPONENT, id, state);
}
