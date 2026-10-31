import { describe, expect, it } from "vitest";
import {
  CircularFilamentSchema,
  SplineCurveSchema,
} from "../gen/nebula/core/v1/component_pb";
import { mockSchema } from "../mocks/fixtures";
import { RegionSchema } from "../gen/nebula/core/v1/region_pb";
import { PlasmaTargetsSchema } from "../gen/nebula/core/v1/scenario_pb";
import { EquilibriumScalarsSchema } from "../gen/nebula/core/v1/output_pb";
import {
  componentTraitsOf,
  messageLabel,
  roleOf,
  toleranceOf,
  unknownCoreOptions,
  withinTolerance,
} from "./annotations";

describe("componentTraitsOf", () => {
  it("reads core shape traits", () => {
    expect(componentTraitsOf(CircularFilamentSchema)).toMatchObject({
      currentCarrying: true,
      filament: true,
    });
  });

  it("gives empty traits for an unannotated shape", () => {
    expect(componentTraitsOf(SplineCurveSchema)).toMatchObject({
      currentCarrying: false,
      filament: false,
    });
  });

  it("reads a plugin shape's traits from its descriptor set (D54)", () => {
    const saddle = mockSchema.getMessage("acme.demo.v1.SaddleCoil");
    expect(saddle).toBeDefined();
    expect(componentTraitsOf(saddle!)).toMatchObject({
      currentCarrying: true,
      filament: false,
    });
  });
});

describe("core options", () => {
  it("knows every field option the core declares", () => {
    const demo = mockSchema.getMessage("acme.demo.v1.DemoSolverConfig")!;
    // Core options are known: a field with ui.id_ref is editable.
    for (const field of RegionSchema.fields) {
      expect(unknownCoreOptions(field)).toEqual([]);
    }
    // An option from a newer core is not.
    expect(unknownCoreOptions(demo.field.futureField!)).toEqual([50999]);
  });

  it("reads message roles and labels message types", () => {
    const demo = mockSchema.getMessage("acme.demo.v1.DemoPlasmaTarget")!;
    expect(roleOf(PlasmaTargetsSchema)).toBe("plasma_target");
    expect(roleOf(demo)).toBe("plasma_target");
    expect(messageLabel(PlasmaTargetsSchema)).toBe("Plasma targets");
    expect(messageLabel(demo)).toBe("Demo plasma target (acme.demo.v1)");
    expect(
      mockSchema.messagesWithRole("plasma_target").map((d) => d.typeName),
    ).toEqual([
      "nebula.core.v1.PlasmaTargets",
      "acme.demo.v1.DemoPlasmaTarget",
    ]);
  });
});

describe("tolerances (D43)", () => {
  it("reads a quantity's declared tolerance", () => {
    expect(toleranceOf(EquilibriumScalarsSchema.field.q95!)).toMatchObject({
      rel: 0.02,
    });
    expect(toleranceOf(EquilibriumScalarsSchema.field.axisR!)).toMatchObject({
      abs: 1e-3,
    });
    const demo = mockSchema.getMessage("acme.demo.v1.DemoScalars")!;
    expect(toleranceOf(demo.field.rippleMax!)).toMatchObject({ abs: 1e-4 });
  });

  it("agrees within abs or rel, and exactly without a tolerance", () => {
    expect(withinTolerance(3.31, 3.02, { rel: 0.02 } as never)).toBe(false);
    expect(withinTolerance(3.31, 3.3, { rel: 0.02 } as never)).toBe(true);
    expect(withinTolerance(6.312, 6.3121, { abs: 1e-3 } as never)).toBe(true);
    expect(withinTolerance(1, 1.0001, undefined)).toBe(false);
    expect(withinTolerance(1, 1, undefined)).toBe(true);
  });
});
