import type { RouteObject } from "react-router";
import { ResultsPage } from "./ResultsPage";
import { RunResults } from "./RunResults";

export const resultRoutes: RouteObject[] = [
  { path: "results", element: <ResultsPage /> },
  { path: "results/:runId", element: <RunResults /> },
];
