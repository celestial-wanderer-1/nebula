import type { Point3 } from "../../gen/nebula/core/v1/component_pb";
import type { Region, Vector3 } from "../../gen/nebula/core/v1/region_pb";

// What the placement view draws for a region (D89, D160): pure, so each of
// the nine region types tests without WebGL.

export type Vec = [number, number, number];

export interface RegionPreview {
  /** Sample points, drawn as dots. */
  points: Vec[];
  /** Polylines: outlines and grid lines. */
  lines: Vec[][];
  /** Components of the geometry the region covers. */
  components: string[];
  /** Why there is nothing to draw, if so. */
  note?: string;
}

const EMPTY: RegionPreview = { points: [], lines: [], components: [] };
const ARC_SEGMENTS = 48;
const MAX_GRID_LINES = 9;

const vec = (p: Point3 | Vector3 | undefined): Vec => [
  p?.x ?? 0,
  p?.y ?? 0,
  p?.z ?? 0,
];
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec): Vec | undefined => {
  const length = Math.hypot(...a);
  return length > 1e-12 ? scale(a, 1 / length) : undefined;
};

/** Evenly spaced values from a to b, `count` of them (at least 2). */
function steps(a: number, b: number, count: number): number[] {
  const n = Math.max(2, Math.min(count, MAX_GRID_LINES));
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
}

/** Point on a circle of radius r about z at height z and angle phi. */
const polar = (r: number, phi: number, z: number): Vec => [
  r * Math.cos(phi),
  r * Math.sin(phi),
  z,
];

function arc(r: number, z: number, phi0: number, phi1: number): Vec[] {
  return Array.from({ length: ARC_SEGMENTS + 1 }, (_, i) =>
    polar(r, phi0 + ((phi1 - phi0) * i) / ARC_SEGMENTS, z),
  );
}

/**
 * The in-plane axes of a plane: the first axis projected onto the plane,
 * the second their cross product. Undefined for a degenerate normal or a
 * first axis along the normal.
 */
export function planeAxes(
  normal: Vector3 | undefined,
  uAxis: Vector3 | undefined,
): [Vec, Vec] | undefined {
  const n = norm(vec(normal));
  if (!n) return undefined;
  const u0 = vec(uAxis);
  const u = norm(add(u0, scale(n, -dot(u0, n))));
  if (!u) return undefined;
  return [u, cross(n, u)];
}

/** The drawing of a region over its geometry. */
export function regionPreview(region: Region): RegionPreview {
  const shape = region.shape;
  switch (shape.case) {
    case "points":
      return { ...EMPTY, points: shape.value.points.map(vec) };
    case "line": {
      const { start, end, samples } = shape.value;
      const a = vec(start);
      const b = vec(end);
      const n = Math.max(2, Math.min(samples, 200));
      return {
        ...EMPTY,
        lines: [[a, b]],
        points: Array.from({ length: n }, (_, i) =>
          add(a, scale(add(b, scale(a, -1)), i / (n - 1))),
        ),
      };
    }
    case "plane": {
      const { center, normal, uAxis, width, height, nu, nv } = shape.value;
      const axes = planeAxes(normal, uAxis);
      if (!axes) {
        return {
          ...EMPTY,
          note: "The normal and first axis must not be parallel or zero.",
        };
      }
      const [u, v] = axes;
      const c = vec(center);
      const at = (s: number, t: number) =>
        add(c, add(scale(u, s), scale(v, t)));
      const hw = width / 2;
      const hh = height / 2;
      return {
        ...EMPTY,
        lines: [
          ...steps(-hw, hw, nu).map((s) => [at(s, -hh), at(s, hh)]),
          ...steps(-hh, hh, nv).map((t) => [at(-hw, t), at(hw, t)]),
        ],
      };
    }
    case "boxGrid": {
      const [x0, y0, z0] = vec(shape.value.min);
      const [x1, y1, z1] = vec(shape.value.max);
      const corner = (i: number): Vec => [
        i & 1 ? x1 : x0,
        i & 2 ? y1 : y0,
        i & 4 ? z1 : z0,
      ];
      const lines: Vec[][] = [];
      for (let i = 0; i < 8; i++) {
        for (const bit of [1, 2, 4]) {
          if (!(i & bit)) lines.push([corner(i), corner(i | bit)]);
        }
      }
      return { ...EMPTY, lines };
    }
    case "cylindricalGrid": {
      const { rMin, rMax, zMin, zMax, phiMin, phiMax } = shape.value;
      const lines: Vec[][] = [];
      for (const r of [rMin, rMax]) {
        if (r <= 0) continue;
        for (const z of [zMin, zMax]) lines.push(arc(r, z, phiMin, phiMax));
      }
      for (const phi of [phiMin, phiMax]) {
        for (const r of [rMin, rMax]) {
          lines.push([polar(r, phi, zMin), polar(r, phi, zMax)]);
        }
      }
      return { ...EMPTY, lines };
    }
    case "toroidalGrid": {
      const { majorRadius, minorRadius, phiMin, phiMax } = shape.value;
      const section = (phi: number) =>
        Array.from({ length: ARC_SEGMENTS + 1 }, (_, i) => {
          const theta = (2 * Math.PI * i) / ARC_SEGMENTS;
          return polar(
            majorRadius + minorRadius * Math.cos(theta),
            phi,
            minorRadius * Math.sin(theta),
          );
        });
      const phis = steps(phiMin, phiMax, 5);
      return {
        ...EMPTY,
        lines: [
          ...phis.map(section),
          arc(majorRadius, 0, phiMin, phiMax),
          arc(majorRadius + minorRadius, 0, phiMin, phiMax),
          arc(Math.max(0, majorRadius - minorRadius), 0, phiMin, phiMax),
        ],
      };
    }
    case "componentSurface":
      return shape.value.componentId
        ? { ...EMPTY, components: [shape.value.componentId] }
        : { ...EMPTY, note: "Choose a component." };
    case "meshVolume":
      return shape.value.componentIds.length
        ? { ...EMPTY, components: [...shape.value.componentIds] }
        : { ...EMPTY, note: "Choose the components that enclose the volume." };
    case "stepOutputSurface":
      return {
        ...EMPTY,
        note: `Placed on the “${shape.value.surface || "surface"}” output of an upstream step once it has run (D160).`,
      };
    default:
      return { ...EMPTY, note: "Choose a region type." };
  }
}
