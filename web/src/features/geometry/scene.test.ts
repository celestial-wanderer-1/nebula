import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import {
  ComponentTessellationSchema,
  GeometrySchema,
  MeshTopology,
  SymmetrySchema,
} from "../../gen/nebula/core/v1/geometry_pb";
import { encodeMesh } from "../../mocks/tessellate";
import {
  decodeMesh,
  meshRevisions,
  replicaCounts,
  replicaRotations,
  replicatedComponents,
} from "./scene";

describe("decodeMesh", () => {
  it("keeps triangle positions relative to the origin and decodes indices", () => {
    const points: [number, number, number][] = [
      [100, 0, 0],
      [101, 0, 0],
      [100, 1, 2],
    ];
    const mesh = encodeMesh(MeshTopology.TRIANGLES, points, [0, 1, 2]);
    expect(mesh.origin?.x).not.toBe(0);

    const decoded = decodeMesh(mesh);
    expect(decoded.topology).toBe(MeshTopology.TRIANGLES);
    expect(decoded.origin).toEqual([
      mesh.origin!.x,
      mesh.origin!.y,
      mesh.origin!.z,
    ]);
    expect(decoded.positions).toHaveLength(9);
    // Relative positions plus the origin give the global points (D156).
    points.flat().forEach((value, i) => {
      expect(decoded.positions[i]! + decoded.origin[i % 3]!).toBeCloseTo(
        value,
        4,
      );
    });
    expect(Math.abs(decoded.positions[0]!)).toBeLessThan(1);
    expect(Array.from(decoded.indices ?? [])).toEqual([0, 1, 2]);
  });

  it("decodes lines without indices", () => {
    const strip = decodeMesh(
      encodeMesh(MeshTopology.LINE_STRIP, [
        [0, 0, 1],
        [0, 2, 1],
      ]),
    );
    expect(strip.topology).toBe(MeshTopology.LINE_STRIP);
    expect(strip.indices).toBeUndefined();
    expect(strip.origin).toEqual([0, 1, 1]);
    expect(Array.from(strip.positions)).toEqual([0, -1, 0, 0, 1, 0]);

    const loop = decodeMesh(
      encodeMesh(MeshTopology.LINE_LOOP, [
        [1, 0, 0],
        [0, 1, 0],
        [-1, 0, 0],
      ]),
    );
    expect(loop.topology).toBe(MeshTopology.LINE_LOOP);
    expect(loop.positions).toHaveLength(9);
  });

  it("reads bytes at an offset into a shared buffer", () => {
    const mesh = encodeMesh(MeshTopology.LINE_STRIP, [
      [1, 2, 3],
      [4, 5, 6],
    ]);
    const padded = new Uint8Array(mesh.positions.length + 4);
    padded.set(mesh.positions, 4);
    const decoded = decodeMesh({ ...mesh, positions: padded.subarray(4) });
    expect(Array.from(decoded.positions)).toEqual([
      -1.5, -1.5, -1.5, 1.5, 1.5, 1.5,
    ]);
  });
});

describe("replicas", () => {
  it("rotates replicas over the field periods about z", () => {
    const symmetry = create(SymmetrySchema, { fieldPeriods: 5 });
    const angles = replicaRotations(symmetry);
    expect(angles).toHaveLength(4);
    angles.forEach((angle, k) =>
      expect(angle).toBeCloseTo(((k + 1) * 2 * Math.PI) / 5),
    );
  });

  it("has no replicas when axisymmetric or unset", () => {
    expect(
      replicaRotations(
        create(SymmetrySchema, { axisymmetric: true, fieldPeriods: 1 }),
      ),
    ).toEqual([]);
    expect(replicaRotations(undefined)).toEqual([]);
  });

  it("replicates members of replicating circuits only when N_fp > 1", () => {
    const circuits = [
      {
        id: "ckt-a",
        replicateOverPeriods: true,
        members: [{ componentId: "cmp-mc1" }, { componentId: "cmp-mc2" }],
      },
      { id: "ckt-b", members: [{ componentId: "cmp-pf1" }] },
    ];
    const stellarator = create(GeometrySchema, {
      symmetry: { fieldPeriods: 5 },
      circuits,
    });
    expect([...replicatedComponents(stellarator)].sort()).toEqual([
      "cmp-mc1",
      "cmp-mc2",
    ]);
    const axisymmetric = create(GeometrySchema, {
      symmetry: { axisymmetric: true, fieldPeriods: 1 },
      circuits,
    });
    expect(replicatedComponents(axisymmetric).size).toBe(0);
  });
});

describe("meshRevisions", () => {
  it("names the draft revision or version of each mesh drawn", () => {
    const mesh = encodeMesh(MeshTopology.LINE_STRIP, [
      [0, 0, 0],
      [1, 0, 0],
    ]);
    expect(
      meshRevisions([
        create(ComponentTessellationSchema, {
          componentId: "cmp-pf1",
          revision: 4,
          mesh,
        }),
        create(ComponentTessellationSchema, {
          componentId: "cmp-pf2",
          versionHash: "sha256:pf2-v1",
          mesh,
        }),
        create(ComponentTessellationSchema, {
          componentId: "cmp-bad",
          revision: 1,
          error: "No tessellator",
        }),
      ]),
    ).toBe("cmp-pf1:4,cmp-pf2:sha256:pf2-v1");
  });
});

describe("replicaCounts", () => {
  it("names the replica count of each drawn mesh that has replicas", () => {
    const mesh = encodeMesh(MeshTopology.LINE_STRIP, [
      [0, 0, 0],
      [1, 0, 0],
    ]);
    const components = ["cmp-mc1", "cmp-pf1", "cmp-bad"].map((componentId) =>
      create(ComponentTessellationSchema, {
        componentId,
        revision: 1,
        mesh: componentId === "cmp-bad" ? undefined : mesh,
      }),
    );
    const replicas = new Map([
      ["cmp-mc1", [1, 2, 3, 4]],
      ["cmp-bad", [1, 2, 3, 4]],
    ]);
    expect(replicaCounts(components, replicas)).toBe("cmp-mc1:4");
    expect(replicaCounts(components, new Map())).toBe("");
  });
});
