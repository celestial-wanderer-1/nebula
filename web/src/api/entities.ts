import {
  useQuery,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import {
  EntityDraftSchema,
  EntityKind,
  ListEntitiesResponseSchema,
  ListVersionsResponseSchema,
  UpdateDraftRequestSchema,
  type EntityDraft,
  type UpdateDraftRequest,
} from "../gen/nebula/core/v1/entity_pb";
import { apiJson, jsonBody } from "./client";
import { queryKeys } from "./queryKeys";

// Path segment of each entity kind under /projects/{p} (A§13.2).
export const ENTITY_SEGMENTS: Readonly<Record<EntityKind, string>> = {
  [EntityKind.UNSPECIFIED]: "",
  [EntityKind.GEOMETRY]: "geometries",
  [EntityKind.COMPONENT]: "components",
  [EntityKind.REGION]: "regions",
  [EntityKind.SCENARIO]: "scenarios",
  [EntityKind.CONDUCTOR_NETWORK]: "conductor-networks",
  [EntityKind.WORKFLOW]: "workflows",
};

export function entityCollectionPath(
  projectId: string,
  kind: EntityKind,
): string {
  const segment = ENTITY_SEGMENTS[kind];
  if (!segment) {
    throw new Error(`No API path for entity kind ${kind}`);
  }
  return `/projects/${encodeURIComponent(projectId)}/${segment}`;
}

export function entityPath(
  projectId: string,
  kind: EntityKind,
  id: string,
): string {
  return `${entityCollectionPath(projectId, kind)}/${encodeURIComponent(id)}`;
}

export function useEntities(projectId: string | undefined, kind: EntityKind) {
  return useQuery({
    queryKey: queryKeys.entities(projectId ?? "", kind),
    queryFn: ({ signal }) =>
      apiJson(
        entityCollectionPath(projectId ?? "", kind),
        ListEntitiesResponseSchema,
        { signal },
      ),
    select: (response) => response.entities,
    enabled: Boolean(projectId) && kind !== EntityKind.UNSPECIFIED,
  });
}

export function fetchDraft(
  projectId: string,
  kind: EntityKind,
  id: string,
  signal?: AbortSignal,
): Promise<EntityDraft> {
  return apiJson(entityPath(projectId, kind, id), EntityDraftSchema, {
    signal,
  });
}

/**
 * Conditional draft update (D148). Sends the revision the edit was based on;
 * a stale revision fails with `DraftConflictError`.
 */
export function updateDraft(
  projectId: string,
  kind: EntityKind,
  id: string,
  baseRevision: number,
  request: Omit<UpdateDraftRequest, "$typeName">,
): Promise<EntityDraft> {
  return apiJson(entityPath(projectId, kind, id), EntityDraftSchema, {
    method: "PATCH",
    ...jsonBody(UpdateDraftRequestSchema, request),
    headers: {
      "Content-Type": "application/json",
      "If-Match": `"${baseRevision}"`,
    },
  });
}

export function useVersions(
  projectId: string | undefined,
  kind: EntityKind,
  id: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.versions(projectId ?? "", kind, id ?? ""),
    queryFn: ({ signal }) =>
      apiJson(
        `${entityPath(projectId ?? "", kind, id ?? "")}/versions`,
        ListVersionsResponseSchema,
        { signal },
      ),
    enabled: Boolean(projectId && id),
  });
}

/** Keeps the newer of two drafts, so stale responses never win (D148). */
export function newerDraft(
  held: EntityDraft | undefined,
  incoming: EntityDraft,
): EntityDraft {
  return held && held.revision >= incoming.revision ? held : incoming;
}

/** Writes a draft into the cache unless the cache holds a newer revision. */
export function putDraftIfNewer(
  queryClient: QueryClient,
  key: QueryKey,
  draft: EntityDraft,
): void {
  queryClient.setQueryData<EntityDraft>(key, (held) => newerDraft(held, draft));
}
