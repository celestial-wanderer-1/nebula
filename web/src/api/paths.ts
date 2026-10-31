// Paths the FastAPI server owns (A§13.2); everything else is the UI bundle.
// Shared by the dev proxy, the mock backend and the stub server.
export const API_PREFIXES = [
  "/version",
  "/projects",
  "/templates",
  "/plugins",
  "/queue",
  "/settings",
  "/library",
] as const;

export const WS_PREFIX = "/ws/";

/** Whether a URL path is the API's (REST), rather than the bundle's. */
export function isApiPath(pathname: string): boolean {
  return API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
