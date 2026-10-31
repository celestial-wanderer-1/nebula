import type { RouteObject } from "react-router";

// Feature areas load lazily, each its own chunk (docs/UI.md P7).

export const workflowRoutes: RouteObject[] = [
  {
    path: "workflows",
    lazy: () =>
      import("./WorkflowList").then((m) => ({ Component: m.WorkflowList })),
  },
  {
    path: "workflows/:workflowId",
    lazy: () =>
      import("./WorkflowEditor").then((m) => ({ Component: m.WorkflowEditor })),
  },
];
