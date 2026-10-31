import { anyUnpack } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import { CircularFilamentSchema } from "../gen/nebula/core/v1/component_pb";
import { EntityKind } from "../gen/nebula/core/v1/entity_pb";
import { mockSchema } from "./fixtures";
import { scenarios } from "./scenarios";
import { store } from "./state";
import { unwrapComponent } from "../entities/content";

describe("scenarios.concurrentEdit", () => {
  it("renames the entity and bumps the first numeric field of a component's shape", () => {
    scenarios.concurrentEdit("p-baseline", EntityKind.COMPONENT, "cmp-pf1");
    const { draft } = store.entity(
      "p-baseline",
      EntityKind.COMPONENT,
      "cmp-pf1",
    )!;
    expect(draft).toMatchObject({
      name: "PF1 (edited elsewhere)",
      revision: 4,
    });
    const component = unwrapComponent(draft.content);
    expect(component.materialId).toBe("m-copper");
    const shape = anyUnpack(component.shape!, CircularFilamentSchema)!;
    expect(shape.majorRadius).toBeCloseTo(4.0, 9);
    expect(shape.height).toBe(7.6);
  });

  it("changes plugin shapes too", () => {
    scenarios.concurrentEdit("p-baseline", EntityKind.COMPONENT, "cmp-saddle");
    const { draft } = store.entity(
      "p-baseline",
      EntityKind.COMPONENT,
      "cmp-saddle",
    )!;
    const shape = anyUnpack(
      unwrapComponent(draft.content).shape!,
      mockSchema.typeRegistry,
    ) as unknown as { width: number };
    expect(shape.width).toBeCloseTo(0.5, 9);
  });
});

describe("scenarios.largeGeometry", () => {
  const triangles = () =>
    store
      .tessellation("p-baseline", "geo-main")!
      .components.reduce((sum, c) => sum + (c.mesh?.indices.length ?? 0), 0) /
    12;

  it("refines meshes to about 500k triangles until a reset", () => {
    const base = triangles();
    scenarios.largeGeometry();
    expect(triangles()).toBe(base * 64);
    expect(triangles()).toBeGreaterThan(500_000);
    store.reset(store.apiVersion);
    expect(triangles()).toBe(base);
  });
});
