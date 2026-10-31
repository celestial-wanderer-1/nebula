import { create, type DescMessage, type Registry } from "@bufbuild/protobuf";
import { anyUnpack, type Any } from "@bufbuild/protobuf/wkt";
import {
  CircularFilamentSchema,
  CircularWindingPackSchema,
  CylindricalShellSchema,
  FourierSurfaceSchema,
  PolylineFilamentSchema,
  SplineCurveSchema,
  ToroidalShellSchema,
  type FourierMode,
  type Point3,
} from "../gen/nebula/core/v1/component_pb";
import {
  MeshSchema,
  MeshTopology,
  type Geometry,
  type Mesh,
} from "../gen/nebula/core/v1/geometry_pb";
import {
  ComponentTraitsSchema,
  type ComponentTraits,
} from "../gen/nebula/core/v1/options_pb";
import {
  IssueSeverity,
  ValidationIssueSchema,
  type ValidationIssue,
} from "../gen/nebula/core/v1/project_pb";
import { typeNameOf } from "../entities/content";
import { componentTraitsOf } from "../schema/annotations";

// The mock's stand-in for the geometry worker (A§3.3): pure mesh builders per
// shape type and the whole-geometry checks of D94, D114 and D145.

type Xyz = [number, number, number];

export type TessellateResult = { mesh: Mesh } | { error: string };

const traitsOf = (desc: DescMessage | undefined): ComponentTraits =>
  desc ? componentTraitsOf(desc) : create(ComponentTraitsSchema);

// Mesh encoding (D156): FP32 LE positions relative to the centroid, u32 LE
// indices. The viewer adds the origin back.

export function encodeMesh(
  topology: MeshTopology,
  points: readonly Xyz[],
  indices: readonly number[] = [],
): Mesh {
  const origin: Xyz = [0, 0, 0];
  for (const point of points) {
    for (let k = 0; k < 3; k++) origin[k]! += point[k]! / points.length;
  }
  const positions = new Uint8Array(points.length * 12);
  const view = new DataView(positions.buffer);
  points.forEach((point, i) => {
    for (let k = 0; k < 3; k++) {
      view.setFloat32((i * 3 + k) * 4, point[k]! - origin[k]!, true);
    }
  });
  const indexBytes = new Uint8Array(indices.length * 4);
  const indexView = new DataView(indexBytes.buffer);
  indices.forEach((index, i) => indexView.setUint32(i * 4, index, true));
  return create(MeshSchema, {
    topology,
    positions,
    indices: indexBytes,
    origin: { x: origin[0], y: origin[1], z: origin[2] },
  });
}

/** Positions relative to `mesh.origin`, as sent. */
export function decodePositions(mesh: Mesh): Float32Array {
  const bytes = mesh.positions;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(bytes.byteLength / 4);
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}

export function decodeIndices(mesh: Mesh): Uint32Array {
  const bytes = mesh.indices;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Uint32Array(bytes.byteLength / 4);
  for (let i = 0; i < out.length; i++) out[i] = view.getUint32(i * 4, true);
  return out;
}

/** Positions in the global frame: relative positions plus the origin. */
export function worldPositions(mesh: Mesh): Xyz[] {
  const relative = decodePositions(mesh);
  const o = mesh.origin ?? { x: 0, y: 0, z: 0 };
  const out: Xyz[] = [];
  for (let i = 0; i < relative.length; i += 3) {
    out.push([
      relative[i]! + o.x,
      relative[i + 1]! + o.y,
      relative[i + 2]! + o.z,
    ]);
  }
  return out;
}

const TAU = 2 * Math.PI;

const xyz = (p: Point3): Xyz => [p.x, p.y, p.z];

/** Grid of nu x nv vertices wrapped in both directions, as triangles. */
function wrappedGrid(
  nu: number,
  nv: number,
  vertex: (u: number, v: number) => Xyz,
  reverse = false,
  base = 0,
): { points: Xyz[]; indices: number[] } {
  const points: Xyz[] = [];
  const indices: number[] = [];
  for (let v = 0; v < nv; v++) {
    for (let u = 0; u < nu; u++) points.push(vertex(u, v));
  }
  const at = (u: number, v: number) => base + (v % nv) * nu + (u % nu);
  for (let v = 0; v < nv; v++) {
    for (let u = 0; u < nu; u++) {
      const a = at(u, v);
      const b = at(u + 1, v);
      const c = at(u + 1, v + 1);
      const d = at(u, v + 1);
      indices.push(...(reverse ? [a, c, b, a, d, c] : [a, b, c, a, c, d]));
    }
  }
  return { points, indices };
}

