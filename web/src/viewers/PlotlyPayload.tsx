import type { Data, Layout } from "plotly.js";
import type { ViewPayload } from "../gen/nebula/core/v1/view_pb";
import { PlotlyChart } from "./plotly/PlotlyChart";

interface Trace {
  name?: string;
  x?: number[];
  y?: number[];
}

const MAX_ROWS = 200;

/**
 * A Plotly payload (1D profile, spectrum, time trace; A§13.6) with its
 * numbers in a table, so the data is readable without the chart.
 */
export function PlotlyPayload({ payload }: { payload: ViewPayload }) {
  if (payload.body.case !== "plotly") return null;
  const figure = payload.body.value.figure ?? {};
  const data = (figure.data ?? []) as unknown as Data[];
  const layout = (figure.layout ?? {}) as unknown as Partial<Layout>;
  const traces = data as unknown as Trace[];
  return (
    <div className="plotly-payload" data-traces={data.length}>
      <PlotlyChart
        label={payload.title || "Chart"}
        data={data}
        layout={layout}
        height={340}
      />
      <details className="chart-data">
        <summary>Show data</summary>
        {traces.map((trace, t) => (
          <table
            key={t}
            className="table value-table"
            aria-label={`Data of ${trace.name ?? `trace ${t + 1}`}`}
          >
            <caption>{trace.name ?? `Trace ${t + 1}`}</caption>
            <thead>
              <tr>
                <th scope="col">x</th>
                <th scope="col">y</th>
              </tr>
            </thead>
            <tbody>
              {(trace.x ?? []).slice(0, MAX_ROWS).map((x, i) => (
                <tr key={i}>
                  <td>{x.toPrecision(4)}</td>
                  <td>{trace.y?.[i]?.toPrecision(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </details>
    </div>
  );
}
