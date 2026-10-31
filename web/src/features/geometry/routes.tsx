import type { RouteObject } from "react-router";
import { GeometryEditor } from "./GeometryEditor";
import { GeometryList } from "./GeometryList";

// The geometry area (docs/UI.md Section 6.3), under /p/:projectId.
export const geometryRoutes: RouteObject[] = [
  { path: "geometry", element: <GeometryList /> },
  { path: "geometry/:geometryId", element: <GeometryEditor /> },
];
