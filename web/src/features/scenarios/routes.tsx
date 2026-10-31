import type { RouteObject } from "react-router";
import { ScenarioEditor } from "./ScenarioEditor";
import { ScenarioList } from "./ScenarioList";

export const scenarioRoutes: RouteObject[] = [
  { path: "scenarios", element: <ScenarioList /> },
  { path: "scenarios/:scenarioId", element: <ScenarioEditor /> },
];
