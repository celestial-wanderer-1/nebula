import { QueryClient } from "@tanstack/react-query";
import { ApiRequestError } from "../api/errors";

/** Client errors (4xx) are answers, not glitches: they are not retried. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failures, error) =>
          !(error instanceof ApiRequestError && error.status < 500) &&
          failures < 2,
        refetchOnWindowFocus: false,
      },
    },
  });
}
