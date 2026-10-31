import { MeshTopology, type Mesh } from "../../gen/nebula/core/v1/geometry_pb";

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
  const bytes = mesh.positions;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const origin: DecodedMesh["origin"] = [
    mesh.origin?.x ?? 0,
    mesh.origin?.y ?? 0,
    mesh.origin?.z ?? 0,
  ];
  const count = Math.floor(bytes.byteLength / 12) * 3;
  const positions = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i] = view.getFloat32(i * 4, true);
  }
  if (mesh.topology !== MeshTopology.TRIANGLES || mesh.indices.length === 0) {
    return { topology: mesh.topology, origin, positions };
  }
  const indexBytes = mesh.indices;
  const indexView = new DataView(
    indexBytes.buffer,
    indexBytes.byteOffset,
    indexBytes.byteLength,
  );
  const indices = new Uint32Array(Math.floor(indexBytes.byteLength / 4));
  for (let i = 0; i < indices.length; i++) {
    indices[i] = indexView.getUint32(i * 4, true);
  }
  return { topology: mesh.topology, origin, positions, indices };
}
