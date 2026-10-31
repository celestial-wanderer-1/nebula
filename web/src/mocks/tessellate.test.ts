import {
  create,
  type DescMessage,
  type MessageInitShape,
} from "@bufbuild/protobuf";
import { anyPack, type Any } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import {
  CircularFilamentSchema,
  CircularWindingPackSchema,
  CylindricalShellSchema,
  FourierSurfaceSchema,
  Point3Schema,
  PolylineFilamentSchema,
  SplineCurveSchema,
  ToroidalShellSchema,
} from "../gen/nebula/core/v1/component_pb";
import {
  CircuitSchema,
  GeometrySchema,
  MeshTopology,
  SymmetrySchema,
  type Geometry,
  type Mesh,
} from "../gen/nebula/core/v1/geometry_pb";
import { IssueSeverity } from "../gen/nebula/core/v1/project_pb";
import { componentRef, conceptKits, mockSchema } from "./fixtures";
import { MockStore } from "./store";
import {
  checkGeometry,
  decodeIndices,
  decodePositions,
  tessellateShape,
  worldPositions,
} from "./tessellate";

const registry = mockSchema.typeRegistry;

function pack<Desc extends DescMessage>(
  schema: Desc,
  init: MessageInitShape<Desc>,
): Any {
  return anyPack(schema, create(schema, init));
}

function meshOf(shape: Any): Mesh {
  const result = tessellateShape(shape, registry);
  if ("error" in result) throw new Error(result.error);
  return result.mesh;
}

/** Asserts the wire invariants of a mesh (geometry.proto) and returns it. */
function expectWellFormed(mesh: Mesh, topology: MeshTopology): Mesh {
  expect(mesh.topology).toBe(topology);
  expect(mesh.positions.byteLength % 12).toBe(0);
  const vertices = mesh.positions.byteLength / 12;
  expect(vertices).toBeGreaterThan(1);
  const indices = decodeIndices(mesh);
  if (topology === MeshTopology.TRIANGLES) {
    expect(indices.length).toBeGreaterThan(0);
    expect(indices.length % 3).toBe(0);
    expect(Math.max(...indices)).toBeLessThan(vertices);
  } else {
    expect(indices).toHaveLength(0);
  }
  // Positions are relative to the centroid, which travels as the origin.
  const relative = decodePositions(mesh);
  for (let k = 0; k < 3; k++) {
    let sum = 0;
    for (let i = k; i < relative.length; i += 3) sum += relative[i]!;
    expect(Math.abs(sum / vertices)).toBeLessThan(1e-4);
  }
  return mesh;
}

const radius = ([x, y]: number[]) => Math.hypot(x!, y!);
const near = (value: number, expected: number) =>
  expect(value).toBeCloseTo(expected, 4);

