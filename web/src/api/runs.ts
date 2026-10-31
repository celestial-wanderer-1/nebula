import { useQuery } from "@tanstack/react-query";
import { ListRunOutputsResponseSchema } from "../gen/nebula/core/v1/output_pb";
import { ListRunsResponseSchema } from "../gen/nebula/core/v1/run_pb";
import { apiJson } from "./client";
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
