import type { MessageInitShape } from "@bufbuild/protobuf";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  EntityDraftSchema,
  EntityKind,
  type EntityDraft,
} from "../gen/nebula/core/v1/entity_pb";
import {
  AddToLibraryRequestSchema,
  ImportFromLibraryRequestSchema,
  LibraryComponentSchema,
  LibraryMaterialSchema,
  ListLibraryComponentsResponseSchema,
  ListLibraryMaterialsResponseSchema,
  type LibraryComponent,
  type LibraryMaterial,
} from "../gen/nebula/core/v1/library_pb";
import {
  MaterialSchema,
  type Material,
} from "../gen/nebula/core/v1/material_pb";
import { apiJson, jsonBody } from "./client";
import { putDraftIfNewer } from "./entities";
import { queryKeys } from "./queryKeys";

// The user-global libraries (D88). Imports copy an entry into the project
// and record its source; the copy is independent of the entry afterwards.

export type AddToLibraryInit = MessageInitShape<
  typeof AddToLibraryRequestSchema
>;

const projectPath = (projectId: string) =>
  `/projects/${encodeURIComponent(projectId)}`;

export function useLibraryComponents({
  enabled = true,
}: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.libraryComponents(),
    queryFn: ({ signal }) =>
      apiJson("/library/components", ListLibraryComponentsResponseSchema, {
        signal,
      }),
    select: (response) => response.components,
    enabled,
  });
}

export function useLibraryComponent(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.libraryComponent(id ?? ""),
    queryFn: ({ signal }) =>
      apiJson(
        `/library/components/${encodeURIComponent(id ?? "")}`,
        LibraryComponentSchema,
        { signal },
      ),
    enabled: Boolean(id),
  });
}

export function useLibraryMaterials({
  enabled = true,
}: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.libraryMaterials(),
    queryFn: ({ signal }) =>
      apiJson("/library/materials", ListLibraryMaterialsResponseSchema, {
        signal,
      }),
    select: (response) => response.materials,
    enabled,
  });
}

export function useLibraryMaterial(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.libraryMaterial(id ?? ""),
    queryFn: ({ signal }) =>
      apiJson(
        `/library/materials/${encodeURIComponent(id ?? "")}`,
        LibraryMaterialSchema,
        { signal },
      ),
    enabled: Boolean(id),
  });
}

/**
 * Copies a library component into the project. The server also imports its
 * material unless the project already holds a copy of that entry.
 */
export function useImportComponent(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string): Promise<EntityDraft> =>
      apiJson(
        `${projectPath(projectId)}/components/import`,
        EntityDraftSchema,
        {
          method: "POST",
          ...jsonBody(ImportFromLibraryRequestSchema, { entryId }),
        },
      ),
    onSuccess: (draft) => {
      putDraftIfNewer(
        queryClient,
        queryKeys.draft(projectId, EntityKind.COMPONENT, draft.id),
        draft,
      );
      return Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.entities(projectId, EntityKind.COMPONENT),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.materials(projectId),
        }),
      ]);
    },
  });
}

export function useImportMaterial(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string): Promise<Material> =>
      apiJson(`${projectPath(projectId)}/materials/import`, MaterialSchema, {
        method: "POST",
        ...jsonBody(ImportFromLibraryRequestSchema, { entryId }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.materials(projectId),
      }),
  });
}

export function useAddComponentToLibrary() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: AddToLibraryInit): Promise<LibraryComponent> =>
      apiJson("/library/components", LibraryComponentSchema, {
        method: "POST",
        ...jsonBody(AddToLibraryRequestSchema, request),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.libraryComponents(),
      }),
  });
}

export function useAddMaterialToLibrary() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: AddToLibraryInit): Promise<LibraryMaterial> =>
      apiJson("/library/materials", LibraryMaterialSchema, {
        method: "POST",
        ...jsonBody(AddToLibraryRequestSchema, request),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.libraryMaterials(),
      }),
  });
}
