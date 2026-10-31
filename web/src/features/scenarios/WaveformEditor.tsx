import { create } from "@bufbuild/protobuf";
import { useId } from "react";
import { NumberInput } from "../../forms/widgets/NumberInput";
import { numericKind } from "../../forms/values";
import { ScalarType } from "@bufbuild/protobuf";
import {
  Interpolation,
  WaveformSchema,
  type Waveform,
} from "../../gen/nebula/core/v1/timeseries_pb";
import { PlotlyChart } from "../../viewers/plotly/PlotlyChart";

const DOUBLE = numericKind(ScalarType.DOUBLE);

/**
 * A waveform as a table of (time, value) points with a preview plot
 * (docs/UI.md 6.4). The table is the editor, so it works by keyboard; the
 * plot shows the interpolation.
 */
export function WaveformEditor({
  label,
  unit,
  value,
  onChange,
  readOnly = false,
}: {
  /** What the values are, such as "Current of PF". */
  label: string;
  unit: string;
  value: Waveform | undefined;
  onChange: (value: Waveform) => void;
  readOnly?: boolean;
}) {
  const ids = useId();
  const waveform = value ?? create(WaveformSchema);
  const points = waveform.times.map((time, i) => ({
    time,
    value: waveform.values[i] ?? 0,
  }));
  const emit = (
    next: { time: number; value: number }[],
    interpolation = waveform.interpolation,
  ) =>
    onChange(
      create(WaveformSchema, {
        times: next.map((p) => p.time),
        values: next.map((p) => p.value),
        interpolation,
      }),
    );
  const setPoint = (
    index: number,
    change: Partial<{ time: number; value: number }>,
  ) => emit(points.map((p, i) => (i === index ? { ...p, ...change } : p)));
  const decreasing = points.some(
    (p, i) => i > 0 && p.time <= points[i - 1]!.time,
  );
  const step = waveform.interpolation === Interpolation.STEP;

  return (
    <fieldset className="waveform" disabled={readOnly}>
      <legend>{label} waveform</legend>
      <div className="field">
        <label htmlFor={`${ids}-interp`}>Interpolation</label>
        <select
          id={`${ids}-interp`}
          value={waveform.interpolation || Interpolation.LINEAR}
          onChange={(event) =>
            emit(points, Number(event.target.value) as Interpolation)
          }
        >
          <option value={Interpolation.LINEAR}>Linear</option>
          <option value={Interpolation.STEP}>Step</option>
        </select>
      </div>
      <table className="value-table">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Time [s]</th>
            <th scope="col">Value [{unit}]</th>
            <th scope="col">
              <span className="visually-hidden">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {points.map((point, index) => (
            <tr key={index}>
              <th scope="row">{index + 1}</th>
              <td>
                <NumberInput
                  aria-label={`Time ${index + 1}`}
                  value={point.time}
                  kind={DOUBLE}
                  onChange={(time) => setPoint(index, { time: Number(time) })}
                />
              </td>
              <td>
                <NumberInput
                  aria-label={`Value ${index + 1}`}
                  value={point.value}
                  kind={DOUBLE}
                  onChange={(v) => setPoint(index, { value: Number(v) })}
                />
              </td>
              <td>
                <button
                  type="button"
                  className="icon"
                  aria-label={`Remove point ${index + 1}`}
                  onClick={() => emit(points.filter((_, i) => i !== index))}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        onClick={() => {
          const last = points.at(-1);
          emit([
            ...points,
            { time: last ? last.time + 1 : 0, value: last?.value ?? 0 },
          ]);
        }}
      >
        Add point
      </button>
      {decreasing && (
        <p className="field-warning" role="status">
          Times must increase from row to row.
        </p>
      )}
      {points.length > 1 && (
        <PlotlyChart
          label={`${label} against time`}
          height={200}
          data={[
            {
              type: "scatter",
              mode: "lines+markers",
              x: points.map((p) => p.time),
              y: points.map((p) => p.value),
              line: { shape: step ? "hv" : "linear", color: "#7dd3c8" },
              name: label,
            },
          ]}
          layout={{
            xaxis: { title: { text: "t [s]" } },
            yaxis: { title: { text: `[${unit}]` } },
            showlegend: false,
          }}
        />
      )}
    </fieldset>
  );
}