/** Revolves a closed (r, z) profile about the z axis. */
function revolve(
  profiles: { rz: [number, number][]; reverse?: boolean }[],
  segments: number,
): Mesh {
  const points: Xyz[] = [];
  const indices: number[] = [];
  for (const { rz, reverse } of profiles) {
    const grid = wrappedGrid(
      rz.length,
      segments,
      (u, v) => {
        const [r, z] = rz[u]!;
        const phi = (TAU * v) / segments;
        return [r * Math.cos(phi), r * Math.sin(phi), z];
      },
      reverse,
      points.length,
    );
    // Not spread: a fine grid has more items than a call takes arguments.
    for (const point of grid.points) points.push(point);
    for (const index of grid.indices) indices.push(index);
  }
  return encodeMesh(MeshTopology.TRIANGLES, points, indices);
}

const rectangle = (
  r0: number,
  r1: number,
  z0: number,
  z1: number,
): [number, number][] => [
  [r0, z0],
  [r1, z0],
  [r1, z1],
  [r0, z1],
];

/** Stellarator-symmetric Fourier surface point (component.proto). */
export function fourierPoint(
  modes: readonly FourierMode[],
  fieldPeriods: number,
  theta: number,
  phi: number,
): Xyz {
  let r = 0;
  let z = 0;
  for (const mode of modes) {
    const angle = mode.m * theta - mode.n * fieldPeriods * phi;
    r += mode.rmnc * Math.cos(angle);
    z += mode.zmns * Math.sin(angle);
  }
  return [r * Math.cos(phi), r * Math.sin(phi), z];
}

/** De Boor evaluation of a B-spline with the given knot vector. */
function deBoor(
  t: number,
  degree: number,
  knots: readonly number[],
  control: readonly Xyz[],
): Xyz {
  let span = degree;
  while (span < control.length - 1 && knots[span + 1]! <= t) span++;
  const d = Array.from(
    { length: degree + 1 },
    (_, j) => [...control[j + span - degree]!] as Xyz,
  );
  for (let r = 1; r <= degree; r++) {
    for (let j = degree; j >= r; j--) {
      const left = knots[j + span - degree]!;
      const right = knots[j + 1 + span - r]!;
      const alpha = right === left ? 0 : (t - left) / (right - left);
      for (let k = 0; k < 3; k++) {
        d[j]![k] = (1 - alpha) * d[j - 1]![k]! + alpha * d[j]![k]!;
      }
    }
  }
  return d[degree]!;
}

/**
 * Samples a uniform B-spline: clamped at both ends when open, closed with
 * wrapped control points when periodic.
 */
export function sampleBSpline(
  control: readonly Xyz[],
  requestedDegree: number,
  periodic: boolean,
  segments: number,
): Xyz[] {
  const degree = Math.min(requestedDegree || 3, control.length - 1);
  if (periodic) {
    const wrapped = [...control, ...control.slice(0, degree)];
    const knots = Array.from(
      { length: wrapped.length + degree + 1 },
      (_, i) => i,
    );
    return Array.from({ length: segments }, (_, k) =>
      deBoor(degree + (control.length * k) / segments, degree, knots, wrapped),
    );
  }
  const n = control.length;
  const knots = Array.from({ length: n + degree + 1 }, (_, i) =>
    i <= degree ? 0 : i >= n ? 1 : (i - degree) / (n - degree),
  );
  return Array.from({ length: segments + 1 }, (_, k) =>
    deBoor(k / segments, degree, knots, control),
  );
}

type Builder = (shape: Any, registry: Registry) => Mesh | string;

function numberField(message: object, name: string): number {
  const value = (message as Record<string, unknown>)[name];
  return typeof value === "number" ? value : 0;
}

let detail = 1;

/**
 * Multiplies the mesh resolution of every built-in shape, for performance
 * checks on large meshes (docs/UI.md P7). A store reset restores 1.
 */
export function setTessellationDetail(factor: number): void {
  detail = Math.max(1, factor);
}

const fine = (segments: number) => Math.round(segments * detail);

