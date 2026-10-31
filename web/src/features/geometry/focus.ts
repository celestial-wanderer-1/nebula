import type { Circuit } from "../../gen/nebula/core/v1/geometry_pb";

// DOM ids of assembly tree controls, so the property panel can move focus
// into the tree when the item it shows goes away.

export const circuitRowId = (geometryId: string, circuitId: string) =>
  `assembly-${geometryId}-circuit-${circuitId}`;

export const newCircuitButtonId = (geometryId: string) =>
  `assembly-${geometryId}-new-circuit`;

/**
 * Before a circuit is deleted: focus the tree row of a neighbouring circuit,
 * else "New circuit", so focus never falls back to the document.
 */
export function focusCircuitNeighbour(
  geometryId: string,
  circuits: readonly Circuit[],
  circuitId: string,
): void {
  const index = circuits.findIndex((circuit) => circuit.id === circuitId);
  const neighbour = circuits[index + 1] ?? circuits[index - 1];
  (
    (neighbour &&
      document.getElementById(circuitRowId(geometryId, neighbour.id))) ??
    document.getElementById(newCircuitButtonId(geometryId))
  )?.focus();
}
