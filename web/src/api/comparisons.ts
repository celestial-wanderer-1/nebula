import type { MessageInitShape } from "@bufbuild/protobuf";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ComparisonSchema,
  CreateComparisonRequestSchema,
  ListComparisonsResponseSchema,
} from "../gen/nebula/core/v1/comparison_pb";
import { apiJson, jsonBody } from "./client";
import { queryKeys } from "./queryKeys";

const path = (projectId: string) =>
  `/projects/${encodeURIComponent(projectId)}/comparisons`;

export function useComparisons(projectId: string) {
  return useQuery({
    queryKey: queryKeys.comparisons(projectId),
    queryFn: ({ signal }) =>
      apiJson(path(projectId), ListComparisonsResponseSchema, { signal }),
    select: (response) => response.comparisons,
  });
}

export function useComparison(projectId: string, id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.comparison(projectId, id ?? ""),
    queryFn: ({ signal }) =>
      apiJson(
        `${path(projectId)}/${encodeURIComponent(id ?? "")}`,
        ComparisonSchema,
        {
          signal,
        },
      ),
    enabled: Boolean(id),
    staleTime: Infinity,
  });
}

/** Compares Runs of the project on a shared Region (D104). */
export function useCreateComparison(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (
      request: MessageInitShape<typeof CreateComparisonRequestSchema>,
    ) =>
      apiJson(path(projectId), ComparisonSchema, {
        method: "POST",
        ...jsonBody(CreateComparisonRequestSchema, request),
      }),
    onSuccess: (comparison) => {
      queryClient.setQueryData(
        queryKeys.comparison(projectId, comparison.id),
        comparison,
      );
      return queryClient.invalidateQueries({
        queryKey: queryKeys.comparisons(projectId),
      });
    },
  });
}
