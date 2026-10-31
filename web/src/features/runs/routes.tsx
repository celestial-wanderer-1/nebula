import type { RouteObject } from "react-router";
import { RunDetail } from "./RunDetail";
import { RunsPage } from "./RunsPage";

export const runRoutes: RouteObject[] = [
  { path: "runs", element: <RunsPage /> },
  { path: "runs/:runId", element: <RunDetail /> },
];
