import { useQuery } from "@tanstack/react-query";
import { ListTemplatesResponseSchema } from "../gen/nebula/core/v1/project_pb";
import { apiJson } from "./client";
import { queryKeys } from "./queryKeys";

export function useTemplates() {
  return useQuery({
    queryKey: queryKeys.templates(),
    queryFn: ({ signal }) =>
      apiJson("/templates", ListTemplatesResponseSchema, { signal }),
    select: (response) => response.templates,
  });
}
