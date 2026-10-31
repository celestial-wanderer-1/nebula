import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ListRunOutputsResponseSchema } from "../gen/nebula/core/v1/output_pb";
import {
  ListRunsResponseSchema,
  RerunRequestSchema,
  RunActionRequestSchema,
  RunSchema,
  SubmitRunRequestSchema,
  SubmitRunResponseSchema,
  type DeterminismMode,
  type RunAction,
} from "../gen/nebula/core/v1/run_pb";
import { apiJson, jsonBody } from "./client";
import { queryKeys } from "./queryKeys";

export const runsPath = (projectId: string) =>
  `/projects/${encodeURIComponent(projectId)}/runs`;

export const runPath = (projectId: string, runId: string) =>
  `${runsPath(projectId)}/${encodeURIComponent(runId)}`;

/** The project's Runs, newest first (A§13.2). */
export function useRuns(projectId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.runs(projectId ?? ""),
    queryFn: ({ signal }) =>
      apiJson(runsPath(projectId ?? ""), ListRunsResponseSchema, { signal }),
    select: (response) => response.runs,
    enabled: Boolean(projectId),
  });
}

/** Committed outputs of a Run (D122). */
export function useRunOutputs(
  projectId: string | undefined,
  runId: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.runOutputs(projectId ?? "", runId ?? ""),
    queryFn: ({ signal }) =>
      apiJson(
        `${runPath(projectId ?? "", runId ?? "")}/outputs`,
        ListRunOutputsResponseSchema,
        { signal },
      ),
    select: (response) => response.outputs,
    enabled: Boolean(projectId && runId),
  });
}

export function useRun(
  projectId: string | undefined,
  runId: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.run(projectId ?? "", runId ?? ""),
    queryFn: ({ signal }) =>
      apiJson(runPath(projectId ?? "", runId ?? ""), RunSchema, { signal }),
    enabled: Boolean(projectId && runId),
  });
}

export interface SubmitOptions {
  gpus: number;
  mode: DeterminismMode;
}

/**
 * What submitting the workflow would do (A§3.4, A§13.5): the drafts it
 * mints, the steps the cache serves, the GPU counts allowed and any
 * blocking issues. Keyed on the draft revision, so it follows edits.
 */
export function useSubmitPreview(
  projectId: string,
  workflowId: string,
  revision: number | undefined,
  { gpus, mode }: SubmitOptions,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [
      projectId,
      "runs",
      "preview",
      workflowId,
      revision ?? 0,
      gpus,
      mode,
    ],
    queryFn: ({ signal }) =>
      apiJson(runsPath(projectId), SubmitRunResponseSchema, {
        method: "POST",
        signal,
        ...jsonBody(SubmitRunRequestSchema, {
          workflowId,
          gpus,
          mode,
          dryRun: true,
        }),
      }),
    enabled: enabled && revision !== undefined,
    placeholderData: keepPreviousData,
  });
}

/** Submits the workflow's draft; versions are minted server-side. */
export function useSubmitRun(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: MessageInitShape<typeof SubmitRunRequestSchema>) =>
      apiJson(runsPath(projectId), SubmitRunResponseSchema, {
        method: "POST",
        ...jsonBody(SubmitRunRequestSchema, { ...request, dryRun: false }),
      }),
    onSuccess: (response) => {
      if (response.run) {
        queryClient.setQueryData(
          queryKeys.run(projectId, response.run.id),
          response.run,
        );
      }
      // Submission minted versions; their entities were told by events.
      return queryClient.invalidateQueries({
        queryKey: queryKeys.runs(projectId),
      });
    },
  });
}

/** Pause, resume, cancel or discard (A§14.1). */
export function useRunAction(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, action }: { runId: string; action: RunAction }) =>
      apiJson(`${runPath(projectId, runId)}/actions`, RunSchema, {
        method: "POST",
        ...jsonBody(RunActionRequestSchema, { action }),
      }),
    onSuccess: (run) => {
      queryClient.setQueryData(queryKeys.run(projectId, run.id), run);
      return queryClient.invalidateQueries({
        queryKey: queryKeys.runs(projectId),
        exact: true,
      });
    },
  });
}

/** Re-runs with the same pinned inputs or the latest versions (D101). */
export function useRerun(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      runId,
      ...request
    }: { runId: string } & MessageInitShape<typeof RerunRequestSchema>) =>
      apiJson(`${runPath(projectId, runId)}/rerun`, RunSchema, {
        method: "POST",
        ...jsonBody(RerunRequestSchema, request),
      }),
    onSuccess: (run) => {
      queryClient.setQueryData(queryKeys.run(projectId, run.id), run);
      return queryClient.invalidateQueries({
        queryKey: queryKeys.runs(projectId),
        exact: true,
      });
    },
  });
}
