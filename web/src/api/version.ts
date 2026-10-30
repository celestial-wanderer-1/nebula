import { useQuery } from "@tanstack/react-query";
import { VersionInfoSchema } from "../gen/nebula/core/v1/version_pb";
import { apiJson } from "./client";
import { queryKeys } from "./queryKeys";

/** Wire API version this UI build speaks; checked against `/version` (D137). */
export const UI_API_VERSION = "1";

/** Identity of this UI build, shown when the server is incompatible. */
export const UI_BUILD = __NEBULA_BUILD__;

export function useVersionInfo({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.version(),
    queryFn: ({ signal }) => apiJson("/version", VersionInfoSchema, { signal }),
    retry: false,
    enabled,
    staleTime: Infinity,
  });
}
