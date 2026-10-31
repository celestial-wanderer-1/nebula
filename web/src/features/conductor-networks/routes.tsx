import type { RouteObject } from "react-router";
import { ConductorNetworkEditor } from "./ConductorNetworkEditor";
import { ConductorNetworkList } from "./ConductorNetworkList";

export const conductorNetworkRoutes: RouteObject[] = [
  { path: "conductor-networks", element: <ConductorNetworkList /> },
  {
    path: "conductor-networks/:networkId",
    element: <ConductorNetworkEditor />,
  },
];
