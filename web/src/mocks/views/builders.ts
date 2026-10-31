import {
  create,
  type JsonObject,
  type MessageInitShape,
} from "@bufbuild/protobuf";
import { OutputKind, type RunOutput } from "../../gen/nebula/core/v1/output_pb";
import { RegionType, type Region } from "../../gen/nebula/core/v1/region_pb";
import {
  ViewerKind,
  ViewPayloadSchema,
  VtkPolyDataSchema,
  type ViewParams,
  type ViewPayload,
} from "../../gen/nebula/core/v1/view_pb";
import { fnv64 } from "../hash";
import { contourSegments } from "./contour";
import { cells, f32, range } from "./encode";
import { writeGlb } from "./glb";

// Payload builders of the mock's view jobs (A§3.6, A§9.5): analytic stand-
// ins for slices, contours, field lines, Poincaré punctures, spectra and
// profiles. Positions are float32 relative to a local origin (D156).

type Vec = [number, number, number];
type PolyInit = MessageInitShape<typeof VtkPolyDataSchema>;

const R0 = 6.2;
const MINOR = 2.0;
const KAPPA = 1.7;
const B0 = 5.3;

/** The equilibrium's poloidal flux, normalised to 1 at the boundary. */
const psiAt = (r: number, z: number) => {
  const shift = 0.15 * (1 - ((r - R0) / MINOR) ** 2);
  return ((r - R0 - shift) / MINOR) ** 2 + (z / (KAPPA * MINOR)) ** 2;
};

const bAt = (x: number, y: number, z: number) => {
  const r = Math.max(Math.hypot(x, y), 0.5);
  const toroidal = (B0 * R0) / r;
  const poloidal = 0.6 * Math.sqrt(psiAt(r, z));
  return Math.hypot(toroidal, poloidal);
};

const qAt = (rho: number, q95: number) => 1.0 + (q95 - 1.0) * rho ** 2;

/** A grid resolution that keeps a 2D grid under `maxPoints`. */
const side = (maxPoints: number, fallback: number) =>
  maxPoints > 0 ? Math.max(4, Math.floor(Math.sqrt(maxPoints))) : fallback;

const linspace = (a: number, b: number, n: number) =>
  Array.from({ length: n }, (_, i) => a + ((b - a) * i) / Math.max(1, n - 1));

function plotly(
  viewer: ViewerKind,
  title: string,
  figure: Record<string, unknown>,
  time?: RunOutput["time"],
): ViewPayload {
  return create(ViewPayloadSchema, {
    viewer,
    title,
    time,
    body: {
      case: "plotly",
      value: { figure: figure as JsonObject },
    },
  });
}

function polydata(
  viewer: ViewerKind,
  title: string,
  origin: Vec,
  pieces: PolyInit[],
  time?: RunOutput["time"],
): ViewPayload {
  return create(ViewPayloadSchema, {
    viewer,
    title,
    origin: { x: origin[0], y: origin[1], z: origin[2] },
    time,
    body: { case: "polydata", value: { pieces } },
  });
}

/** A structured quad grid as triangles, with one scalar per point. */
function surface(
  name: string,
  grid: Vec[][],
  origin: Vec,
  scalar: (p: Vec) => number,
  scalarName: string,
  unit: string,
): PolyInit {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const points: number[] = [];
  const values: number[] = [];
  for (const row of grid) {
    for (const p of row) {
      points.push(p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]);
      values.push(scalar(p));
    }
  }
  const polys: number[][] = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i;
      polys.push([a, a + 1, a + cols + 1], [a, a + cols + 1, a + cols]);
    }
  }
  const [min, max] = range(values);
  return {
    name,
    points: f32(points),
    polys: cells(polys),
    pointData: [
      {
        name: scalarName,
        components: 1,
        values: f32(values),
        rangeMin: min,
        rangeMax: max,
        unit,
      },
    ],
    activeScalars: scalarName,
  };
}

