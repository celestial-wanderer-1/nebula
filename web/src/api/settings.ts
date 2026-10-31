import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ProjectSchema,
  ProjectSettingsSchema,
  type ProjectSettings,
} from "../gen/nebula/core/v1/project_pb";
import { SettingsSchema } from "../gen/nebula/core/v1/settings_pb";
import { apiJson, jsonBody } from "./client";
import { queryKeys } from "./queryKeys";

/** The installation's TOML configuration, read-only (D90). */
export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings(),
    queryFn: ({ signal }) => apiJson("/settings", SettingsSchema, { signal }),
    staleTime: Infinity,
  });
}

/** Sets a project's settings, such as the strict cache switch (D78). */
export function useUpdateProjectSettings(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: Omit<ProjectSettings, "$typeName">) =>
      apiJson(
        `/projects/${encodeURIComponent(projectId)}/settings`,
        ProjectSchema,
        {
          method: "PUT",
          ...jsonBody(ProjectSettingsSchema, settings),
        },
      ),
    onSuccess: (project) => {
      queryClient.setQueryData(queryKeys.projectInfo(projectId), project);
      return queryClient.invalidateQueries({ queryKey: queryKeys.projects() });
    },
  });
}
