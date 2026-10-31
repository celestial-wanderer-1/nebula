import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  CreateProjectRequestSchema,
  ImportProjectResponseSchema,
  ListProjectsResponseSchema,
  ProjectSchema,
  SaveTemplateRequestSchema,
  TemplateSchema,
  type Project,
  type SaveTemplateRequest,
} from "../gen/nebula/core/v1/project_pb";
import { apiBlob, apiJson, jsonBody } from "./client";
import { saveDownload } from "./download";
import { queryKeys } from "./queryKeys";

const projectPath = (projectId: string) =>
  `/projects/${encodeURIComponent(projectId)}`;

export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects(),
    queryFn: ({ signal }) =>
      apiJson("/projects", ListProjectsResponseSchema, { signal }),
    select: (response) => response.projects,
  });
}

export function useProject(projectId: string) {
  return useQuery({
    queryKey: queryKeys.projectInfo(projectId),
    queryFn: ({ signal }) =>
      apiJson(projectPath(projectId), ProjectSchema, { signal }),
  });
}

function refreshProjects(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.projects() });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (
      request: MessageInitShape<typeof CreateProjectRequestSchema>,
    ): Promise<Project> =>
      apiJson("/projects", ProjectSchema, {
        method: "POST",
        ...jsonBody(CreateProjectRequestSchema, request),
      }),
    onSuccess: () => refreshProjects(queryClient),
  });
}

/** Imports a project snapshot. Validation issues come back in the body. */
export function useImportProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: Blob) =>
      apiJson("/projects/import", ImportProjectResponseSchema, {
        method: "POST",
        body: file,
        headers: { "Content-Type": "application/octet-stream" },
      }),
    onSuccess: (response) => {
      if (response.project) {
        return refreshProjects(queryClient);
      }
    },
  });
}

export function useSaveTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      request,
    }: {
      projectId: string;
      request: Omit<SaveTemplateRequest, "$typeName">;
    }) =>
      apiJson(`${projectPath(projectId)}/template`, TemplateSchema, {
        method: "POST",
        ...jsonBody(SaveTemplateRequestSchema, request),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.templates() }),
  });
}

/** Downloads a project snapshot (D100). */
export async function exportProject(project: Project): Promise<void> {
  const file = await apiBlob(`${projectPath(project.id)}/export`);
  saveDownload(file, `${project.name || project.id}.nebula`);
}