function polylines(name: string, lines: Vec[][], origin: Vec): PolyInit {
  const points: number[] = [];
  const ids: number[][] = [];
  let n = 0;
  for (const line of lines) {
    const cell: number[] = [];
    for (const p of line) {
      points.push(p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]);
      cell.push(n++);
    }
    ids.push(cell);
  }
  return { name, points: f32(points), lines: cells(ids) };
}

/** The flux-surface grid of the poloidal plane at φ = 0. */
function fluxContour(
  params: ViewParams,
  title: string,
  time?: RunOutput["time"],
): ViewPayload {
  const n = side(params.maxPoints, 64);
  const rs = linspace(R0 - 1.3 * MINOR, R0 + 1.3 * MINOR, n);
  const zs = linspace(
    -1.3 * KAPPA * MINOR,
    1.3 * KAPPA * MINOR,
    Math.round(n * 1.4),
  );
  // Time slices of an evolution move the axis outwards (D146).
  const shift = time ? (params.timeIndex ?? 0) * 0.03 : 0;
  const psi = (r: number, z: number) => psiAt(r - shift, z);
  const origin: Vec = [R0, 0, 0];
  const grid = zs.map((z) => rs.map((r): Vec => [r, 0, z]));
  const values = zs.flatMap((z) => rs.map((r) => psi(r, z)));
  const levels = params.isovalues.length
    ? params.isovalues
    : linspace(0.1, 1, 10);
  const segments = levels.flatMap((level) =>
    contourSegments(rs, zs, values, level).map(([a, b]): Vec[] => [
      [a[0], 0, a[1]],
      [b[0], 0, b[1]],
    ]),
  );
  return polydata(
    ViewerKind.CONTOUR_2D,
    title,
    origin,
    [
      surface("psi", grid, origin, (p) => psi(p[0], p[2]), "psi_n", ""),
      polylines("contours", segments, origin),
    ],
    time,
  );
}

/** |B| on a plane region (or the poloidal plane), with contours. */
function planeField(
  region: Region | undefined,
  params: ViewParams,
  title: string,
): ViewPayload {
  const plane = region?.shape.case === "plane" ? region.shape.value : undefined;
  const c: Vec = [
    plane?.center?.x ?? R0,
    plane?.center?.y ?? 0,
    plane?.center?.z ?? 0,
  ];
  const width = plane?.width || 8;
  const height = plane?.height || 14;
  const n = side(params.maxPoints, Math.min(plane?.nu || 48, 96));
  const xs = linspace(c[0] - width / 2, c[0] + width / 2, n);
  const zs = linspace(
    c[2] - height / 2,
    c[2] + height / 2,
    Math.round((n * height) / width),
  );
  const grid = zs.map((z) => xs.map((x): Vec => [x, c[1], z]));
  const values = zs.flatMap((z) => xs.map((x) => bAt(x, c[1], z)));
  const levels = params.isovalues.length ? params.isovalues : linspace(4, 9, 6);
  const segments = levels.flatMap((level) =>
    contourSegments(xs, zs, values, level).map(([a, b]): Vec[] => [
      [a[0], c[1], a[1]],
      [b[0], c[1], b[1]],
    ]),
  );
  return polydata(ViewerKind.CONTOUR_2D, title, c, [
    surface("B", grid, c, (p) => bAt(...p), "|B|", "T"),
    polylines("contours", segments, c),
  ]);
}

const DEFAULT_SEEDS: Vec[] = [0.3, 0.5, 0.7, 0.85].map((r) => [
  R0 + r * MINOR,
  0,
  0,
]);

