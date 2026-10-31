import { lazyView } from "../lazy";
import type { ChartProps } from "./Chart";

export type { ChartProps } from "./Chart";

/** A lazily loaded Plotly chart (docs/UI.md P7: Plotly is its own chunk). */
export const PlotlyChart = lazyView<ChartProps>(
  () => import("./Chart").then((module) => module.Chart),
  {
    loading: "Loading chart…",
    unavailable: "Chart unavailable: the plotting library could not be loaded.",
    className: "chart",
  },
);
