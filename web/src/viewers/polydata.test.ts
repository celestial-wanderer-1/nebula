import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { ViewPayloadSchema, ViewerKind } from "../gen/nebula/core/v1/view_pb";
import { cells, f32 } from "../mocks/views/encode";
import { writeGlb } from "../mocks/views/glb";
import { GltfError, parseGlb } from "./gltf";
import { cellCount, decodeScene } from "./polydata";

describe("decodeScene (D156)", () => {
  it("keeps float32 points relative to the origin", () => {
    const payload = create(ViewPayloadSchema, {
      viewer: ViewerKind.CONTOUR_2D,
      origin: { x: 6.2, y: 0, z: 0 },
      body: {
        case: "polydata",
        value: {
          pieces: [
            {
              name: "psi",
              points: f32([-0.5, 0, 1, 0.5, 0, 1, 0, 0, 2]),
              polys: cells([[0, 1, 2]]),
              lines: cells([
                [0, 1],
                [1, 2],
              ]),
              pointData: [
                {
                  name: "psi_n",
                  components: 1,
                  values: f32([0, 0.5, 1]),
                  rangeMin: 0,
                  rangeMax: 1,
                },
              ],
              activeScalars: "psi_n",
            },
          ],
        },
      },
    });
    const scene = decodeScene(payload)!;
    expect(scene.origin).toEqual([6.2, 0, 0]);
    const piece = scene.pieces[0]!;
    // The origin is the actor's position; it is never added to the points.
    expect(Array.from(piece.points.slice(0, 3))).toEqual([-0.5, 0, 1]);
    expect(cellCount(piece.polys)).toBe(1);
    expect(cellCount(piece.lines)).toBe(2);
    expect(piece.verts).toBeUndefined();
    expect(piece.pointData[0]).toMatchObject({ name: "psi_n", range: [0, 1] });
  });

  it("turns glTF triangles into a piece", () => {
    const glb = writeGlb(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      new Uint32Array([0, 1, 2]),
    );
    const scene = decodeScene(
      create(ViewPayloadSchema, { body: { case: "gltf", value: { glb } } }),
    )!;
    expect(Array.from(scene.pieces[0]!.polys!)).toEqual([3, 0, 1, 2]);
  });
});

describe("parseGlb (D117)", () => {
  it("reads positions and indices", () => {
    const mesh = parseGlb(
      writeGlb(
        new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]),
        new Uint32Array([2, 1, 0]),
      ),
    );
    expect(Array.from(mesh.positions)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(Array.from(mesh.indices)).toEqual([2, 1, 0]);
  });

  it("refuses external URIs", () => {
    const glb = writeGlb(new Float32Array([0, 0, 0]), new Uint32Array([0]));
    // Rewrite the JSON chunk to point the buffer at a URL.
    const view = new DataView(glb.buffer);
    const length = view.getUint32(12, true);
    const json = JSON.parse(
      new TextDecoder().decode(glb.subarray(20, 20 + length)).trim(),
    ) as {
      buffers: { uri?: string }[];
    };
    json.buffers[0]!.uri = "https://example.com/data.bin";
    const text = new TextEncoder().encode(JSON.stringify(json));
    const padded = new Uint8Array((text.length + 3) & ~3).fill(0x20);
    padded.set(text);
    const out = new Uint8Array(20 + padded.length + (glb.length - 20 - length));
    out.set(glb.subarray(0, 20));
    new DataView(out.buffer).setUint32(12, padded.length, true);
    out.set(padded, 20);
    out.set(glb.subarray(20 + length), 20 + padded.length);
    expect(() => parseGlb(out)).toThrow(GltfError);
    expect(() => parseGlb(out)).toThrow(/external URI/);
    expect(() => parseGlb(new Uint8Array(4))).toThrow("Not a binary glTF");
  });
});
