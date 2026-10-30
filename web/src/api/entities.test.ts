import { create } from "@bufbuild/protobuf";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { EntityDraftSchema, EntityKind } from "../gen/nebula/core/v1/entity_pb";
import { DraftConflictError } from "./errors";
import { connect } from "../test/render";
import { fetchDraft, putDraftIfNewer, updateDraft } from "./entities";
import { queryKeys } from "./queryKeys";

const draft = (revision: number, name = `r${revision}`) =>
  create(EntityDraftSchema, { id: "geo-main", revision, name });

describe("putDraftIfNewer", () => {
  it("drops responses older than the held revision (D148)", () => {
    const client = new QueryClient();
    const key = queryKeys.draft("p", EntityKind.GEOMETRY, "geo-main");
    putDraftIfNewer(client, key, draft(5));
    putDraftIfNewer(client, key, draft(4));
    expect(client.getQueryData(key)).toMatchObject({ revision: 5 });
    putDraftIfNewer(client, key, draft(6));
    expect(client.getQueryData(key)).toMatchObject({ revision: 6 });
  });
});

describe("updateDraft", () => {
  it("sends the base revision and gets the next one back", async () => {
    connect();
    const held = await fetchDraft(
      "p-baseline",
      EntityKind.GEOMETRY,
      "geo-main",
    );
    const saved = await updateDraft(
      "p-baseline",
      EntityKind.GEOMETRY,
      "geo-main",
      held.revision,
      { name: "Renamed" },
    );
    expect(saved.revision).toBe(held.revision + 1);
    expect(saved.name).toBe("Renamed");
  });

  it("fails with the server's draft when the revision is stale", async () => {
    connect();
    const held = await fetchDraft(
      "p-baseline",
      EntityKind.GEOMETRY,
      "geo-main",
    );
    const error = await updateDraft(
      "p-baseline",
      EntityKind.GEOMETRY,
      "geo-main",
      held.revision - 1,
      { name: "Late" },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DraftConflictError);
    expect((error as DraftConflictError).current.revision).toBe(held.revision);
  });
});
