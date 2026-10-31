import type { RouteObject } from "react-router";
import { RegionEditor } from "./RegionEditor";
import { RegionList } from "./RegionList";

export const regionRoutes: RouteObject[] = [
  { path: "regions", element: <RegionList /> },
  { path: "regions/:regionId", element: <RegionEditor /> },
];
