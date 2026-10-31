import type { RouteObject } from "react-router";
import { WorkflowEditor } from "./WorkflowEditor";
import { WorkflowList } from "./WorkflowList";

export const workflowRoutes: RouteObject[] = [
  { path: "workflows", element: <WorkflowList /> },
  { path: "workflows/:workflowId", element: <WorkflowEditor /> },
];
