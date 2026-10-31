import type { RouteObject } from "react-router";

// The geometry area (docs/UI.md Section 6.3), under /p/:projectId. Feature
// areas load lazily, each its own chunk (docs/UI.md P7).
export const geometryRoutes: RouteObject[] = [
  {
    path: "geometry",
    lazy: () =>
      import("./GeometryList").then((m) => ({ Component: m.GeometryList })),
  },
  {
    path: "geometry/:geometryId",
    lazy: () =>
      import("./GeometryEditor").then((m) => ({ Component: m.GeometryEditor })),
  },
];
