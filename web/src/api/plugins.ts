import { useQuery } from "@tanstack/react-query";
import { ListPluginsResponseSchema } from "../gen/nebula/core/v1/plugin_pb";
import { apiJson } from "./client";
import { queryKeys } from "./queryKeys";

export function usePlugins({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.plugins(),
    queryFn: ({ signal }) =>
      apiJson("/plugins", ListPluginsResponseSchema, { signal }),
    select: (response) => response.plugins,
    retry: false,
    enabled,
    staleTime: Infinity,
  });
}