describe("tessellateShape", () => {
  it("builds a circular filament as a loop in the global frame", () => {
    const mesh = expectWellFormed(
      meshOf(
        pack(CircularFilamentSchema, {
          majorRadius: 3.9,
          height: 7.6,
          segments: 64,
        }),
      ),
      MeshTopology.LINE_LOOP,
    );
    expect(mesh.origin?.z).toBeCloseTo(7.6, 6);
    const points = worldPositions(mesh);
    expect(points).toHaveLength(64);
    for (const point of points) {
      near(radius(point), 3.9);
      near(point[2]!, 7.6);
    }
  });

  it("builds open and closed polylines through their points", () => {
    const points = [
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0, y: 1, z: 2 },
    ];
    const open = expectWellFormed(
      meshOf(pack(PolylineFilamentSchema, { points })),
      MeshTopology.LINE_STRIP,
    );
    worldPositions(open)[2]!.forEach((c, k) => near(c, [0, 1, 2][k]!));
    expectWellFormed(
      meshOf(pack(PolylineFilamentSchema, { points, closed: true })),
      MeshTopology.LINE_LOOP,
    );
    expect(
      tessellateShape(
        pack(PolylineFilamentSchema, { points: points.slice(0, 1) }),
        registry,
      ),
    ).toEqual({ error: "A polyline needs at least two points" });
  });

  it("evaluates clamped splines through their end points and periodic splines as loops", () => {
    const controlPoints = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 2, z: 0 },
      { x: 3, y: 2, z: 1 },
      { x: 4, y: 0, z: 1 },
    ];
    const open = expectWellFormed(
      meshOf(
        pack(SplineCurveSchema, { controlPoints, degree: 3, segments: 32 }),
      ),
      MeshTopology.LINE_STRIP,
    );
    const points = worldPositions(open);
    expect(points).toHaveLength(33);
    points[0]!.forEach((c, k) => near(c, [0, 0, 0][k]!));
    points[32]!.forEach((c, k) => near(c, [4, 0, 1][k]!));

    const closed = expectWellFormed(
      meshOf(
        pack(SplineCurveSchema, {
          controlPoints,
          degree: 3,
          periodic: true,
          segments: 32,
        }),
      ),
      MeshTopology.LINE_LOOP,
    );
    expect(worldPositions(closed)).toHaveLength(32);
  });

  it("builds surfaces and solids as indexed triangles", () => {
    const surface = expectWellFormed(
      meshOf(
        pack(FourierSurfaceSchema, {
          modes: [
            { m: 0, n: 0, rmnc: 5.5 },
            { m: 1, n: 0, rmnc: 0.5, zmns: 0.5 },
          ],
          fieldPeriods: 5,
          poloidalPoints: 16,
          toroidalPoints: 40,
        }),
      ),
      MeshTopology.TRIANGLES,
    );
    for (const point of worldPositions(surface)) {
      near(Math.hypot(radius(point) - 5.5, point[2]!), 0.5);
    }

    const pack3 = expectWellFormed(
      meshOf(
        pack(CircularWindingPackSchema, {
          majorRadius: 2,
          height: 1,
          radialWidth: 0.4,
          verticalHeight: 0.2,
          segments: 32,
        }),
      ),
      MeshTopology.TRIANGLES,
    );
    for (const point of worldPositions(pack3)) {
      expect(radius(point)).toBeGreaterThan(1.8 - 1e-4);
      expect(radius(point)).toBeLessThan(2.2 + 1e-4);
      expect(Math.abs(point[2]! - 1)).toBeLessThan(0.1 + 1e-4);
    }

    expectWellFormed(
      meshOf(
        pack(ToroidalShellSchema, {
          majorRadius: 6.2,
          minorRadius: 2.4,
          elongation: 1.7,
          thickness: 0.06,
          segments: 32,
        }),
      ),
      MeshTopology.TRIANGLES,
    );
    const cylinder = expectWellFormed(
      meshOf(
        pack(CylindricalShellSchema, {
          radius: 0.45,
          length: 6,
          zCenter: 1,
          thickness: 0.02,
          segments: 32,
        }),
      ),
      MeshTopology.TRIANGLES,
    );
    const z = worldPositions(cylinder).map((point) => point[2]!);
    near(Math.min(...z), -2);
    near(Math.max(...z), 4);
  });

  it("builds the acme.demo SaddleCoil plugin shape as a loop on its cylinder", () => {
    const saddle = mockSchema.getMessage("acme.demo.v1.SaddleCoil")!;
    const mesh = expectWellFormed(
      meshOf(
        anyPack(
          saddle,
          create(saddle, {
            width: 0.4,
            height: 0.8,
            toroidalExtent: 0.6,
            majorRadius: 5.5,
          }),
        ),
      ),
      MeshTopology.LINE_LOOP,
    );
    for (const point of worldPositions(mesh)) {
      near(radius(point), 5.5);
      near(Math.abs(point[2]!), 0.4);
      expect(Math.abs(Math.atan2(point[1]!, point[0]!))).toBeLessThan(0.3001);
    }
  });

  it("reports a shape type without a tessellator", () => {
    expect(tessellateShape(pack(Point3Schema, {}), registry)).toEqual({
      error: "No tessellator for nebula.core.v1.Point3",
    });
  });
});

