import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { OutputKind, RunOutputSchema } from "../gen/nebula/core/v1/output_pb";
import { RegionType } from "../gen/nebula/core/v1/region_pb";
import {
  ViewDescriptorSchema,
  ViewerKind,
} from "../gen/nebula/core/v1/view_pb";
import { eligibleViewers } from "./catalogue";

const output = (
  kind: OutputKind,
  extra: { regionType?: RegionType; timeSeries?: boolean } = {},
) =>
  create(RunOutputSchema, {
    kind,
    name: "out",
    ...extra,
  } satisfies MessageInitShape<typeof RunOutputSchema>);

describe("eligibleViewers (A§13.6, D87, D89)", () => {
  it.each([
    [RegionType.LINE, [ViewerKind.PROFILE_1D]],
    [RegionType.POINTS, [ViewerKind.PROFILE_1D]],
    [RegionType.PLANE, [ViewerKind.CONTOUR_2D]],
    [RegionType.BOX_GRID, [ViewerKind.FIELD_3D]],
    [RegionType.TOROIDAL_GRID, [ViewerKind.FIELD_3D]],
    [RegionType.COMPONENT_SURFACE, [ViewerKind.FIELD_3D]],
  ])(
    "picks by region type %s for a field on a region",
    (regionType, viewers) => {
      expect(
        eligibleViewers(output(OutputKind.REGION_FIELD, { regionType })),
      ).toEqual(viewers);
    },
  );

  it("picks by output kind", () => {
    expect(eligibleViewers(output(OutputKind.FLUX_SURFACES))).toEqual([
      ViewerKind.CONTOUR_2D,
      ViewerKind.PROFILE_1D,
    ]);
    expect(eligibleViewers(output(OutputKind.EIGENMODE))).toEqual([
      ViewerKind.MODE_STRUCTURE,
      ViewerKind.SPECTRUM,
    ]);
    expect(eligibleViewers(output(OutputKind.FIELD_LINES))[0]).toBe(
      ViewerKind.POINCARE,
    );
    expect(eligibleViewers(output(OutputKind.SCALARS))).toEqual([]);
    expect(eligibleViewers(output(OutputKind.FIELD_OPERATOR))).toEqual([]);
  });

  it("adds a time trace for time series (D146)", () => {
    expect(
      eligibleViewers(output(OutputKind.PROFILE, { timeSeries: true })),
    ).toEqual([ViewerKind.PROFILE_1D, ViewerKind.TIME_TRACE]);
  });

  it("puts a plugin's view descriptors first, without duplicates", () => {
    const descriptor = create(ViewDescriptorSchema, {
      output: "out",
      viewer: ViewerKind.FIELD_3D,
    });
    expect(
      eligibleViewers(output(OutputKind.FLUX_SURFACES), [descriptor]),
    ).toEqual([
      ViewerKind.FIELD_3D,
      ViewerKind.CONTOUR_2D,
      ViewerKind.PROFILE_1D,
    ]);
  });
});
