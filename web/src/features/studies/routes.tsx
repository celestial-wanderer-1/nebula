import type { RouteObject } from "react-router";
import { StudiesPage } from "./StudiesPage";
import { StudyDetail } from "./StudyDetail";
import { StudyEditor } from "./StudyEditor";

export const studyRoutes: RouteObject[] = [
  { path: "studies", element: <StudiesPage /> },
  { path: "studies/new", element: <StudyEditor /> },
  { path: "studies/:studyId", element: <StudyDetail /> },
];
