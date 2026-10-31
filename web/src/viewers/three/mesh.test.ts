import { describe, expect, it } from "vitest";
import { MeshTopology } from "../../gen/nebula/core/v1/geometry_pb";
import { encodeMesh } from "../../mocks/tessellate";
import { decodeMesh } from "./mesh";

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
