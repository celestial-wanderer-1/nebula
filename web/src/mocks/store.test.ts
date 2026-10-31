import { create } from "@bufbuild/protobuf";
import { anyPack, anyUnpack } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import {
  CircularFilamentSchema,
  ComponentSchema,
} from "../gen/nebula/core/v1/component_pb";
import {
  ChangeType,
  EntityKind,
  type EntityChange,
} from "../gen/nebula/core/v1/entity_pb";
import { GeometrySchema } from "../gen/nebula/core/v1/geometry_pb";
import { componentRef } from "./fixtures";
import { MockStore } from "./store";
import { worldPositions } from "./tessellate";
import { unwrapComponent } from "../entities/content";

const P = "p-baseline";

function setRef(store: MockStore, ref: ReturnType<typeof componentRef>) {
  const record = store.entity(P, EntityKind.GEOMETRY, "geo-main")!;
  const geometry = anyUnpack(record.draft.content!, GeometrySchema)!;
  geometry.components = geometry.components.map((r) =>
    r.id === ref.id ? ref : r,
  );
  record.draft.content = anyPack(GeometrySchema, geometry);
}

describe("MockStore", () => {
  it("creates and deletes entities, publishing each change", () => {
    const store = new MockStore("1");
    const events: EntityChange[] = [];
    store.onEntityChange((event) => events.push(event));
    const result = store.createEntity(
      P,
      EntityKind.COMPONENT,
      "PF5",
      anyPack(
        ComponentSchema,
        create(ComponentSchema, {
          shape: anyPack(
            CircularFilamentSchema,
            create(CircularFilamentSchema, { majorRadius: 1 }),
          ),
        }),
      ),
    );
    if (!result.ok) throw new Error(result.message);
    expect(result.value.draft).toMatchObject({ id: "cmp-1", revision: 1 });
    expect(store.deleteEntity(P, EntityKind.COMPONENT, "cmp-1").ok).toBe(true);
    expect(events.map((e) => [e.id, e.change])).toEqual([
      ["cmp-1", ChangeType.CREATED],
      ["cmp-1", ChangeType.DELETED],
    ]);
  });

  it("refuses to delete a component or material that is in use", () => {
    const store = new MockStore("1");
    expect(store.deleteEntity(P, EntityKind.COMPONENT, "cmp-pf1")).toEqual({
      ok: false,
      status: 409,
      code: "in_use",
      message: 'Referenced by geometry "Baseline assembly"',
    });
    expect(store.deleteMaterial(P, "m-ss316")).toMatchObject({
      ok: false,
      code: "in_use",
    });
    const created = store.createMaterial(P, { name: "Spare" });
    if (!created.ok) throw new Error(created.message);
    expect(store.deleteMaterial(P, created.value.id).ok).toBe(true);
  });

  it("imports a library component with its material, reusing a held copy", () => {
    const store = new MockStore("1");
    const before = store.materialList(P).length;
    // p-baseline already holds a copy of lib-mat-ss316 as m-ss316.
    const vessel = store.importComponent(P, "lib-cmp-vessel");
    if (!vessel.ok) throw new Error(vessel.message);
    const component = unwrapComponent(vessel.value.draft.content);
    expect(component.materialId).toBe("m-ss316");
    expect(component.source).toMatchObject({
      entryId: "lib-cmp-vessel",
      entryName: "Vacuum vessel",
    });
    expect(store.materialList(P)).toHaveLength(before);

    // Its copper is the library's, not the unlinked m-copper: imported.
    const coil = store.importComponent(P, "lib-cmp-pf-coil");
    if (!coil.ok) throw new Error(coil.message);
    const materialId = unwrapComponent(coil.value.draft.content).materialId;
    expect(store.material(P, materialId)?.source?.entryId).toBe(
      "lib-mat-copper",
    );
    expect(store.materialList(P)).toHaveLength(before + 1);
    expect(store.importComponent(P, "lib-cmp-pf-coil").ok).toBe(true);
    expect(store.materialList(P)).toHaveLength(before + 1);
  });

  it("adds a project component to the library, mapping its material", () => {
    const store = new MockStore("1");
    const added = store.addComponentToLibrary(P, "cmp-vessel", "Ours");
    if (!added.ok) throw new Error(added.message);
    expect(added.value.component?.materialId).toBe("lib-mat-ss316");
    const pf1 = store.addComponentToLibrary(P, "cmp-pf1", "");
    if (!pf1.ok) throw new Error(pf1.message);
    // m-copper has no library source, so it is added to the library too.
    expect(
      store.library.materials.find(
        (m) => m.id === pf1.value.component?.materialId,
      )?.name,
    ).toBe("Copper");
  });

  it("adds an edited copy of a library material to the library afresh", () => {
    const store = new MockStore("1");
    const ss316 = store.material(P, "m-ss316")!;
    store.updateMaterial(P, "m-ss316", {
      name: ss316.name,
      properties: { ...ss316.properties!, density: 8100 },
    });
    // The copy kept its source, but no longer equals that entry.
    expect(store.material(P, "m-ss316")?.source?.entryId).toBe("lib-mat-ss316");
    const added = store.addComponentToLibrary(P, "cmp-vessel", "");
    if (!added.ok) throw new Error(added.message);
    const materialId = added.value.component?.materialId;
    expect(materialId).not.toBe("lib-mat-ss316");
    expect(
      store.library.materials.find((m) => m.id === materialId)?.properties
        ?.density,
    ).toBe(8100);
  });

  it("tessellates each reference in its state (D107)", () => {
    const store = new MockStore("1");
    const pf2 = () =>
      store.tessellation(P, "geo-main", "cmp-pf2")!.components[0]!;
    // Pinned to pf2-v1, minted with a major radius of 8.2.
    expect(pf2()).toMatchObject({ revision: 0, versionHash: "sha256:pf2-v1" });
    expect(
      Math.hypot(...worldPositions(pf2().mesh!)[0]!.slice(0, 2)),
    ).toBeCloseTo(8.2, 4);

    setRef(store, componentRef("cmp-pf2", "latest"));
    expect(pf2()).toMatchObject({ revision: 0, versionHash: "sha256:pf2-v1" });
    // The head version's content, not the draft's (8.3).
    expect(
      Math.hypot(...worldPositions(pf2().mesh!)[0]!.slice(0, 2)),
    ).toBeCloseTo(8.2, 4);

    setRef(store, componentRef("cmp-pf2"));
    expect(pf2()).toMatchObject({ revision: 2, versionHash: "" });
    expect(
      Math.hypot(...worldPositions(pf2().mesh!)[0]!.slice(0, 2)),
    ).toBeCloseTo(8.3, 4);

    setRef(store, componentRef("cmp-pf2", { pinned: "sha256:nope" }));
    expect(pf2().error).toMatch(/not found/);
  });

  it("exports STEP for the draft and for a version", () => {
    const store = new MockStore("1");
    const draft = store.step(P, "geo-main")!;
    expect(draft.filename).toBe("Baseline-assembly.step");
    expect(draft.body).toMatch(/^ISO-10303-21;/);
    expect(draft.body).toContain("'cmp-pf1','PF1'");
    expect(store.step(P, "geo-main", "sha256:geo-v1")?.filename).toBe(
      "Baseline-assembly-geo-v1.step",
    );
    expect(store.step(P, "geo-main", "sha256:nope")).toBeUndefined();
  });
});
