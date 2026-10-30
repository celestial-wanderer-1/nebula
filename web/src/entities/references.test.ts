import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { EntityKind, EntityRefSchema } from "../gen/nebula/core/v1/entity_pb";
import { defaultReference, isStale, shortHash } from "./references";

describe("defaultReference (D107)", () => {
  it("pins the head version when the entity has one", () => {
    expect(
      defaultReference(EntityKind.GEOMETRY, "g", "sha256:abc").state,
    ).toEqual({
      case: "pinned",
      value: expect.objectContaining({ versionHash: "sha256:abc" }),
    });
  });

  it("uses the draft for a never-versioned entity, never latest", () => {
    expect(defaultReference(EntityKind.GEOMETRY, "g", "").state.case).toBe(
      "draft",
    );
  });
});

describe("isStale", () => {
  const pinned = (hash: string) =>
    create(EntityRefSchema, {
      state: { case: "pinned", value: { versionHash: hash } },
    });

  it("flags a pinned reference behind the head", () => {
    expect(isStale(pinned("v1"), "v2")).toBe(true);
    expect(isStale(pinned("v2"), "v2")).toBe(false);
  });

  it("never flags latest or draft references", () => {
    const latest = create(EntityRefSchema, {
      state: { case: "latest", value: {} },
    });
    expect(isStale(latest, "v2")).toBe(false);
    expect(isStale(undefined, "v2")).toBe(false);
  });
});

it("shortens content hashes for display", () => {
  expect(shortHash("sha256:0123456789abcdef")).toBe("0123456789");
});
