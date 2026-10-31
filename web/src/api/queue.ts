import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ListQueueResponseSchema,
  ReorderQueueRequestSchema,
} from "../gen/nebula/core/v1/queue_pb";
import { RunSchema } from "../gen/nebula/core/v1/run_pb";
import { apiFetch, apiJson, jsonBody } from "./client";
import { queryKeys } from "./queryKeys";

/**
 * The FIFO queue shared across projects (D100, D102). The queue channel
 * overwrites it as it changes (ws/channels.ts).
 */
export function useQueue() {
  return useQuery({
    queryKey: queryKeys.queue(),
    queryFn: ({ signal }) =>
      apiJson("/queue", ListQueueResponseSchema, { signal }),
    select: (response) => response.entries,
  });
}

export function useReorderQueue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: { runId: string; position: number }) =>
      apiFetch("/queue/reorder", {
        method: "POST",
        ...jsonBody(ReorderQueueRequestSchema, request),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.queue() }),
  });
}

/** Cancels a Run from the queue, whatever project it belongs to. */
export function useCancelQueued() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) =>
      apiJson(`/queue/${encodeURIComponent(runId)}/cancel`, RunSchema, {
        method: "POST",
      }),
    onSuccess: (run) => {
      queryClient.setQueryData(queryKeys.run(run.projectId, run.id), run);
      return queryClient.invalidateQueries({ queryKey: queryKeys.queue() });
    },
  });
}
