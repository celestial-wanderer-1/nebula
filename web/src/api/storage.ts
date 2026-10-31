import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DeleteResultsRequestSchema,
  DeleteResultsResponseSchema,
  DependentsResponseSchema,
  EvictRequestSchema,
  EvictResponseSchema,
  StorageUsageSchema,
  type StorageClass,
} from "../gen/nebula/core/v1/storage_pb";
import { apiJson, jsonBody } from "./client";
import { queryKeys } from "./queryKeys";

const path = (projectId: string) =>
  `/projects/${encodeURIComponent(projectId)}/storage`;

export function useStorage(projectId: string) {
  return useQuery({
    queryKey: queryKeys.storage(projectId),
    queryFn: ({ signal }) =>
      apiJson(path(projectId), StorageUsageSchema, { signal }),
  });
}

/** What refers to a Run's outputs, checked before deleting them (D141). */
export function useDependents(projectId: string, runId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.dependents(projectId, runId ?? ""),
    queryFn: ({ signal }) =>
      apiJson(
        `${path(projectId)}/dependents?${new URLSearchParams({ run: runId ?? "" }).toString()}`,
        DependentsResponseSchema,
        { signal },
      ),
    select: (response) => response.dependents,
    enabled: Boolean(runId),
  });
}

export function useEvict(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (classes: StorageClass[]) =>
      apiJson(`${path(projectId)}/evict`, EvictResponseSchema, {
        method: "POST",
        ...jsonBody(EvictRequestSchema, { classes }),
      }),
    onSuccess: (response) =>
      queryClient.setQueryData(queryKeys.storage(projectId), response.usage),
  });
}

export function useDeleteResults(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: {
      runIds: string[];
      acknowledgeDependents: boolean;
    }) =>
      apiJson(`${path(projectId)}/delete`, DeleteResultsResponseSchema, {
        method: "POST",
        ...jsonBody(DeleteResultsRequestSchema, request),
      }),
    onSuccess: (response) => {
      queryClient.setQueryData(queryKeys.storage(projectId), response.usage);
      for (const runId of response.deleted) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.runOutputs(projectId, runId),
        });
      }
    },
  });
}
