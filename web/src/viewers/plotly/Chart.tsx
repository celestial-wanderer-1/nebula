import type { Data, Layout } from "plotly.js";
import Plotly from "plotly.js-basic-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";

// The Plotly chart (A§13.6), with the basic bundle: scatter, bar and pie,
// without the WebGL traces whose code generation a strict CSP forbids.
// Loaded lazily through PlotlyChart, so Plotly is a separate chunk.

const Plot = createPlotlyComponent(Plotly);

export interface ChartProps {
  data: Data[];
  layout?: Partial<Layout>;
  /** Accessible name of the chart image. */
  label: string;
  height?: number;
}

const THEME: Partial<Layout> = {
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(0,0,0,0)",
  font: { color: "#e6edf3", size: 12 },
  margin: { l: 56, r: 16, t: 24, b: 44 },
  xaxis: { gridcolor: "#2c3f54", zerolinecolor: "#2c3f54" },
  yaxis: { gridcolor: "#2c3f54", zerolinecolor: "#2c3f54" },
  legend: { orientation: "h" },
};

function merge(layout: Partial<Layout> | undefined): Partial<Layout> {
  return {
    ...THEME,
    ...layout,
    xaxis: { ...THEME.xaxis, ...layout?.xaxis },
    yaxis: { ...THEME.yaxis, ...layout?.yaxis },
  };
}

export function Chart({ data, layout, label, height = 280 }: ChartProps) {
  return (
    <div
      className="chart"
      role="img"
      aria-label={label}
      data-traces={data.length}
    >
      <Plot
        data={data}
        layout={{ ...merge(layout), height, autosize: true }}
        config={{ displaylogo: false, responsive: true }}
        style={{ width: "100%" }}
        useResizeHandler
      />
    </div>
  );
}
