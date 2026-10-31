import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { RegionSchema } from "../../gen/nebula/core/v1/region_pb";
import { planeAxes, regionPreview } from "./preview";

const preview = (shape: MessageInitShape<typeof RegionSchema>["shape"]) =>
  regionPreview(create(RegionSchema, { shape }));

describe("regionPreview (D89, D160)", () => {
  it("draws points and lines with their samples", () => {
    expect(
      preview({ case: "points", value: { points: [{ x: 1 }, { y: 2 }] } })
        .points,
    ).toEqual([
      [1, 0, 0],
      [0, 2, 0],
    ]);
    const line = preview({
      case: "line",
      value: { start: { x: 0 }, end: { x: 4 }, samples: 5 },
    });
    expect(line.lines).toEqual([
      [
        [0, 0, 0],
        [4, 0, 0],
      ],
    ]);
    expect(line.points.map((p) => p[0])).toEqual([0, 1, 2, 3, 4]);
  });

  it("draws a plane's grid in its own axes", () => {
    const plane = preview({
      case: "plane",
      value: {
        center: { x: 6 },
        normal: { y: 1 },
        uAxis: { x: 1, y: 0.5 },
        width: 4,
        height: 2,
        nu: 3,
        nv: 3,
      },
    });
    expect(plane.lines).toHaveLength(6);
    // Every grid point lies in the plane y = 0.
    for (const p of plane.lines.flat()) expect(p[1]).toBeCloseTo(0);
    // The second axis is n × u: here -z, so (u, v, n) is right-handed.
    expect(plane.lines[0]![0]).toEqual([4, 0, 1]);
  });

  it("explains a degenerate plane", () => {
    expect(
      planeAxes({ x: 0, y: 1, z: 0 } as never, { x: 0, y: 2, z: 0 } as never),
    ).toBeUndefined();
    expect(
      preview({ case: "plane", value: { normal: { y: 1 }, uAxis: { y: 1 } } })
        .note,
    ).toMatch(/must not be parallel/);
  });

  it("draws the 12 edges of a box", () => {
    const box = preview({
      case: "boxGrid",
      value: { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } },
    });
    expect(box.lines).toHaveLength(12);
  });

  it("draws cylindrical and toroidal grids as arcs and sections", () => {
    const cylinder = preview({
      case: "cylindricalGrid",
      value: { rMin: 1, rMax: 2, zMin: -1, zMax: 1, phiMax: Math.PI },
    });
    expect(cylinder.lines).toHaveLength(8);
    const torus = preview({
      case: "toroidalGrid",
      value: { majorRadius: 6, minorRadius: 2, phiMax: Math.PI / 2 },
    });
    expect(torus.lines).toHaveLength(5 + 3);
    const outer = torus.lines[5 + 1]!;
    expect(Math.hypot(outer[0]![0], outer[0]![1])).toBeCloseTo(8);
  });

  it("highlights components for surface and volume regions", () => {
    expect(
      preview({
        case: "componentSurface",
        value: { componentId: "cmp-vessel" },
      }).components,
    ).toEqual(["cmp-vessel"]);
    expect(
      preview({ case: "meshVolume", value: { componentIds: ["a", "b"] } })
        .components,
    ).toEqual(["a", "b"]);
    expect(preview({ case: "meshVolume", value: {} }).note).toMatch(/Choose/);
  });

  it("places step-output surfaces only after their step runs", () => {
    expect(
      preview({ case: "stepOutputSurface", value: { surface: "lcfs" } }).note,
    ).toMatch(/“lcfs” output/);
    expect(preview(undefined as never).note).toBe("Choose a region type.");
  });
});
