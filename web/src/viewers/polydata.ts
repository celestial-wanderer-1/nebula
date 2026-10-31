import type { ViewPayload, VtkPolyData } from "../gen/nebula/core/v1/view_pb";
import { parseGlb } from "./gltf";
import { float32s, uint32s } from "./binary";

// Decoding of vtk.js payloads (view.proto): float32 points relative to the
// payload origin and VTK cell arrays. Free of vtk.js, so it tests without
// WebGL; the canvas builds vtk objects from the result.

export interface DecodedArray {
  name: string;
  components: number;
  values: Float32Array;
  range: [number, number];
  unit: string;
}

export interface DecodedPiece {
  name: string;
  /** x, y, z relative to the payload origin (D156). */
  points: Float32Array;
  verts?: Uint32Array;
  lines?: Uint32Array;
  polys?: Uint32Array;
  pointData: DecodedArray[];
  activeScalars: string;
}

export interface DecodedScene {
  /** Where the pieces sit in the global frame: the actor's position. */
  origin: [number, number, number];
  pieces: DecodedPiece[];
}

/** Reads little-endian float32 values from bytes at any offset. */
export const readF32 = (bytes: Uint8Array): Float32Array => float32s(bytes);

export const readU32 = (bytes: Uint8Array): Uint32Array => uint32s(bytes);

const cellsOrUndefined = (bytes: Uint8Array) =>
  bytes.byteLength ? readU32(bytes) : undefined;

export function decodePiece(piece: VtkPolyData): DecodedPiece {
  return {
    name: piece.name,
    points: readF32(piece.points),
    verts: cellsOrUndefined(piece.verts),
    lines: cellsOrUndefined(piece.lines),
    polys: cellsOrUndefined(piece.polys),
    pointData: piece.pointData.map((array) => ({
      name: array.name,
      components: array.components || 1,
      values: readF32(array.values),
      range: [array.rangeMin, array.rangeMax],
      unit: array.unit,
    })),
    activeScalars: piece.activeScalars,
  };
}

/** Number of cells in a VTK cell array. */
export function cellCount(cells: Uint32Array | undefined): number {
  let count = 0;
  for (let i = 0; cells && i < cells.length; i += (cells[i] ?? 0) + 1) count++;
  return count;
}

/**
 * The drawable scene of a vtk.js or glTF payload. glTF triangles become one
 * piece; the origin is never added to the float32 points (D156).
 */
export function decodeScene(payload: ViewPayload): DecodedScene | undefined {
  const origin: [number, number, number] = [
    payload.origin?.x ?? 0,
    payload.origin?.y ?? 0,
    payload.origin?.z ?? 0,
  ];
  switch (payload.body.case) {
    case "polydata":
      return { origin, pieces: payload.body.value.pieces.map(decodePiece) };
    case "gltf": {
      const mesh = parseGlb(payload.body.value.glb);
      const polys = new Uint32Array((mesh.indices.length / 3) * 4);
      for (let t = 0; t < mesh.indices.length / 3; t++) {
        polys.set(
          [
            3,
            mesh.indices[t * 3]!,
            mesh.indices[t * 3 + 1]!,
            mesh.indices[t * 3 + 2]!,
          ],
          t * 4,
        );
      }
      return {
        origin,
        pieces: [
          {
            name: "isosurface",
            points: mesh.positions,
            polys,
            pointData: [],
            activeScalars: "",
          },
        ],
      };
    }
    default:
      return undefined;
  }
}
