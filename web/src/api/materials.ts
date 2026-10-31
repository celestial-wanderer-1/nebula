import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  ListMaterialsResponseSchema,
  MaterialRequestSchema,
  MaterialSchema,
  type Material,
} from "../gen/nebula/core/v1/material_pb";
import { apiFetch, apiJson, jsonBody } from "./client";
import { queryKeys } from "./queryKeys";

// Materials are plain project resources: not entities, not versioned. The
// server inlines them into the component hash (D127).

export type MaterialRequestInit = MessageInitShape<
  typeof MaterialRequestSchema
>;

const materialsPath = (projectId: string) =>
  `/projects/${encodeURIComponent(projectId)}/materials`;
const materialPath = (projectId: string, id: string) =>
  `${materialsPath(projectId)}/${encodeURIComponent(id)}`;

export function useMaterials(projectId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.materials(projectId ?? ""),
    queryFn: ({ signal }) =>
      apiJson(materialsPath(projectId ?? ""), ListMaterialsResponseSchema, {
        signal,
      }),
    select: (response) => response.materials,
    enabled: Boolean(projectId),
  });
}

export function useMaterial(projectId: string, id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.material(projectId, id ?? ""),
    queryFn: ({ signal }) =>
      apiJson(materialPath(projectId, id ?? ""), MaterialSchema, { signal }),
    enabled: Boolean(projectId && id),
  });
}

function refreshMaterials(queryClient: QueryClient, projectId: string) {
  return queryClient.invalidateQueries({
    queryKey: queryKeys.materials(projectId),
  });
}

export function useCreateMaterial(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: MaterialRequestInit): Promise<Material> =>
      apiJson(materialsPath(projectId), MaterialSchema, {
        method: "POST",
        ...jsonBody(MaterialRequestSchema, request),
      }),
    onSuccess: (material) => {
      queryClient.setQueryData(
        queryKeys.material(projectId, material.id),
        material,
      );
      return refreshMaterials(queryClient, projectId);
    },
  });
}

/** Replaces a material; the last write wins (no revisions, D127). */
export function useUpdateMaterial(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      request,
    }: {
      id: string;
      request: MaterialRequestInit;
    }): Promise<Material> =>
      apiJson(materialPath(projectId, id), MaterialSchema, {
        method: "PUT",
        ...jsonBody(MaterialRequestSchema, request),
      }),
    onSuccess: (material) => {
      queryClient.setQueryData(
        queryKeys.material(projectId, material.id),
        material,
      );
      return refreshMaterials(queryClient, projectId);
    },
  });
}

/** Deletes a material. One a component still uses fails with 409. */
export function useDeleteMaterial(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiFetch(materialPath(projectId, id), { method: "DELETE" });
    },
    onSuccess: (_, id) => {
      queryClient.removeQueries({
        queryKey: queryKeys.material(projectId, id),
      });
      return refreshMaterials(queryClient, projectId);
    },
  });
}