/** A field line from a seed: a helix on its flux surface with pitch 1/q. */
function fieldLine(seed: Vec, turns: number, q95: number): Vec[] {
  const r = Math.hypot(seed[0] - R0, seed[2]) / MINOR;
  const q = qAt(Math.min(r, 1), q95);
  const theta0 = Math.atan2(seed[2], seed[0] - R0);
  return Array.from({ length: Math.round(turns * 120) + 1 }, (_, i) => {
    const phi = (i / 120) * 2 * Math.PI;
    const theta = theta0 + phi / q;
    const big = R0 + r * MINOR * Math.cos(theta);
    return [
      big * Math.cos(phi),
      big * Math.sin(phi),
      r * KAPPA * MINOR * Math.sin(theta),
    ];
  });
}

/** A slice of |B| through a box region, plus field lines from seeds. */
function boxField(
  region: Region | undefined,
  params: ViewParams,
  title: string,
): ViewPayload {
  const box = region?.shape.case === "boxGrid" ? region.shape.value : undefined;
  const lo: Vec = [box?.min?.x ?? 3.5, box?.min?.y ?? -2, box?.min?.z ?? -5];
  const hi: Vec = [box?.max?.x ?? 9, box?.max?.y ?? 2, box?.max?.z ?? 5];
  const origin: Vec = [
    (lo[0] + hi[0]) / 2,
    (lo[1] + hi[1]) / 2,
    (lo[2] + hi[2]) / 2,
  ];
  const normal = params.slice?.normal;
  const at: Vec = [
    params.slice?.origin?.x ?? origin[0],
    params.slice?.origin?.y ?? origin[1],
    params.slice?.origin?.z ?? origin[2],
  ];
  const n = side(params.maxPoints, 40);
  // The slice is axis-aligned: across the axis the normal points along most.
  const axis = normal
    ? [Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)].indexOf(
        Math.max(Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)),
      )
    : 1;
  const [u, v] = [0, 1, 2].filter((k) => k !== axis) as [number, number];
  const us = linspace(lo[u]!, hi[u]!, n);
  const vs = linspace(lo[v]!, hi[v]!, n);
  const grid = vs.map((b) =>
    us.map((a): Vec => {
      const p: Vec = [...at];
      p[u] = a;
      p[v] = b;
      return p;
    }),
  );
  const seeds = params.seeds.length
    ? params.seeds.map((s): Vec => [s.x, s.y, s.z])
    : DEFAULT_SEEDS;
  return polydata(ViewerKind.FIELD_3D, title, origin, [
    surface("slice", grid, origin, (p) => bAt(...p), "|B|", "T"),
    polylines(
      "field lines",
      seeds.map((s) => fieldLine(s, 2, 3.3)),
      origin,
    ),
  ]);
}

/** A torus surface at normalised radius `rho`, as a closed mesh. */
function torus(
  rho: number,
  segments: number,
): { positions: number[]; indices: number[] } {
  const positions: number[] = [];
  const indices: number[] = [];
  const nu = segments;
  const nv = Math.round(segments / 2);
  for (let j = 0; j < nv; j++) {
    const theta = (2 * Math.PI * j) / nv;
    for (let i = 0; i < nu; i++) {
      const phi = (2 * Math.PI * i) / nu;
      const big = R0 + rho * MINOR * Math.cos(theta);
      positions.push(
        big * Math.cos(phi),
        big * Math.sin(phi),
        rho * KAPPA * MINOR * Math.sin(theta),
      );
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * nu + i;
      const b = j * nu + ((i + 1) % nu);
      const c = ((j + 1) % nv) * nu + ((i + 1) % nu);
      const d = ((j + 1) % nv) * nu + i;
      indices.push(a, b, c, a, c, d);
    }
  }
  return { positions, indices };
}

