import { useId } from "react";
import type { TimeAxis } from "../gen/nebula/core/v1/output_pb";

/** The time slider of every time-series view (D146). */
export function TimeSlider({
  time,
  index,
  onChange,
}: {
  time: TimeAxis;
  index: number;
  onChange: (index: number) => void;
}) {
  const id = useId();
  const t = time.times[index] ?? 0;
  return (
    <div className="field time-slider">
      <label htmlFor={id}>Time slice</label>
      <input
        id={id}
        type="range"
        min={0}
        max={Math.max(0, time.times.length - 1)}
        step={1}
        value={index}
        aria-valuetext={`t = ${t} s`}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output htmlFor={id}>
        t = {t} s ({index + 1} of {time.times.length}, base {time.base})
      </output>
    </div>
  );
}