const builders: Record<string, Builder> = {
  [CircularFilamentSchema.typeName]: (shape) => {
    const coil = anyUnpack(shape, CircularFilamentSchema)!;
    const n = fine(coil.segments || 128);
    return encodeMesh(
      MeshTopology.LINE_LOOP,
      Array.from({ length: n }, (_, i) => {
        const phi = (TAU * i) / n;
        return [
          coil.majorRadius * Math.cos(phi),
          coil.majorRadius * Math.sin(phi),
          coil.height,
        ];
      }),
    );
  },

  [PolylineFilamentSchema.typeName]: (shape) => {
    const line = anyUnpack(shape, PolylineFilamentSchema)!;
    if (line.points.length < 2) return "A polyline needs at least two points";
    return encodeMesh(
      line.closed ? MeshTopology.LINE_LOOP : MeshTopology.LINE_STRIP,
      line.points.map(xyz),
    );
  },

  [SplineCurveSchema.typeName]: (shape) => {
    const curve = anyUnpack(shape, SplineCurveSchema)!;
    if (curve.controlPoints.length < 2) {
      return "A spline needs at least two control points";
    }
    return encodeMesh(
      curve.periodic ? MeshTopology.LINE_LOOP : MeshTopology.LINE_STRIP,
      sampleBSpline(
        curve.controlPoints.map(xyz),
        curve.degree,
        curve.periodic,
        fine(curve.segments || 128),
      ),
    );
  },

  [FourierSurfaceSchema.typeName]: (shape) => {
    const surface = anyUnpack(shape, FourierSurfaceSchema)!;
    if (surface.modes.length === 0) return "A Fourier surface needs modes";
    const np = fine(surface.poloidalPoints || 64);
    const nt = fine(surface.toroidalPoints || 128);
    const { points, indices } = wrappedGrid(np, nt, (u, v) =>
      fourierPoint(
        surface.modes,
        surface.fieldPeriods || 1,
        (TAU * u) / np,
        (TAU * v) / nt,
      ),
    );
    return encodeMesh(MeshTopology.TRIANGLES, points, indices);
  },

  [CircularWindingPackSchema.typeName]: (shape) => {
    const pack = anyUnpack(shape, CircularWindingPackSchema)!;
    const dr = pack.radialWidth / 2;
    const dz = pack.verticalHeight / 2;
    return revolve(
      [
        {
          rz: rectangle(
            pack.majorRadius - dr,
            pack.majorRadius + dr,
            pack.height - dz,
            pack.height + dz,
          ),
        },
      ],
      fine(pack.segments || 128),
    );
  },

  [ToroidalShellSchema.typeName]: (shape) => {
    const shell = anyUnpack(shape, ToroidalShellSchema)!;
    const segments = fine(shell.segments || 64);
    const poloidal = Math.max(16, Math.round(segments / 2));
    const kappa = shell.elongation || 1;
    const ellipse = (a: number) =>
      Array.from({ length: poloidal }, (_, i): [number, number] => {
        const theta = (TAU * i) / poloidal;
        return [
          shell.majorRadius + a * Math.cos(theta),
          kappa * a * Math.sin(theta),
        ];
      });
    const inner = shell.minorRadius - shell.thickness;
    return revolve(
      [
        { rz: ellipse(shell.minorRadius) },
        ...(shell.thickness > 0 && inner > 0
          ? [{ rz: ellipse(inner), reverse: true }]
          : []),
      ],
      segments,
    );
  },

  [CylindricalShellSchema.typeName]: (shape) => {
    const shell = anyUnpack(shape, CylindricalShellSchema)!;
    const half = shell.length / 2;
    return revolve(
      [
        {
          rz: rectangle(
            Math.max(0, shell.radius - shell.thickness),
            shell.radius,
            shell.zCenter - half,
            shell.zCenter + half,
          ),
        },
      ],
      fine(shell.segments || 64),
    );
  },

  // Plugin shape of the fake acme.demo plugin: a saddle loop on a cylinder.
  "acme.demo.v1.SaddleCoil": (shape, registry) => {
    const coil = anyUnpack(shape, registry);
    if (!coil) return "No tessellator for acme.demo.v1.SaddleCoil";
    const radius = numberField(coil, "majorRadius");
    if (radius <= 0) return "Saddle coil needs a positive major radius";
    const extent =
      numberField(coil, "toroidalExtent") ||
      numberField(coil, "width") / radius;
    const half = numberField(coil, "height") / 2;
    const n = 32;
    const arc = (z: number, from: number, to: number) =>
      Array.from({ length: n + 1 }, (_, k): Xyz => {
        const phi = from + ((to - from) * k) / n;
        return [radius * Math.cos(phi), radius * Math.sin(phi), z];
      });
    return encodeMesh(MeshTopology.LINE_LOOP, [
      ...arc(half, -extent / 2, extent / 2),
      ...arc(-half, extent / 2, -extent / 2),
    ]);
  },
};

/** Tessellates one shape, or explains why it cannot. */
export function tessellateShape(
  shape: Any | undefined,
  registry: Registry,
): TessellateResult {
  const type = typeNameOf(shape);
  const builder = builders[type];
  if (!shape || !builder) {
    return { error: `No tessellator for ${type || "an empty shape"}` };
  }
  const built = builder(shape, registry);
  return typeof built === "string" ? { error: built } : { mesh: built };
}

const issue = (
  severity: IssueSeverity,
  path: string,
  message: string,
): ValidationIssue =>
  create(ValidationIssueSchema, { severity, path, message });

/**
 * Free ends of a filament shape; empty when it is a closed loop. Undefined
 * for an open lead of fewer than two points, which has no ends to join and
 * so never closes a circuit.
 */
