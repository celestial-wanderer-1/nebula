import type { RouteObject } from "react-router";

// Feature areas load lazily, each its own chunk (docs/UI.md P7).

export const conductorNetworkRoutes: RouteObject[] = [
  {
    path: "conductor-networks",
    lazy: () =>
      import("./ConductorNetworkList").then((m) => ({
        Component: m.ConductorNetworkList,
      })),
  },
  {
    path: "conductor-networks/:networkId",
    lazy: () =>
      import("./ConductorNetworkEditor").then((m) => ({
        Component: m.ConductorNetworkEditor,
      })),
  },
];
