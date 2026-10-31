import { describe, expect, it } from "vitest";
import {
  CircularFilamentSchema,
  SplineCurveSchema,
} from "../gen/nebula/core/v1/component_pb";
import { mockSchema } from "../mocks/fixtures";
import { componentTraitsOf } from "./annotations";

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
