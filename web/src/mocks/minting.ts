import { create, toBinary, type Registry } from "@bufbuild/protobuf";
import { AnySchema, timestampFromMs, type Any } from "@bufbuild/protobuf/wkt";
import {
  ChangeType,
  EntityKind,
  MintedBy,
  VersionMetaSchema,
  type EntityRef,
} from "../gen/nebula/core/v1/entity_pb";
import {
  DraftToMintSchema,
  PinnedInputSchema,
  type DraftToMint,
  type PinnedInput,
} from "../gen/nebula/core/v1/run_pb";
import { contentHash } from "./hash";
import type { EntityRecord } from "./records";
import { mapRefs, pinnedRef } from "./refs";

/** What minting needs from the store. */
export interface MintContext {
  entity: (kind: EntityKind, id: string) => EntityRecord | undefined;
  registry: Registry;
  now: () => number;
  publish: (record: EntityRecord, change: ChangeType, hash: string) => void;
}

export interface MintResult {
  /** The root reference, pinned. */
  ref: EntityRef;
  /** Its pinned content. */
  content: Any | undefined;
  /** Drafts minted (or reusing a version), dependencies first. */
  minted: DraftToMint[];
  /** Every version the root reaches, itself excluded (A§4.3). */
  inputs: PinnedInput[];
}

/** A version hash: of the kind and the pinned content (D26, D152). */
export function versionHash(
  kind: EntityKind,
  content: Any | undefined,
): string {
  return contentHash(
    EntityKind[kind],
    content ? toBinary(AnySchema, content) : new Uint8Array(),
  );
}

/**
 * Mints every draft an entity reaches into content-hashed versions, in one
 * pass, dependencies first (A§4.2, D56, D110): `draft` and `latest`
 * references become `pinned` in the minted versions. Identical content
 * reuses its version. With `commit` false nothing is written: a dry run
 * reports what a submission would mint.
 */
export function mintReachable(
  context: MintContext,
  root: EntityRef,
  { commit, sourceId }: { commit: boolean; sourceId: string },
): MintResult {
  const minted: DraftToMint[] = [];
  const inputs = new Map<string, PinnedInput>();
  const done = new Map<string, EntityRef>();
  let rootContent: Any | undefined;

  const visit = (ref: EntityRef, isRoot: boolean): EntityRef => {
    const key = `${ref.kind}/${ref.id}`;
    const seen = done.get(key);
    if (seen && ref.state.case !== "pinned") return seen;
    const record = context.entity(ref.kind, ref.id);
    if (!record) return ref;
    const note = (hash: string) => {
      if (!isRoot) {
        inputs.set(
          `${key}@${hash}`,
          create(PinnedInputSchema, {
            kind: ref.kind,
            id: ref.id,
            name: record.draft.name,
            versionHash: hash,
          }),
        );
      }
    };
    if (ref.state.case === "pinned") {
      const hash = ref.state.value.versionHash;
      note(hash);
      if (isRoot) rootContent = record.versionContents?.[hash];
      return ref;
    }
    const head = record.versions[0]?.hash;
    if (ref.state.case === "latest" && head) {
      note(head);
      if (isRoot) rootContent = record.versionContents?.[head];
      const pinned = pinnedRef(ref, head);
      done.set(key, pinned);
      return pinned;
    }
    // A draft (or `latest` of a never-versioned entity) is minted.
    const content =
      record.draft.content &&
      mapRefs(record.draft.content, context.registry, (inner) =>
        visit(inner, false),
      );
    // Identical content is the same version, whatever hash it was given.
    const bytes = content ? toBinary(AnySchema, content) : undefined;
    const existing = record.versions.find((v) => {
      const held = record.versionContents?.[v.hash];
      return held && bytes && sameBytes(toBinary(AnySchema, held), bytes);
    });
    const hash = existing?.hash ?? versionHash(ref.kind, content);
    minted.push(
      create(DraftToMintSchema, {
        kind: ref.kind,
        id: ref.id,
        name: record.draft.name,
        revision: record.draft.revision,
        versionHash: hash,
        reusesVersion: Boolean(existing),
      }),
    );
    if (commit) {
      if (existing) {
        // The draft equals an earlier version: the head moves back to it.
        record.versions = [
          existing,
          ...record.versions.filter((v) => v !== existing),
        ];
      } else {
        record.versions = [
          create(VersionMetaSchema, {
            hash,
            mintedAt: timestampFromMs(context.now()),
            mintedBy: MintedBy.RUN_SUBMISSION,
            sourceId,
            draftRevision: record.draft.revision,
          }),
          ...record.versions,
        ];
        record.versionContents = {
          ...record.versionContents,
          ...(content ? { [hash]: content } : {}),
        };
      }
      context.publish(record, ChangeType.VERSION_MINTED, hash);
    }
    note(hash);
    if (isRoot) rootContent = content;
    const pinned = pinnedRef(ref, hash);
    done.set(key, pinned);
    return pinned;
  };

  const ref = visit(root, true);
  return { ref, content: rootContent, minted, inputs: [...inputs.values()] };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}
