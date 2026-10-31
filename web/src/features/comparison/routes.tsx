import type { RouteObject } from "react-router";
import { ComparisonPage } from "./ComparisonPage";
import { ComparisonView } from "./ComparisonView";

export const comparisonRoutes: RouteObject[] = [
  { path: "comparison", element: <ComparisonPage /> },
  { path: "comparison/:comparisonId", element: <ComparisonView /> },
];
