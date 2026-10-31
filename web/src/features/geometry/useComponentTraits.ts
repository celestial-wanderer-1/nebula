import { useQueries } from "@tanstack/react-query";
import { draftQueryOptions } from "../../api/entities";
import { unpackComponent } from "../../entities/content";
import { EntityKind } from "../../gen/nebula/core/v1/entity_pb";
import type { ComponentTraits } from "../../gen/nebula/core/v1/options_pb";
import { componentTraitsOf } from "../../schema/annotations";
import { useSchema } from "../../schema/context";

/**
 * Shape traits of each component, read from its draft (the list does not
 * name the shape type). A reference pinned to a version is assumed to keep
 * the draft's shape type. `pending` while any draft is loading.
 */
export function useComponentTraits(
  projectId: string,
  componentIds: readonly string[],
): { traits: ReadonlyMap<string, ComponentTraits>; pending: boolean } {
  const { typeRegistry } = useSchema();
  return useQueries({
    queries: componentIds.map((id) =>
      draftQueryOptions(projectId, EntityKind.COMPONENT, id),
    ),
    combine: (results) => {
      const traits = new Map<string, ComponentTraits>();
      results.forEach((result, index) => {
        const desc =
          result.data &&
          unpackComponent(result.data.content, typeRegistry).shapeDesc;
        if (desc) traits.set(componentIds[index]!, componentTraitsOf(desc));
      });
      return { traits, pending: results.some((result) => result.isPending) };
    },
  });
}
