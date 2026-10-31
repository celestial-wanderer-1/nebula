import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import {
  EntityDraftSchema,
  EntityKind,
  EntityRefSchema,
  EntitySummarySchema,
  type EntityRef,
} from "../gen/nebula/core/v1/entity_pb";
import {
  ComponentTessellationSchema,
  GeometryTessellationSchema,
  MeshSchema,
  type ComponentTessellation,
} from "../gen/nebula/core/v1/geometry_pb";
import { ValidationIssueSchema } from "../gen/nebula/core/v1/project_pb";
import { mergeTessellation, tessellationFingerprint } from "./geometry";

const build = (
  componentId: string,
  revision: number,
  versionHash = "",
): ComponentTessellation =>
  create(ComponentTessellationSchema, { componentId, revision, versionHash });

const withMesh = (component: ComponentTessellation): ComponentTessellation => ({
  ...component,
  mesh: create(MeshSchema),
});

const tessellation = (...components: ComponentTessellation[]) =>
  create(GeometryTessellationSchema, { components });

const ids = (merged: ReturnType<typeof mergeTessellation>) =>
  merged.components.map((c) => [c.componentId, c.revision, c.versionHash]);

describe("mergeTessellation", () => {
  it("takes the reply when nothing is held", () => {
    const incoming = tessellation(build("a", 2));
    expect(mergeTessellation(undefined, incoming)).toBe(incoming);
  });

  it("never replaces a draft mesh with a lower revision (D148)", () => {
    const held = tessellation(build("a", 5), build("b", 3));
    const merged = mergeTessellation(
      held,
      tessellation(build("a", 4), build("b", 4)),
    );
    expect(ids(merged)).toEqual([
      ["a", 5, ""],
      ["b", 4, ""],
    ]);
  });

  it("replaces version builds whatever their revision", () => {
    const held = tessellation(build("a", 5), build("b", 0, "sha256:old"));
    const merged = mergeTessellation(
      held,
      tessellation(build("a", 0, "sha256:pin"), build("b", 0, "sha256:new")),
    );
    expect(ids(merged)).toEqual([
      ["a", 0, "sha256:pin"],
      ["b", 0, "sha256:new"],
    ]);
  });

  it("takes a failed build over a held draft mesh, so its error shows", () => {
    const held = tessellation(withMesh(build("a", 5)));
    const failed = create(ComponentTessellationSchema, {
      componentId: "a",
      error: "The component has no version yet",
    });
    const merged = mergeTessellation(held, tessellation(failed));
    expect(merged.components[0]).toBe(failed);
  });

  it("keeps the held object of an unchanged build", () => {
    const a = withMesh(build("a", 3));
    const b = withMesh(build("b", 0, "sha256:b"));
    const merged = mergeTessellation(
      tessellation(a, b),
      tessellation(
        withMesh(build("a", 3)),
        withMesh(build("b", 0, "sha256:b")),
      ),
    );
    expect(merged.components[0]).toBe(a);
    expect(merged.components[1]).toBe(b);
  });

  it("drops components the reply no longer has; issues come from it", () => {
    const held = tessellation(build("a", 1), build("b", 1));
    held.issues = [create(ValidationIssueSchema, { message: "stale" })];
    const incoming = tessellation(build("b", 2));
    const merged = mergeTessellation(held, incoming);
    expect(ids(merged)).toEqual([["b", 2, ""]]);
    expect(merged.issues).toEqual([]);
  });
});

describe("tessellationFingerprint", () => {
  const geometry = (revision: number) =>
    create(EntityDraftSchema, { id: "geo", revision });
  const summary = (id: string, revision: number, headHash = "") =>
    create(EntitySummarySchema, {
      kind: EntityKind.COMPONENT,
      id,
      revision,
      headHash,
    });
  const ref = (
    id: string,
    state: EntityRef["state"]["case"],
    versionHash = "",
  ): EntityRef =>
    create(EntityRefSchema, {
      kind: EntityKind.COMPONENT,
      id,
      state:
        state === "pinned"
          ? { case: "pinned", value: { versionHash } }
          : state === "latest"
            ? { case: "latest", value: {} }
            : { case: "draft", value: {} },
    });

  it("is undefined until the geometry and the component list load", () => {
    expect(
      tessellationFingerprint(undefined, [], [summary("a", 1)]),
    ).toBeUndefined();
    expect(tessellationFingerprint(geometry(1), [], undefined)).toBeUndefined();
    expect(tessellationFingerprint(geometry(1), [], [])).toBeDefined();
  });

  it("changes with the geometry revision", () => {
    const refs = [ref("a", "draft")];
    const components = [summary("a", 1)];
    expect(tessellationFingerprint(geometry(1), refs, components)).not.toBe(
      tessellationFingerprint(geometry(2), refs, components),
    );
  });

  it("follows a draft reference's component revision", () => {
    const refs = [ref("a", "draft")];
    expect(
      tessellationFingerprint(geometry(1), refs, [summary("a", 1)]),
    ).not.toBe(tessellationFingerprint(geometry(1), refs, [summary("a", 2)]));
  });

  it("ignores draft revisions of pinned references", () => {
    const refs = [ref("a", "pinned", "sha256:p")];
    expect(
      tessellationFingerprint(geometry(1), refs, [summary("a", 1, "sha256:h")]),
    ).toBe(
      tessellationFingerprint(geometry(1), refs, [summary("a", 2, "sha256:h")]),
    );
  });

  it("follows the head hash of a latest reference", () => {
    const refs = [ref("a", "latest")];
    expect(
      tessellationFingerprint(geometry(1), refs, [summary("a", 1, "sha256:1")]),
    ).not.toBe(
      tessellationFingerprint(geometry(1), refs, [summary("a", 1, "sha256:2")]),
    );
  });

  it("changes with the reference state", () => {
    const components = [summary("a", 1, "sha256:h")];
    const fingerprints = new Set(
      [
        ref("a", "draft"),
        ref("a", "latest"),
        ref("a", "pinned", "sha256:h"),
      ].map((r) => tessellationFingerprint(geometry(1), [r], components)),
    );
    expect(fingerprints.size).toBe(3);
  });
});
