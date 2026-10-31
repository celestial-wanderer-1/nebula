import type { RouteObject } from "react-router";
import { ComponentDetail } from "./ComponentDetail";
import { GlobalComponentEntry, GlobalMaterialEntry } from "./GlobalEntry";
import { LibrariesPage } from "./LibrariesPage";
import { MaterialDetail } from "./MaterialDetail";

// Libraries area (docs/UI.md Section 6.2), relative to /p/:projectId.
export const libraryRoutes: RouteObject[] = [
  { path: "libraries", element: <LibrariesPage /> },
  { path: "libraries/components/:componentId", element: <ComponentDetail /> },
  { path: "libraries/materials/:materialId", element: <MaterialDetail /> },
  {
    path: "libraries/global/components/:entryId",
    element: <GlobalComponentEntry />,
  },
  {
    path: "libraries/global/materials/:entryId",
    element: <GlobalMaterialEntry />,
  },
];
