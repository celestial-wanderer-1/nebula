import type { RouteObject } from "react-router";

// Feature areas load lazily, each its own chunk (docs/UI.md P7).

export const regionRoutes: RouteObject[] = [
  {
    path: "regions",
    lazy: () =>
      import("./RegionList").then((m) => ({ Component: m.RegionList })),
  },
  {
    path: "regions/:regionId",
    lazy: () =>
      import("./RegionEditor").then((m) => ({ Component: m.RegionEditor })),
  },
];
