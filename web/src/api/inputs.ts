import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  InputDatasetSchema,
  ListInputDatasetsResponseSchema,
} from "../gen/nebula/core/v1/dataset_pb";
import { apiJson } from "./client";
import { queryKeys } from "./queryKeys";

const inputsPath = (projectId: string) =>
  `/projects/${encodeURIComponent(projectId)}/inputs`;

/** Ingested HDF5 input datasets of the project (D144). */
export function useInputDatasets(projectId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.inputs(projectId ?? ""),
    queryFn: ({ signal }) =>
      apiJson(inputsPath(projectId ?? ""), ListInputDatasetsResponseSchema, {
        signal,
      }),
    select: (response) => response.datasets,
    enabled: Boolean(projectId),
  });
}

/**
 * Uploads an HDF5 file as an input dataset of a sub-contract. The server
 * validates, hashes and versions it (D144); a file it rejects fails with a
 * ValidationError.
 */
export function useUploadInputDataset(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      file,
      name,
      subContract,
    }: {
      file: Blob;
      name: string;
      subContract: string;
    }) =>
      apiJson(
        `${inputsPath(projectId)}?${new URLSearchParams({ name, sub_contract: subContract }).toString()}`,
        InputDatasetSchema,
        {
          method: "POST",
          body: file,
          headers: { "Content-Type": "application/x-hdf5" },
        },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.inputs(projectId) }),
  });
}
