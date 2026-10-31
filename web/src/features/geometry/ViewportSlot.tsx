import { lazyView } from "../../viewers/lazy";
import type { ViewportProps } from "./Viewport";

// three.js and R3F load with the editor's viewport only (docs/UI.md P7).
export const ViewportSlot = lazyView<ViewportProps>(
  () => import("./Viewport").then((module) => module.Viewport),
  {
    loading: "Loading 3D view…",
    unavailable:
      "3D view unavailable: the viewer could not be loaded. Editing still works.",
  },
);
