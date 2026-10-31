import type { RouteObject } from "react-router";

// Feature areas load lazily, each its own chunk (docs/UI.md P7).

export const comparisonRoutes: RouteObject[] = [
  {
    path: "comparison",
    lazy: () =>
      import("./ComparisonPage").then((m) => ({ Component: m.ComparisonPage })),
  },
  {
    path: "comparison/:comparisonId",
    lazy: () =>
      import("./ComparisonView").then((m) => ({ Component: m.ComparisonView })),
  },
];
