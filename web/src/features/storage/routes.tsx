import type { RouteObject } from "react-router";
import { StoragePage } from "./StoragePage";

export const storageRoutes: RouteObject[] = [
  { path: "storage", element: <StoragePage /> },
];
