import type {
  ComponentTessellation,
  Geometry,
  Symmetry,
} from "../../gen/nebula/core/v1/geometry_pb";

// Pure helpers behind the viewport: working out symmetry replicas. Kept free
// of three.js so they test without WebGL.

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
