import { create } from "@bufbuild/protobuf";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { queryKeys } from "../api/queryKeys";
import {
  ChangeType,
  EntityChangeSchema,
  EntityDraftSchema,
  EntityKind,
  ListEntitiesResponseSchema,
} from "../gen/nebula/core/v1/entity_pb";
import { applyEntityChange } from "./channels";

const kind = EntityKind.GEOMETRY;
const draftKey = queryKeys.draft("p", kind, "g");
const versionsKey = queryKeys.versions("p", kind, "g");
const listKey = queryKeys.entities("p", kind);

function setup(heldRevision: number, listedRevision = heldRevision) {
  const client = new QueryClient();
  client.setQueryData(
    draftKey,
    create(EntityDraftSchema, { revision: heldRevision }),
  );
  client.setQueryData(versionsKey, {});
  client.setQueryData(
    listKey,
    create(ListEntitiesResponseSchema, {
      entities: [{ kind, id: "g", revision: listedRevision }],
    }),
  );
  const stale = (key: readonly unknown[]) =>
    client.getQueryState(key)?.isInvalidated ?? false;
  const change = (type: ChangeType, revision: number) =>
    applyEntityChange(
      client,
      create(EntityChangeSchema, {
        projectId: "p",
        kind,
        id: "g",
        change: type,
        revision,
      }),
    );
  return { client, stale, change };
}

describe("applyEntityChange (D148)", () => {
  it("refetches a draft only for a newer revision", () => {
    const { stale, change } = setup(5);
    change(ChangeType.DRAFT_UPDATED, 5); // our own save, echoed back
    expect(stale(draftKey)).toBe(false);
    expect(stale(listKey)).toBe(false);
    change(ChangeType.DRAFT_UPDATED, 6); // another client's save
    expect(stale(draftKey)).toBe(true);
    expect(stale(listKey)).toBe(true);
  });

  it("refetches a list that lags the held draft", () => {
    // A 409 brought revision 6 into the draft cache before its event.
    const { stale, change } = setup(6, 5);
    change(ChangeType.DRAFT_UPDATED, 6);
    expect(stale(draftKey)).toBe(false);
    expect(stale(listKey)).toBe(true);
  });

  it("refetches versions when one is minted", () => {
    const { stale, change } = setup(5);
    change(ChangeType.VERSION_MINTED, 5);
    expect(stale(versionsKey)).toBe(true);
    expect(stale(draftKey)).toBe(false);
  });

  it("drops a deleted entity and refreshes its list", () => {
    const { client, stale, change } = setup(5);
    change(ChangeType.DELETED, 5);
    expect(client.getQueryData(draftKey)).toBeUndefined();
    expect(stale(listKey)).toBe(true);
  });
});
