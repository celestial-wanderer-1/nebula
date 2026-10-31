import type { RouteObject } from "react-router";

// Feature areas load lazily, each its own chunk (docs/UI.md P7).

export const resultRoutes: RouteObject[] = [
  {
    path: "results",
    lazy: () =>
      import("./ResultsPage").then((m) => ({ Component: m.ResultsPage })),
  },
  {
    path: "results/:runId",
    lazy: () =>
      import("./RunResults").then((m) => ({ Component: m.RunResults })),
  },
];
