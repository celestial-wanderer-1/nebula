import type { RouteObject } from "react-router";
import { geometryRoutes } from "../features/geometry/routes";
import { libraryRoutes } from "../features/libraries/routes";
import { ProjectBrowser } from "../features/projects/ProjectBrowser";
import { ProjectOverview } from "../features/projects/ProjectOverview";
import { PROJECT_AREAS } from "./areas";
import { NotFound, Placeholder } from "./Placeholder";
import { ProjectLayout } from "./ProjectLayout";
import { Shell } from "./Shell";

// Areas built so far; the rest show the phase that delivers them.
const builtAreas: RouteObject[] = [...geometryRoutes, ...libraryRoutes];
const built = new Set(builtAreas.map((route) => route.path?.split("/")[0]));

// Project-scoped routes are bookmarkable within a launch (docs/UI.md Section 3).
export const routes: RouteObject[] = [
  {
    element: <Shell />,
    children: [
      { path: "/", element: <ProjectBrowser /> },
      {
        path: "/p/:projectId",
        element: <ProjectLayout />,
        children: [
          { index: true, element: <ProjectOverview /> },
          ...builtAreas,
          ...PROJECT_AREAS.filter((area) => !built.has(area.path)).map(
            (area) => ({
              path: area.path,
              element: <Placeholder title={area.label} phase={area.phase} />,
            }),
          ),
          { path: "*", element: <NotFound main={false} /> },
        ],
      },
      {
        path: "/plugins",
        element: <Placeholder title="Plugins" phase="P6" main />,
      },
      {
        path: "/settings",
        element: <Placeholder title="Settings" phase="P6" main />,
      },
      { path: "*", element: <NotFound /> },
    ],
  },
];
