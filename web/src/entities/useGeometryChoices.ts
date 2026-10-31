import { useMemo } from "react";
import { useEntities } from "../api/entities";
import { EntityKind, type EntityRef } from "../gen/nebula/core/v1/entity_pb";
import type { Geometry } from "../gen/nebula/core/v1/geometry_pb";
import { IdRef } from "../gen/nebula/core/v1/options_pb";
import type { IdChoices } from "../forms/context";
import { unpackGeometry } from "./content";
import { useReferencedContent } from "./useReferencedContent";

/**
 * The geometry a setup entity references, as the reference resolves it,
 * with its components and circuits as ID choices for the entity's form
 * (D107, D114). Circuits keep their stable IDs across versions.
 */
export function useGeometryChoices(
  projectId: string,
  ref: EntityRef | undefined,
): {
  geometry: Geometry | undefined;
  choices: IdChoices;
  isPending: boolean;
  missing: boolean;
} {
  const referenced = useReferencedContent(projectId, ref);
  const components = useEntities(projectId, EntityKind.COMPONENT);
  const geometry = useMemo(
    () => (referenced.content ? unpackGeometry(referenced.content) : undefined),
    [referenced.content],
  );
  const choices = useMemo<IdChoices>(() => {
    const names = new Map(
      (components.data ?? []).map((c) => [c.id, c.name || c.id]),
    );
    return {
      [IdRef.COMPONENT]: (geometry?.components ?? []).map((component) => ({
        id: component.id,
        label: names.get(component.id) ?? component.id,
      })),
      [IdRef.CIRCUIT]: (geometry?.circuits ?? []).map((circuit) => ({
        id: circuit.id,
        label: `${circuit.name || circuit.id} (${circuit.id})`,
      })),
    };
  }, [geometry, components.data]);
  return {
    geometry,
    choices,
    isPending: referenced.isPending,
    missing: referenced.missing,
  };
}
