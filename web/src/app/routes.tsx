import type { RouteObject } from "react-router";
import { comparisonRoutes } from "../features/comparison/routes";
import { conductorNetworkRoutes } from "../features/conductor-networks/routes";
import { geometryRoutes } from "../features/geometry/routes";
import { libraryRoutes } from "../features/libraries/routes";
import { regionRoutes } from "../features/regions/routes";
import { PluginsPage } from "../features/plugins/PluginsPage";
import { resultRoutes } from "../features/results/routes";
import { runRoutes } from "../features/runs/routes";
import { scenarioRoutes } from "../features/scenarios/routes";
import { SettingsPage } from "../features/settings/SettingsPage";
import { storageRoutes } from "../features/storage/routes";
import { studyRoutes } from "../features/studies/routes";
import { workflowRoutes } from "../features/workflows/routes";
import { ProjectBrowser } from "../features/projects/ProjectBrowser";
import { ProjectOverview } from "../features/projects/ProjectOverview";
import { PROJECT_AREAS } from "./areas";
import { NotFound, Placeholder } from "./Placeholder";
import { ProjectLayout } from "./ProjectLayout";
import { Shell } from "./Shell";

// Areas built so far; the rest show the phase that delivers them.
const builtAreas: RouteObject[] = [
  ...geometryRoutes,
  ...libraryRoutes,
  ...regionRoutes,
  ...scenarioRoutes,
  ...conductorNetworkRoutes,
  ...workflowRoutes,
  ...runRoutes,
  ...resultRoutes,
  ...comparisonRoutes,
  ...studyRoutes,
  ...storageRoutes,
];
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
      // Install-wide pages; /plugins and /settings are the API's (A§13.2).
      { path: "/admin/plugins", element: <PluginsPage /> },
      { path: "/admin/settings", element: <SettingsPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
];
