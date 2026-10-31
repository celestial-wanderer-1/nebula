import type { MessageInitShape } from "@bufbuild/protobuf";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CreateStudyRequestSchema,
  ListStudiesResponseSchema,
  StudySchema,
} from "../gen/nebula/core/v1/study_pb";
import { apiJson, jsonBody } from "./client";
import { queryKeys } from "./queryKeys";

const path = (projectId: string) =>
  `/projects/${encodeURIComponent(projectId)}/studies`;

export function useStudies(projectId: string) {
  return useQuery({
    queryKey: queryKeys.studies(projectId),
    queryFn: ({ signal }) =>
      apiJson(path(projectId), ListStudiesResponseSchema, { signal }),
    select: (response) => response.studies,
  });
}

/**
 * A Study. Its point Runs' state changes arrive on the queue channel,
 * which invalidates this query (ws/channels.ts).
 */
export function useStudy(projectId: string, id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.study(projectId, id ?? ""),
    queryFn: ({ signal }) =>
      apiJson(
        `${path(projectId)}/${encodeURIComponent(id ?? "")}`,
        StudySchema,
        { signal },
      ),
    enabled: Boolean(id),
  });
}

export function useCreateStudy(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: MessageInitShape<typeof CreateStudyRequestSchema>) =>
      apiJson(path(projectId), StudySchema, {
        method: "POST",
        ...jsonBody(CreateStudyRequestSchema, request),
      }),
    onSuccess: (study) => {
      queryClient.setQueryData(queryKeys.study(projectId, study.id), study);
      return queryClient.invalidateQueries({
        queryKey: queryKeys.studies(projectId),
      });
    },
  });
}

/** Starts or stops a scan (A§13.2). */
export function useStudyAction(projectId: string, id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: "start" | "stop") =>
      apiJson(
        `${path(projectId)}/${encodeURIComponent(id)}/${action}`,
        StudySchema,
        {
          method: "POST",
        },
      ),
    onSuccess: (study) => {
      queryClient.setQueryData(queryKeys.study(projectId, id), study);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.runs(projectId),
      });
      return queryClient.invalidateQueries({
        queryKey: queryKeys.studies(projectId),
      });
    },
  });
}