function openEnds(shape: Any): Xyz[] | undefined {
  if (typeNameOf(shape) !== PolylineFilamentSchema.typeName) return [];
  const line = anyUnpack(shape, PolylineFilamentSchema);
  if (!line || line.closed) return [];
  if (line.points.length < 2) return undefined;
  return [xyz(line.points[0]!), xyz(line.points.at(-1)!)];
}

// Endpoints within 1e-6 m of each other are the same node (D145).
const JOIN_TOLERANCE = 1e-6;

/** Whether some node of these free ends has odd degree: a dangling end. */
function hasFreeEnd(ends: readonly Xyz[]): boolean {
  const nodes: { at: Xyz; degree: number }[] = [];
  for (const end of ends) {
    const node = nodes.find(
      ({ at }) =>
        Math.hypot(at[0] - end[0], at[1] - end[1], at[2] - end[2]) <=
        JOIN_TOLERANCE,
    );
    if (node) node.degree++;
    else nodes.push({ at: end, degree: 1 });
  }
  return nodes.some((node) => node.degree % 2 !== 0);
}

/**
 * The geometry worker's checks of a whole geometry: mandatory symmetry
 * (D94, D113), current-carrying circuit members (D114), closed filament
 * circuits (D145) and Fourier surface periods matching the symmetry.
 * `resolveShape` returns the shape a component reference resolves to.
 */
export function checkGeometry(
  geometry: Geometry,
  resolveShape: (componentId: string) => Any | undefined,
  registry: Registry,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { symmetry } = geometry;
  if (!symmetry) {
    issues.push(
      issue(
        IssueSeverity.ERROR,
        "symmetry",
        "Symmetry metadata is required: set axisymmetric or N_fp (D94)",
      ),
    );
  } else if (!symmetry.axisymmetric && symmetry.fieldPeriods < 1) {
    issues.push(
      issue(
        IssueSeverity.ERROR,
        "symmetry",
        "A non-axisymmetric geometry needs N_fp of at least 1 (D113)",
      ),
    );
  }

  const referenced = new Set(geometry.components.map((ref) => ref.id));
  for (const id of referenced) {
    const shape = resolveShape(id);
    if (typeNameOf(shape) !== FourierSurfaceSchema.typeName || !symmetry) {
      continue;
    }
    const surface = anyUnpack(shape!, FourierSurfaceSchema);
    if (surface && surface.fieldPeriods !== symmetry.fieldPeriods) {
      issues.push(
        issue(
          IssueSeverity.WARNING,
          `components/${id}`,
          `Fourier surface has N_fp ${surface.fieldPeriods}; the geometry has ${symmetry.fieldPeriods} (D94)`,
        ),
      );
    }
  }

  for (const circuit of geometry.circuits) {
    const path = `circuits/${circuit.id}`;
    if (circuit.members.length === 0) {
      issues.push(
        issue(
          IssueSeverity.WARNING,
          path,
          `Circuit "${circuit.name}" has no members`,
        ),
      );
      continue;
    }
    const ends: Xyz[] = [];
    let filaments = 0;
    const seen = new Set<string>();
    for (const member of circuit.members) {
      const id = member.componentId;
      // Each component's ends count once: a lead listed twice is still open.
      if (seen.has(id)) {
        issues.push(
          issue(
            IssueSeverity.ERROR,
            path,
            `Member ${id} is listed more than once (D114)`,
          ),
        );
        continue;
      }
      seen.add(id);
      const shape = referenced.has(id) ? resolveShape(id) : undefined;
      if (!shape) {
        issues.push(
          issue(
            IssueSeverity.ERROR,
            path,
            `Member ${id} is not a component of this geometry`,
          ),
        );
        continue;
      }
      const traits = traitsOf(registry.getMessage(typeNameOf(shape)));
      if (!traits.currentCarrying) {
        issues.push(
          issue(
            IssueSeverity.ERROR,
            path,
            `Member ${id} does not carry current (D114)`,
          ),
        );
        continue;
      }
      if (!traits.filament) continue;
      filaments++;
      const memberEnds = openEnds(shape);
      if (memberEnds) {
        ends.push(...memberEnds);
        continue;
      }
      issues.push(
        issue(
          IssueSeverity.ERROR,
          path,
          `Filament circuit "${circuit.name}" is not closed: member ${id} is an open lead of fewer than two points (D145)`,
        ),
      );
    }
    // Leads close a circuit when every free end meets another one.
    if (filaments > 0 && hasFreeEnd(ends)) {
      issues.push(
        issue(
          IssueSeverity.ERROR,
          path,
          `Filament circuit "${circuit.name}" is not closed: its leads leave free ends; add leads (D145)`,
        ),
      );
    }
  }
  return issues;
}
