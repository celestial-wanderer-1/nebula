import { useQueries } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { draftQueryOptions } from "../../api/entities";
import { usePlugins } from "../../api/plugins";
import { unpackComponent } from "../../entities/content";
import { EntityKind } from "../../gen/nebula/core/v1/entity_pb";
import {
  ExtensionKind,
  type Extension,
} from "../../gen/nebula/core/v1/plugin_pb";
import { useSchema } from "../../schema/context";

/** What a component list row shows of each draft's content. */
export interface ComponentInfo {
  shapeType: string;
  materialId: string;
  sourceName?: string;
  /** Why the draft could not be read, such as an unknown plugin shape. */
  error?: string;
}

/** The content of several component drafts, by ID; absent while loading. */
export function useComponentInfos(
  projectId: string,
  ids: readonly string[],
): ReadonlyMap<string, ComponentInfo> {
  const { typeRegistry } = useSchema();
  const drafts = useQueries({
    queries: ids.map((id) =>
      draftQueryOptions(projectId, EntityKind.COMPONENT, id),
    ),
  });
  const infos = new Map<string, ComponentInfo>();
  drafts.forEach(({ data: draft, error }, i) => {
    if (error && !draft) {
      infos.set(ids[i]!, {
        shapeType: "",
        materialId: "",
        error: error.message,
      });
    }
    if (!draft) return;
    const { component, shapeType } = unpackComponent(
      draft.content,
      typeRegistry,
    );
    infos.set(draft.id, {
      shapeType,
      materialId: component.materialId,
      sourceName: component.source
        ? component.source.entryName || component.source.entryId
        : undefined,
    });
  });
  return infos;
}

/** GEOMETRY_COMPONENT extensions of the installed plugins (A§10.1). */
export function useShapeExtensions(): {
  shapes: Extension[];
  isPending: boolean;
  error: Error | null;
} {
  const plugins = usePlugins();
  const shapes = useMemo(
    () =>
      plugins.data
        ?.flatMap((plugin) => plugin.extensions)
        .filter(
          (extension) => extension.kind === ExtensionKind.GEOMETRY_COMPONENT,
        ) ?? [],
    [plugins.data],
  );
  return { shapes, isPending: plugins.isPending, error: plugins.error };
}

/** Display name of a shape type: its extension's name, else the message's. */
export function useShapeName(): (shapeType: string) => string {
  const { shapes } = useShapeExtensions();
  return useCallback(
    (shapeType: string) =>
      shapes.find((shape) => shape.configMessage === shapeType)?.displayName ||
      shapeType.slice(shapeType.lastIndexOf(".") + 1) ||
      "None",
    [shapes],
  );
}
