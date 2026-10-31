import type { RouteObject } from "react-router";

// Feature areas load lazily, each its own chunk (docs/UI.md P7).

export const scenarioRoutes: RouteObject[] = [
  {
    path: "scenarios",
    lazy: () =>
      import("./ScenarioList").then((m) => ({ Component: m.ScenarioList })),
  },
  {
    path: "scenarios/:scenarioId",
    lazy: () =>
      import("./ScenarioEditor").then((m) => ({ Component: m.ScenarioEditor })),
  },
];
