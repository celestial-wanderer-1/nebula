import {
  MeshTopology,
  type ComponentTessellation,
  type Geometry,
  type Mesh,
  type Symmetry,
} from "../../gen/nebula/core/v1/geometry_pb";

// Pure helpers behind the viewport: decoding tessellation bytes and working
// out symmetry replicas. Kept free of three.js so they test without WebGL.

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

/**
 * Rotation angles about z of a replicated component's copies over the field
 * periods, excluding the original at 0. Empty unless N_fp > 1 (D94).
 */
export function replicaRotations(symmetry: Symmetry | undefined): number[] {
  const periods = symmetry?.fieldPeriods ?? 0;
  if (periods <= 1) return [];
  return Array.from(
    { length: periods - 1 },
    (_, k) => ((k + 1) * 2 * Math.PI) / periods,
  );
}

/**
 * Components drawn once per field period: members of circuits that
 * replicate over the periods, when the geometry has more than one (D114).
 */
export function replicatedComponents(geometry: Geometry): Set<string> {
  if ((geometry.symmetry?.fieldPeriods ?? 0) <= 1) return new Set();
  return new Set(
    geometry.circuits
      .filter((circuit) => circuit.replicateOverPeriods)
      .flatMap((circuit) =>
        circuit.members.map((member) => member.componentId),
      ),
  );
}

/**
 * "<componentId>:<revision or version hash>" of each mesh drawn, joined by
 * commas. Exposed on the viewport so tests can follow mesh updates.
 */
export function meshRevisions(
  components: readonly ComponentTessellation[],
): string {
  return components
    .filter((component) => component.mesh)
    .map(
      (component) =>
        `${component.componentId}:${component.versionHash || component.revision}`,
    )
    .join(",");
}

/**
 * "<componentId>:<replica count>" of each drawn mesh that has replicas,
 * joined by commas. Exposed on the viewport so tests can follow replicas.
 */
export function replicaCounts(
  components: readonly ComponentTessellation[],
  replicas: ReadonlyMap<string, readonly number[]>,
): string {
  return components
    .filter((component) => component.mesh)
    .map((component) => [
      component.componentId,
      replicas.get(component.componentId)?.length ?? 0,
    ])
    .filter(([, count]) => count !== 0)
    .map(([id, count]) => `${id}:${count}`)
    .join(",");
}