/** An isosurface of |B| ~ flux surface, as binary glTF (D117). */
function isosurface(params: ViewParams, title: string): ViewPayload {
  const rho = Math.min(1, Math.max(0.05, params.isovalues[0] ?? 0.8));
  const { positions, indices } = torus(rho, side(params.maxPoints, 64));
  const origin: Vec = [0, 0, 0];
  return create(ViewPayloadSchema, {
    viewer: ViewerKind.FIELD_3D,
    title: `${title} (ψ_n = ${rho.toFixed(2)})`,
    origin: { x: origin[0], y: origin[1], z: origin[2] },
    body: {
      case: "gltf",
      value: {
        glb: writeGlb(new Float32Array(positions), new Uint32Array(indices)),
      },
    },
  });
}

/** The last closed flux surface coloured by |B|. */
function boundarySurface(params: ViewParams, title: string): ViewPayload {
  const n = side(params.maxPoints, 64);
  const origin: Vec = [0, 0, 0];
  const nv = Math.round(n / 2);
  const grid = Array.from({ length: nv + 1 }, (_, j) =>
    Array.from({ length: n + 1 }, (_, i): Vec => {
      const theta = (2 * Math.PI * j) / nv;
      const phi = (2 * Math.PI * i) / n;
      const big = R0 + MINOR * Math.cos(theta);
      return [
        big * Math.cos(phi),
        big * Math.sin(phi),
        KAPPA * MINOR * Math.sin(theta),
      ];
    }),
  );
  return polydata(ViewerKind.FIELD_3D, title, origin, [
    surface("lcfs", grid, origin, (p) => bAt(...p), "|B|", "T"),
  ]);
}

/** Field-line punctures of the section at φ: nested surfaces and islands. */
function poincare(params: ViewParams, title: string): ViewPayload {
  const transits = params.transits || 200;
  const phi = params.sectionPhi;
  const origin: Vec = [R0 * Math.cos(phi), R0 * Math.sin(phi), 0];
  const points: number[] = [];
  const surfaceIndex: number[] = [];
  const radii = params.seeds.length
    ? params.seeds.map((s) => Math.min(1, Math.hypot(s.x - R0, s.z) / MINOR))
    : linspace(0.15, 0.95, 9);
  radii.forEach((rho, k) => {
    const q = qAt(rho, 3.3);
    // Near q = 2, a chain of islands (D39).
    const island = Math.abs(q - 2) < 0.15;
    for (let t = 0; t < transits; t++) {
      const theta = (2 * Math.PI * t) / q + phi;
      const wobble = island ? 0.04 * Math.cos(2 * theta) : 0;
      const r = (rho + wobble) * MINOR;
      const big = R0 + r * Math.cos(theta);
      points.push(
        big * Math.cos(phi) - origin[0],
        big * Math.sin(phi) - origin[1],
        r * KAPPA * Math.sin(theta) - origin[2],
      );
      surfaceIndex.push(k);
    }
  });
  const count = surfaceIndex.length;
  return polydata(ViewerKind.POINCARE, title, origin, [
    {
      name: "punctures",
      points: f32(points),
      verts: cells(Array.from({ length: count }, (_, i) => [i])),
      pointData: [
        {
          name: "surface",
          components: 1,
          values: f32(surfaceIndex),
          rangeMin: 0,
          rangeMax: radii.length - 1,
        },
      ],
      activeScalars: "surface",
    },
  ]);
}

/** The structure of eigenmode m on the poloidal cross-section. */
function modeStructure(params: ViewParams, title: string): ViewPayload {
  const m = (params.modeIndex ?? 0) + 2;
  const n = side(params.maxPoints, 48);
  const origin: Vec = [R0, 0, 0];
  const grid = linspace(0.02, 1, Math.round(n / 2)).map((rho) =>
    linspace(0, 2 * Math.PI, n).map((theta): Vec => [
      R0 + rho * MINOR * Math.cos(theta),
      0,
      rho * KAPPA * MINOR * Math.sin(theta),
    ]),
  );
  const xi = (p: Vec) => {
    const dr = (p[0] - R0) / MINOR;
    const dz = p[2] / (KAPPA * MINOR);
    const rho = Math.hypot(dr, dz);
    const theta = Math.atan2(dz, dr);
    return rho ** m * (1 - rho) * 4 * Math.cos(m * theta);
  };
  return polydata(ViewerKind.MODE_STRUCTURE, `${title}: m = ${m}`, origin, [
    surface("mode", grid, origin, xi, "Re ξ", "m"),
  ]);
}

