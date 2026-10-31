import type { RouteObject } from "react-router";

// Feature areas load lazily, each its own chunk (docs/UI.md P7).

export const storageRoutes: RouteObject[] = [
  {
    path: "storage",
    lazy: () =>
      import("./StoragePage").then((m) => ({ Component: m.StoragePage })),
  },
];
