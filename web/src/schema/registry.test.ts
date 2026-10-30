import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { PluginInfoSchema } from "../gen/nebula/core/v1/plugin_pb";
import { EntityKind } from "../gen/nebula/core/v1/entity_pb";
import { mockSchema, pluginFixtures } from "../mocks/fixtures";
import {
  enumValueLabel,
  fieldLabel,
  quantityOf,
  uiHintOf,
  unknownCoreOptions,
} from "./annotations";
import { SchemaRegistry } from "./registry";

describe("SchemaRegistry", () => {
  it("resolves core messages without any plugin", () => {
    const registry = new SchemaRegistry();
    expect(
      registry.getMessage("nebula.core.v1.CircularFilament"),
    ).toBeDefined();
    expect(
      registry.getMessage("acme.demo.v1.DemoSolverConfig"),
    ).toBeUndefined();
  });

  it("layers a plugin's descriptor set over core (D54, D133)", () => {
    const config = mockSchema.getMessage("acme.demo.v1.DemoSolverConfig");
    expect(config).toBeDefined();
    const geometry = config?.field.geometry;
    expect(geometry?.fieldKind === "message" && geometry.message.typeName).toBe(
      "nebula.core.v1.EntityRef",
    );
    expect(
      mockSchema.pools.map((pool) => `${pool.id}@${pool.version}`),
    ).toEqual(["acme.demo@1.2.0"]);
  });

  it("records a broken descriptor set instead of failing the app", () => {
    const registry = new SchemaRegistry([
      ...pluginFixtures(),
      create(PluginInfoSchema, {
        id: "broken",
        version: "0.1.0",
        descriptorSet: new Uint8Array([0xff, 0xff, 0xff]),
      }),
    ]);
    expect(
      registry.pools.find((pool) => pool.id === "broken")?.error,
    ).toBeTruthy();
    expect(registry.getMessage("acme.demo.v1.DemoSolverConfig")).toBeDefined();
  });
});

describe("annotations", () => {
  const config = mockSchema.getMessage("acme.demo.v1.DemoSolverConfig")!;
  const boundary = mockSchema.getMessage("acme.demo.v1.FixedBoundary")!;

  it("reads unit tags, bounds and design-variable flags", () => {
    expect(quantityOf(config.field.coilCurrent!)).toMatchObject({
      unit: "A",
      min: -1e7,
      max: 1e7,
      designVariable: true,
    });
    const radius = quantityOf(boundary.field.minorRadius!);
    expect(radius).toMatchObject({ unit: "m", min: 0 });
    expect(radius?.max).toBeUndefined();
    expect(quantityOf(config.field.label!)).toBeUndefined();
  });

  it("reads UI hints, with an empty hint when absent", () => {
    expect(uiHintOf(config.field.tolerance!)).toMatchObject({
      label: "Tolerance",
      group: "Convergence",
      defaultJson: "1e-8",
    });
    expect(uiHintOf(config.field.geometry!).refKind).toBe(EntityKind.GEOMETRY);
    expect(uiHintOf(config.field.label!).label).toBe("");
  });

  it("labels fields and enum values", () => {
    expect(fieldLabel(config.field.edgeTemperature!)).toBe("Edge temperature");
    expect(fieldLabel(config.field.useSymmetry!)).toBe("Use symmetry");
    const method = config.field.method!;
    const values = method.fieldKind === "enum" ? method.enum.values : [];
    expect(values.map(enumValueLabel)).toEqual([
      "Unspecified",
      "Direct sum",
      "Fast multipole",
    ]);
  });

  it("detects core options this build does not know", () => {
    expect(unknownCoreOptions(config.field.futureField!)).toEqual([50999]);
    expect(unknownCoreOptions(config.field.tolerance!)).toEqual([]);
  });
});