function figure(
  traces: Record<string, unknown>[],
  x: string,
  y: string,
  extra: Record<string, unknown> = {},
) {
  return {
    data: traces,
    layout: {
      xaxis: { title: { text: x } },
      yaxis: { title: { text: y } },
      ...extra,
    },
  };
}

/** Profiles against normalised radius; a time slice of a time series. */
function profiles(
  output: RunOutput,
  params: ViewParams,
  title: string,
): ViewPayload {
  const n = params.maxPoints ? Math.max(3, params.maxPoints) : 51;
  const rho = linspace(0, 1, n);
  if (output.kind === OutputKind.FLUX_SURFACES) {
    return plotly(
      ViewerKind.PROFILE_1D,
      title,
      figure(
        [
          {
            type: "scatter",
            mode: "lines",
            name: "q",
            x: rho,
            y: rho.map((r) => qAt(r, 3.3)),
          },
          {
            type: "scatter",
            mode: "lines",
            name: "p / p0",
            x: rho,
            y: rho.map((r) => (1 - r * r) ** 2),
          },
        ],
        "ρ",
        "",
      ),
      output.time,
    );
  }
  if (output.subContract === "Field.Ripple") {
    const phi = linspace(0, 2 * Math.PI, params.maxPoints || 360);
    return plotly(
      ViewerKind.PROFILE_1D,
      title,
      figure(
        [
          {
            type: "scatter",
            mode: "lines",
            name: "δ",
            x: phi,
            y: phi.map((p) => 0.004 * Math.cos(18 * p)),
          },
        ],
        "φ [rad]",
        "ripple δ",
      ),
    );
  }
  const t = output.time?.times[params.timeIndex ?? 0] ?? 0;
  const heat = 1 + 0.4 * (1 - Math.exp(-t));
  return plotly(
    ViewerKind.PROFILE_1D,
    title,
    figure(
      [
        {
          type: "scatter",
          mode: "lines",
          name: "Te",
          x: rho,
          y: rho.map((r) => 1.2e4 * heat * (1 - r * r) ** 1.5),
        },
        {
          type: "scatter",
          mode: "lines",
          name: "Ti",
          x: rho,
          y: rho.map((r) => 1.0e4 * heat * (1 - r * r) ** 1.3),
        },
      ],
      "ρ",
      "T [eV]",
    ),
    output.time,
  );
}

function spectrum(output: RunOutput, title: string): ViewPayload {
  const n = linspace(1, 10, 10);
  if (output.kind === OutputKind.EIGENMODE) {
    return plotly(
      ViewerKind.SPECTRUM,
      title,
      figure(
        [
          {
            type: "scatter",
            mode: "markers",
            name: "eigenvalues",
            x: n.map((k) => 2e3 * Math.cos(k)),
            y: n.map((k) => 1e4 / k),
          },
        ],
        "Re ω [1/s]",
        "Im ω [1/s]",
      ),
    );
  }
  return plotly(
    ViewerKind.SPECTRUM,
    title,
    figure(
      [
        {
          type: "bar",
          name: "γ",
          x: n,
          y: n.map((k) => 3e3 * Math.exp(-0.4 * k) * (k % 3 === 1 ? 1.5 : 1)),
        },
      ],
      "toroidal mode number n",
      "γ [1/s]",
    ),
  );
}