describe("checkGeometry", () => {
  const circle = pack(CircularFilamentSchema, { majorRadius: 2 });
  const lead = (points: [number, number, number][], closed = false) =>
    pack(PolylineFilamentSchema, {
      points: points.map(([x, y, z]) => ({ x, y, z })),
      closed,
    });

  function check(
    init: {
      symmetry?: MessageInitShape<typeof SymmetrySchema>;
      circuits?: MessageInitShape<typeof CircuitSchema>[];
    },
    shapes: Record<string, Any>,
  ) {
    const geometry: Geometry = create(GeometrySchema, {
      symmetry: { axisymmetric: true, fieldPeriods: 1 },
      components: Object.keys(shapes).map((id) => componentRef(id)),
      ...init,
    });
    return checkGeometry(geometry, (id) => shapes[id], registry).map(
      ({ severity, path, message }) => ({ severity, path, message }),
    );
  }

  const circuit = (...ids: string[]) => ({
    circuits: [
      {
        id: "ckt-1",
        name: "Main",
        members: ids.map((componentId) => ({ componentId, turns: 1 })),
      },
    ],
  });

  it("flags a circuit whose open lead leaves free ends (D145)", () => {
    const issues = check(circuit("a"), {
      a: lead([
        [0, 0, 0],
        [1, 0, 0],
      ]),
    });
    expect(issues).toEqual([
      expect.objectContaining({
        severity: IssueSeverity.ERROR,
        path: "circuits/ckt-1",
        message: expect.stringMatching(
          /^Filament circuit "Main" is not closed.*add leads \(D145\)$/,
        ),
      }),
    ]);
  });

  it("never treats an open lead of fewer than two points as closed (D145)", () => {
    for (const points of [[], [[0, 0, 0]]] as [number, number, number][][]) {
      expect(check(circuit("a"), { a: lead(points) })).toEqual([
        expect.objectContaining({
          severity: IssueSeverity.ERROR,
          path: "circuits/ckt-1",
          message:
            'Filament circuit "Main" is not closed: member a is an open lead of fewer than two points (D145)',
        }),
      ]);
    }
  });

  it("accepts open leads joined end to end within 1e-6 m, and closed loops", () => {
    expect(
      check(circuit("a", "b"), {
        a: lead([
          [0, 0, 0],
          [1, 0, 0],
          [1, 1, 0],
        ]),
        b: lead([
          [1, 1, 0],
          [0, 1, 0],
          [0, 0, 4e-7],
        ]),
      }),
    ).toEqual([]);
    expect(
      check(circuit("a", "c"), {
        a: lead(
          [
            [0, 0, 0],
            [1, 0, 0],
            [1, 1, 0],
          ],
          true,
        ),
        c: circle,
      }),
    ).toEqual([]);
  });

  it("joins ends within 1e-6 m only", () => {
    const pair = (gap: [number, number]) =>
      check(circuit("a", "b"), {
        a: lead([
          [0, 0, gap[0]],
          [1, 0, 0],
        ]),
        b: lead([
          [1, 0, 0],
          [0, 0, gap[1]],
        ]),
      });
    // 0.9e-6 m apart, across a 1e-6 grid line: still one node.
    expect(pair([6e-7, -3e-7])).toEqual([]);
    expect(pair([0, 2e-6])).toEqual([
      expect.objectContaining({
        message: expect.stringMatching(/is not closed/),
      }),
    ]);
  });

  it("counts a lead listed twice once, and flags the duplicate", () => {
    const issues = check(circuit("a", "a"), {
      a: lead([
        [0, 0, 0],
        [1, 0, 0],
      ]),
    });
    expect(issues.map((i) => i.message)).toEqual([
      "Member a is listed more than once (D114)",
      expect.stringMatching(/^Filament circuit "Main" is not closed/),
    ]);
  });

  it("requires symmetry metadata (D94) and N_fp >= 1 off axisymmetry", () => {
    expect(check({ symmetry: undefined }, {})).toEqual([
      expect.objectContaining({
        severity: IssueSeverity.ERROR,
        path: "symmetry",
      }),
    ]);
    expect(
      check({ symmetry: { axisymmetric: false, fieldPeriods: 0 } }, {}),
    ).toEqual([
      expect.objectContaining({
        severity: IssueSeverity.ERROR,
        path: "symmetry",
      }),
    ]);
  });

  it("rejects members that are not in the geometry or do not carry current (D114)", () => {
    const spline = pack(SplineCurveSchema, {
      controlPoints: [{ x: 1 }, { x: 2 }],
    });
    const issues = check(circuit("s", "missing"), { s: spline });
    expect(issues).toEqual([
      expect.objectContaining({
        severity: IssueSeverity.ERROR,
        path: "circuits/ckt-1",
        message: "Member s does not carry current (D114)",
      }),
      expect.objectContaining({
        severity: IssueSeverity.ERROR,
        path: "circuits/ckt-1",
        message: "Member missing is not a component of this geometry",
      }),
    ]);
  });

  it("accepts plugin shapes marked current-carrying", () => {
    const saddle = mockSchema.getMessage("acme.demo.v1.SaddleCoil")!;
    expect(
      check(circuit("s"), {
        s: anyPack(saddle, create(saddle, { majorRadius: 1 })),
      }),
    ).toEqual([]);
  });

  it("warns about an empty circuit and a Fourier surface off the geometry's N_fp", () => {
    const issues = check(
      {
        symmetry: { axisymmetric: false, fieldPeriods: 5 },
        circuits: [{ id: "ckt-empty", name: "Empty" }],
      },
      {
        plasma: pack(FourierSurfaceSchema, {
          modes: [{ rmnc: 5 }],
          fieldPeriods: 4,
        }),
      },
    );
    expect(issues).toEqual([
      expect.objectContaining({
        severity: IssueSeverity.WARNING,
        path: "components/plasma",
      }),
      expect.objectContaining({
        severity: IssueSeverity.WARNING,
        path: "circuits/ckt-empty",
      }),
    ]);
  });
});

