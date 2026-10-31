import type { Any } from "@bufbuild/protobuf/wkt";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import {
  CreateEntityRequestSchema,
  EntityDraftSchema,
  EntityKind,
  EntityVersionSchema,
  ListEntitiesResponseSchema,
  ListVersionsResponseSchema,
  UpdateDraftRequestSchema,
  type EntityDraft,
  type ListEntitiesResponse,
  type UpdateDraftRequest,
} from "../gen/nebula/core/v1/entity_pb";
import { apiFetch, apiJson, jsonBody } from "./client";
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
 * The draft query. Every reader of a draft uses it, so they share one cache
 * entry and a response older than the held draft is dropped (A§3.3, D148).
 */
export function draftQueryOptions(
  projectId: string,
  kind: EntityKind,
  id: string,
) {
  return queryOptions({
    queryKey: queryKeys.draft(projectId, kind, id),
    queryFn: ({ signal }) => fetchDraft(projectId, kind, id, signal),
    structuralSharing: (held: unknown, incoming: unknown) =>
      newerDraft(held as EntityDraft | undefined, incoming as EntityDraft),
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

/** Creates an entity; the server returns its first draft (revision 1). */
export function createEntity(
  projectId: string,
  kind: EntityKind,
  name: string,
  content?: Any,
): Promise<EntityDraft> {
  return apiJson(entityCollectionPath(projectId, kind), EntityDraftSchema, {
    method: "POST",
    ...jsonBody(CreateEntityRequestSchema, { name, content }),
  });
}

/** Deletes an entity. A component still in a geometry fails with 409. */
export async function deleteEntity(
  projectId: string,
  kind: EntityKind,
  id: string,
): Promise<void> {
  await apiFetch(entityPath(projectId, kind, id), { method: "DELETE" });
}

export function useCreateEntity(projectId: string, kind: EntityKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, content }: { name: string; content?: Any }) =>
      createEntity(projectId, kind, name, content),
    onSuccess: (draft) => {
      putDraftIfNewer(
        queryClient,
        queryKeys.draft(projectId, kind, draft.id),
        draft,
      );
      return queryClient.invalidateQueries({
        queryKey: queryKeys.entities(projectId, kind),
      });
    },
  });
}

export function useDeleteEntity(projectId: string, kind: EntityKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteEntity(projectId, kind, id),
    onSuccess: (_, id) => {
      queryClient.removeQueries({
        queryKey: queryKeys.entity(projectId, kind, id),
      });
      return queryClient.invalidateQueries({
        queryKey: queryKeys.entities(projectId, kind),
      });
    },
  });
}

/**
 * Applies a client's own save to the cached entity list without a refetch,
 * so list revisions (and the tessellation fingerprint) track it. An older
 * draft never lowers the listed revision (D148).
 */
export function patchSummary(
  queryClient: QueryClient,
  projectId: string,
  draft: EntityDraft,
): void {
  queryClient.setQueryData<ListEntitiesResponse>(
    queryKeys.entities(projectId, draft.kind),
    (held) => {
      const entry = held?.entities.find((entity) => entity.id === draft.id);
      if (
        !held ||
        !entry ||
        entry.revision > draft.revision ||
        (entry.revision === draft.revision && entry.name === draft.name)
      ) {
        return held;
      }
      return {
        ...held,
        entities: held.entities.map((entity) =>
          entity === entry
            ? { ...entity, name: draft.name, revision: draft.revision }
            : entity,
        ),
      };
    },
  );
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

/**
 * One version with its content, in which every reference is pinned
 * (A§4.2). Versions never change, so the query never refetches.
 */
export function useEntityVersion(
  projectId: string | undefined,
  kind: EntityKind,
  id: string | undefined,
  hash: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.entityVersion(
      projectId ?? "",
      kind,
      id ?? "",
      hash ?? "",
    ),
    queryFn: ({ signal }) =>
      apiJson(
        `${entityPath(projectId ?? "", kind, id ?? "")}/versions/${encodeURIComponent(hash ?? "")}`,
        EntityVersionSchema,
        { signal },
      ),
    enabled: Boolean(projectId && id && hash),
    staleTime: Infinity,
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
