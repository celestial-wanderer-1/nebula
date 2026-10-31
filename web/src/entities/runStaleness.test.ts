import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import {
  EntityKind,
  EntitySummarySchema,
} from "../gen/nebula/core/v1/entity_pb";
import { RunSchema } from "../gen/nebula/core/v1/run_pb";
import { staleInputs } from "./runStaleness";

describe("staleInputs (A§4.4, D101)", () => {
  it("lists pinned inputs whose head moved, ignoring drafts", () => {
    const run = create(RunSchema, {
      provenance: {
        inputs: [
          { kind: EntityKind.GEOMETRY, id: "g", versionHash: "v1" },
          { kind: EntityKind.SCENARIO, id: "s", versionHash: "s1" },
          { kind: EntityKind.REGION, id: "r", versionHash: "r1" },
        ],
      },
    });
    const summaries = [
      create(EntitySummarySchema, {
        kind: EntityKind.GEOMETRY,
        id: "g",
        headHash: "v2",
        revision: 9,
      }),
      create(EntitySummarySchema, {
        kind: EntityKind.SCENARIO,
        id: "s",
        headHash: "s1",
        revision: 12,
      }),
      // Never versioned since: no head.
      create(EntitySummarySchema, {
        kind: EntityKind.REGION,
        id: "r",
        headHash: "",
      }),
    ];
    expect(staleInputs(run, summaries).map((i) => i.id)).toEqual(["g"]);
  });
});