describe("fixture geometries", () => {
  it.each(conceptKits.map((kit) => [kit.name, kit.id]))(
    "the %s starter geometry tessellates without errors or issues",
    (_, conceptId) => {
      const store = new MockStore("1");
      const template = store.templates.find(
        (t) => t.concept?.conceptId === conceptId,
      )!;
      const project = store.createProject("Starter", "", template.id)!;
      const tessellation = store.tessellation(project.id, "geo-main")!;
      expect(tessellation.components.length).toBeGreaterThan(1);
      for (const component of tessellation.components) {
        expect(component.error).toBe("");
        expect(component.mesh?.positions.byteLength).toBeGreaterThan(0);
        expect(component.revision).toBe(1);
      }
      expect(tessellation.issues).toEqual([]);
      expect(store.materialList(project.id).length).toBeGreaterThan(0);
    },
  );

  it("the baseline assembly flags only its open feed circuit", () => {
    const store = new MockStore("1");
    const tessellation = store.tessellation("p-baseline", "geo-main")!;
    expect(
      tessellation.components.map((c) => [c.componentId, c.error]),
    ).toEqual([
      ["cmp-pf1", ""],
      ["cmp-pf2", ""],
      ["cmp-saddle", ""],
      ["cmp-vessel", ""],
      ["cmp-feed", ""],
      ["cmp-limiter", ""],
    ]);
    expect(tessellation.issues).toEqual([
      expect.objectContaining({
        severity: IssueSeverity.ERROR,
        path: "circuits/ckt-feed",
        message: expect.stringContaining(
          'Filament circuit "Feed" is not closed',
        ),
      }),
    ]);
  });

  it("the alternative assembly lacks symmetry", () => {
    const store = new MockStore("1");
    const tessellation = store.tessellation("p-baseline", "geo-alt")!;
    expect(tessellation.components).toEqual([]);
    expect(tessellation.issues.map((i) => i.path)).toEqual(["symmetry"]);
  });
});