function timeTrace(
  output: RunOutput,
  params: ViewParams,
  title: string,
): ViewPayload {
  const times = output.time?.times ?? [];
  const values = times.map((t) => 1.2e4 * (1 + 0.4 * (1 - Math.exp(-t))));
  const index = params.timeIndex ?? 0;
  return plotly(
    ViewerKind.TIME_TRACE,
    title,
    figure(
      [
        {
          type: "scatter",
          mode: "lines+markers",
          name: "Te(0)",
          x: times,
          y: values,
        },
        {
          type: "scatter",
          mode: "markers",
          name: "shown slice",
          x: [times[index] ?? 0],
          y: [values[index] ?? 0],
          marker: { size: 12 },
        },
      ],
      "t [s]",
      "Te(0) [eV]",
    ),
    output.time,
  );
}

export class ViewError extends Error {}

/** Builds the payload of one view of one output. */
export function buildPayload(
  output: RunOutput,
  viewer: ViewerKind,
  params: ViewParams,
  region: Region | undefined,
): ViewPayload {
  const title = `${output.nodeId} · ${output.name}`;
  switch (viewer) {
    case ViewerKind.PROFILE_1D:
      return profiles(output, params, title);
    case ViewerKind.SPECTRUM:
      return spectrum(output, title);
    case ViewerKind.TIME_TRACE:
      if (!output.time) throw new ViewError("Not a time series");
      return timeTrace(output, params, title);
    case ViewerKind.CONTOUR_2D:
      return output.kind === OutputKind.REGION_FIELD
        ? planeField(region, params, title)
        : fluxContour(params, title, output.time);
    case ViewerKind.FIELD_3D:
      if (params.isovalues.length && output.kind === OutputKind.REGION_FIELD) {
        return isosurface(params, title);
      }
      if (output.kind === OutputKind.SURFACE)
        return boundarySurface(params, title);
      return boxField(region, params, title);
    case ViewerKind.POINCARE:
      return poincare(params, title);
    case ViewerKind.MODE_STRUCTURE:
      return modeStructure(params, title);
    default:
      throw new ViewError("Unknown viewer");
  }
}

export const isRegionField = (output: RunOutput) =>
  output.kind === OutputKind.REGION_FIELD &&
  output.regionType !== RegionType.UNSPECIFIED;

/** A small output-specific perturbation, so different Runs differ. */
const epsilonOf = (output: RunOutput) =>
  (parseInt(fnv64(output.contentHash).slice(0, 6), 16) / 0xffffff - 0.5) * 0.04;

/**
 * The difference of two Runs' fields resampled on a shared Region (D104),
 * a GPU job like any view (A§13.7): `output` minus `reference`.
 */
export function buildDifference(
  output: RunOutput,
  reference: RunOutput,
  viewer: ViewerKind,
  params: ViewParams,
  region: Region | undefined,
): ViewPayload {
  if (viewer !== ViewerKind.CONTOUR_2D && viewer !== ViewerKind.FIELD_3D) {
    throw new ViewError("A difference shows as a 2D contour or a 3D field");
  }
  const delta = epsilonOf(output) - epsilonOf(reference);
  const plane = region?.shape.case === "plane" ? region.shape.value : undefined;
  const c: Vec = [
    plane?.center?.x ?? R0,
    plane?.center?.y ?? 0,
    plane?.center?.z ?? 0,
  ];
  const width = plane?.width || 8;
  const height = plane?.height || 14;
  const n = side(params.maxPoints, 48);
  const xs = linspace(c[0] - width / 2, c[0] + width / 2, n);
  const zs = linspace(
    c[2] - height / 2,
    c[2] + height / 2,
    Math.round((n * height) / width),
  );
  const grid = zs.map((z) => xs.map((x): Vec => [x, c[1], z]));
  const diff = (p: Vec) =>
    delta * bAt(...p) * Math.cos(2 * Math.atan2(p[2], p[0] - R0));
  return polydata(
    viewer,
    `${output.runId} − ${reference.runId}: ${output.nodeId} · ${output.name}`,
    c,
    [surface("difference", grid, c, diff, "Δ|B|", "T")],
  );
}
