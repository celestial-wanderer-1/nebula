import type { RouteObject } from "react-router";

// Libraries area (docs/UI.md Section 6.2), relative to /p/:projectId,
// loaded lazily (docs/UI.md P7).
export const libraryRoutes: RouteObject[] = [
  {
    path: "libraries",
    lazy: () =>
      import("./LibrariesPage").then((m) => ({ Component: m.LibrariesPage })),
  },
  {
    path: "libraries/components/:componentId",
    lazy: () =>
      import("./ComponentDetail").then((m) => ({
        Component: m.ComponentDetail,
      })),
  },
  {
    path: "libraries/materials/:materialId",
    lazy: () =>
      import("./MaterialDetail").then((m) => ({ Component: m.MaterialDetail })),
  },
  {
    path: "libraries/global/components/:entryId",
    lazy: () =>
      import("./GlobalEntry").then((m) => ({
        Component: m.GlobalComponentEntry,
      })),
  },
  {
    path: "libraries/global/materials/:entryId",
    lazy: () =>
      import("./GlobalEntry").then((m) => ({
        Component: m.GlobalMaterialEntry,
      })),
  },
];
