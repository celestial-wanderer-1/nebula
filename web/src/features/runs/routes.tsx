import type { RouteObject } from "react-router";

// Feature areas load lazily, each its own chunk (docs/UI.md P7).

export const runRoutes: RouteObject[] = [
  {
    path: "runs",
    lazy: () => import("./RunsPage").then((m) => ({ Component: m.RunsPage })),
  },
  {
    path: "runs/:runId",
    lazy: () => import("./RunDetail").then((m) => ({ Component: m.RunDetail })),
  },
];
