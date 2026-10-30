import { ScalarType } from "@bufbuild/protobuf";
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { QuantitySchema } from "../gen/nebula/core/v1/options_pb";
import { boundsHint, boundsWarning, violationsAt } from "./validate";
import { numericKind, parseNumber } from "./values";

describe("parseNumber", () => {
  it("parses doubles, including exponents", () => {
    expect(parseNumber("1e-8", numericKind(ScalarType.DOUBLE))).toEqual({
      ok: true,
      value: 1e-8,
    });
    expect(parseNumber("1e-", numericKind(ScalarType.DOUBLE)).ok).toBe(false);
    expect(parseNumber("", numericKind(ScalarType.DOUBLE)).ok).toBe(false);
  });

  it("rejects fractions for integers and negatives for unsigned", () => {
    expect(parseNumber("2.5", numericKind(ScalarType.INT32)).ok).toBe(false);
    expect(parseNumber("-1", numericKind(ScalarType.UINT32))).toEqual({
      ok: false,
      error: "Must not be negative",
    });
    expect(parseNumber("-1", numericKind(ScalarType.INT32))).toEqual({
      ok: true,
      value: -1,
    });
  });

  it("parses 64-bit integers as bigint without losing precision", () => {
    expect(
      parseNumber("9007199254740993", numericKind(ScalarType.INT64)),
    ).toEqual({ ok: true, value: 9007199254740993n });
  });
});

describe("advisory bounds", () => {
  const q = create(QuantitySchema, { min: 0, max: 3 });

  it("warns outside the annotated bounds only", () => {
    expect(boundsWarning(q, -1)).toBe("Below the minimum of 0");
    expect(boundsWarning(q, 4)).toBe("Above the maximum of 3");
    expect(boundsWarning(q, 0)).toBeUndefined();
    expect(
      boundsWarning(create(QuantitySchema, { min: 0 }), 1e9),
    ).toBeUndefined();
  });

  it("describes bounds", () => {
    expect(boundsHint(q)).toBe("0 to 3");
    expect(boundsHint(create(QuantitySchema, { min: 1 }))).toBe("≥ 1");
    expect(boundsHint(undefined)).toBe("");
  });
});

it("finds server violations by exact field path", () => {
  const violations = [
    { path: "grid.nr", message: "Too small" },
    { path: "grid", message: "Bad grid" },
  ].map((v) => ({ ...v, $typeName: "nebula.core.v1.FieldViolation" as const }));
  expect(violationsAt(violations, "grid.nr")).toEqual(["Too small"]);
});
