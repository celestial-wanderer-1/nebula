import type { RouteObject } from "react-router";

// Feature areas load lazily, each its own chunk (docs/UI.md P7).

export const studyRoutes: RouteObject[] = [
  {
    path: "studies",
    lazy: () =>
      import("./StudiesPage").then((m) => ({ Component: m.StudiesPage })),
  },
  {
    path: "studies/new",
    lazy: () =>
      import("./StudyEditor").then((m) => ({ Component: m.StudyEditor })),
  },
  {
    path: "studies/:studyId",
    lazy: () =>
      import("./StudyDetail").then((m) => ({ Component: m.StudyDetail })),
  },
];
