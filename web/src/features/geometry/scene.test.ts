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
  meshRevisions,
  replicaCounts,
  replicaRotations,
  replicatedComponents,
} from "./scene";

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
