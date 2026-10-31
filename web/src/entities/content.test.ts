import { create, createRegistry } from "@bufbuild/protobuf";
import { anyPack } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import {
  CircularFilamentSchema,
  ComponentSchema,
  type CircularFilament,
} from "../gen/nebula/core/v1/component_pb";
import {
  GeometrySchema,
  SymmetrySchema,
} from "../gen/nebula/core/v1/geometry_pb";
import { coreRegistry } from "../schema/core";
import {
  newCircuitId,
  packComponent,
  packGeometry,
  unpackComponent,
  unpackGeometry,
  withShape,
} from "./content";

const filament = create(CircularFilamentSchema, {
  majorRadius: 2.5,
  height: 0.4,
  segments: 64,
});

describe("component content", () => {
  it("round-trips a core shape and its material", () => {
    const component = withShape(
      create(ComponentSchema, { materialId: "mat-cu" }),
      CircularFilamentSchema,
      filament,
    );
    const unpacked = unpackComponent(packComponent(component), coreRegistry);
    expect(unpacked.shapeType).toBe("nebula.core.v1.CircularFilament");
    expect(unpacked.shapeDesc?.typeName).toBe(
      "nebula.core.v1.CircularFilament",
    );
    expect(unpacked.component.materialId).toBe("mat-cu");
    expect(unpacked.shape as CircularFilament).toMatchObject({
      majorRadius: 2.5,
      height: 0.4,
      segments: 64,
    });
  });

  it("keeps a shape of an unknown type without decoding it", () => {
    const shape = {
      $typeName: "google.protobuf.Any" as const,
      typeUrl: "type.googleapis.com/vendor.x.v3.Mystery",
      value: new Uint8Array([8, 1]),
    };
    const content = packComponent(
      create(ComponentSchema, { shape, materialId: "m" }),
    );
    const unpacked = unpackComponent(content, coreRegistry);
    expect(unpacked.shapeType).toBe("vendor.x.v3.Mystery");
    expect(unpacked.shapeDesc).toBeUndefined();
    expect(unpacked.shape).toBeUndefined();
    // Repacking is lossless.
    const again = unpackComponent(
      packComponent(unpacked.component),
      createRegistry(),
    );
    expect(again.component.shape?.value).toEqual(new Uint8Array([8, 1]));
    expect(again.component.materialId).toBe("m");
  });

  it("wraps bare shape content and handles missing content", () => {
    const bare = unpackComponent(
      anyPack(CircularFilamentSchema, filament),
      coreRegistry,
    );
    expect(bare.shapeType).toBe("nebula.core.v1.CircularFilament");
    expect(bare.shape as CircularFilament).toMatchObject({ majorRadius: 2.5 });

    const empty = unpackComponent(undefined, coreRegistry);
    expect(empty.shapeType).toBe("");
    expect(empty.shapeDesc).toBeUndefined();
  });
});

describe("geometry content", () => {
  it("round-trips and defaults to an empty geometry", () => {
    const geometry = create(GeometrySchema, {
      symmetry: create(SymmetrySchema, { fieldPeriods: 5 }),
      circuits: [{ id: "ckt-1", name: "PF" }],
    });
    const unpacked = unpackGeometry(packGeometry(geometry));
    expect(unpacked.symmetry?.fieldPeriods).toBe(5);
    expect(unpacked.circuits.map((c) => c.id)).toEqual(["ckt-1"]);
    expect(unpackGeometry(undefined)).toEqual(create(GeometrySchema));
  });

  it("mints circuit IDs as ckt- and eight hex digits (D114)", () => {
    const id = newCircuitId();
    expect(id).toMatch(/^ckt-[0-9a-f]{8}$/);
    expect(newCircuitId()).not.toBe(id);
  });
});
