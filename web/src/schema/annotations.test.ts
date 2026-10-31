import { describe, expect, it } from "vitest";
import {
  CircularFilamentSchema,
  SplineCurveSchema,
} from "../gen/nebula/core/v1/component_pb";
import { mockSchema } from "../mocks/fixtures";
import { RegionSchema } from "../gen/nebula/core/v1/region_pb";
import { PlasmaTargetsSchema } from "../gen/nebula/core/v1/scenario_pb";
import {
  componentTraitsOf,
  messageLabel,
  roleOf,
  unknownCoreOptions,
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
