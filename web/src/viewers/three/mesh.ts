import { MeshTopology, type Mesh } from "../../gen/nebula/core/v1/geometry_pb";
import { float32s, uint32s } from "../binary";

// Decoding of browser meshes (geometry tessellations, region previews).
// Free of three.js so it tests without WebGL.

export interface DecodedMesh {
  topology: MeshTopology;
  /** The local origin of `positions`, in the global frame (D156). */
  origin: [number, number, number];
  /** x, y, z relative to `origin`, as sent. */
  positions: Float32Array;
  /** Triangle indices; unset for lines. */
  indices?: Uint32Array;
}

/**
 * Decodes a tessellation mesh: little-endian float32 positions relative to
 * `origin`, little-endian uint32 indices. Positions stay relative: the
 * viewer places the object at the origin, in double precision, so large
 * global coordinates keep their float32 precision (D156).
 */
export function decodeMesh(mesh: Mesh): DecodedMesh {
  const origin: DecodedMesh["origin"] = [
    mesh.origin?.x ?? 0,
    mesh.origin?.y ?? 0,
    mesh.origin?.z ?? 0,
  ];
  const positions = float32s(
    mesh.positions,
    Math.floor(mesh.positions.byteLength / 12) * 3,
  );
  if (mesh.topology !== MeshTopology.TRIANGLES || mesh.indices.length === 0) {
    return { topology: mesh.topology, origin, positions };
  }
  return {
    topology: mesh.topology,
    origin,
    positions,
    indices: uint32s(mesh.indices),
  };
}
