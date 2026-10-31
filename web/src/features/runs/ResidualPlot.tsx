import type { Residual } from "../../gen/nebula/core/v1/run_pb";
import { PlotlyChart } from "../../viewers/plotly/PlotlyChart";

const COLOURS = ["#7dd3c8", "#f2c14e", "#79c0ff", "#ff7b72", "#c297ff"];

/** Convergence residuals per step on a log scale (A§3.5). */
export function ResidualPlot({
  residuals,
  labels,
}: {
  residuals: ReadonlyMap<string, readonly Residual[]>;
  labels: ReadonlyMap<string, string>;
}) {
  if (residuals.size === 0) {
    return <p className="muted small">No residuals yet.</p>;
  }
  return (
    <PlotlyChart
      label="Convergence residuals"
      height={240}
      data={[...residuals].map(([nodeId, series], i) => ({
        type: "scatter",
        mode: "lines+markers",
        name: labels.get(nodeId) ?? nodeId,
        x: series.map((r) => r.iteration),
        y: series.map((r) => r.value),
        line: { color: COLOURS[i % COLOURS.length] },
      }))}
      layout={{
        xaxis: { title: { text: "iteration" } },
        yaxis: { title: { text: "residual" }, type: "log" },
      }}
    />
  );
}
