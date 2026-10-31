import { create, ScalarType } from "@bufbuild/protobuf";
import { useId, useState } from "react";
import { NumberInput } from "../forms/widgets/NumberInput";
import { numericKind } from "../forms/values";
import {
  SlicePlaneSchema,
  ViewerKind,
  type ViewParams,
} from "../gen/nebula/core/v1/view_pb";

const DOUBLE = numericKind(ScalarType.DOUBLE);
const UINT = numericKind(ScalarType.UINT32);
const MODES = [0, 1, 2, 3, 4];

const NORMALS = {
  x: { x: 1, y: 0, z: 0 },
  y: { x: 0, y: 1, z: 0 },
  z: { x: 0, y: 0, z: 1 },
} as const;

/** Parses "0.2, 0.4 0.6" into numbers; undefined if any does not parse. */
function parseLevels(text: string): number[] | undefined {
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  const values = parts.map(Number);
  return values.every(Number.isFinite) ? values : undefined;
}

/**
 * The parameters of one viewer (A§3.6): slice plane, isovalues, seeds,
 * decimation, mode, Poincaré section. Each change is a new view request.
 */
export function ViewParamsForm({
  viewer,
  params,
  onChange,
}: {
  viewer: ViewerKind;
  params: ViewParams;
  onChange: (params: ViewParams) => void;
}) {
  const ids = useId();
  const [levels, setLevels] = useState(params.isovalues.join(", "));
  const set = (change: Partial<ViewParams>) =>
    onChange({ ...params, ...change });
  const decimation = (
    <div className="field">
      <label htmlFor={`${ids}-points`}>Points (0: server default)</label>
      <NumberInput
        id={`${ids}-points`}
        value={params.maxPoints}
        kind={UINT}
        onChange={(value) => set({ maxPoints: Number(value) })}
      />
    </div>
  );
  switch (viewer) {
    case ViewerKind.CONTOUR_2D:
      return (
        <div className="view-params">
          <div className="field">
            <label htmlFor={`${ids}-levels`}>Contour levels</label>
            <input
              id={`${ids}-levels`}
              value={levels}
              placeholder="Default"
              onChange={(event) => {
                setLevels(event.target.value);
                const values = parseLevels(event.target.value);
                if (values) set({ isovalues: values });
              }}
            />
          </div>
          {decimation}
        </div>
      );
    case ViewerKind.FIELD_3D: {
      const normal = params.slice?.normal;
      const axis = normal ? (normal.x ? "x" : normal.z ? "z" : "y") : "y";
      return (
        <div className="view-params">
          <div className="field">
            <label htmlFor={`${ids}-normal`}>Slice normal</label>
            <select
              id={`${ids}-normal`}
              value={axis}
              onChange={(event) =>
                set({
                  slice: create(SlicePlaneSchema, {
                    normal: NORMALS[event.target.value as keyof typeof NORMALS],
                  }),
                })
              }
            >
              <option value="x">x</option>
              <option value="y">y</option>
              <option value="z">z</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${ids}-iso`}>
              Isosurface (ψ_n, empty for a slice)
            </label>
            <input
              id={`${ids}-iso`}
              value={levels}
              onChange={(event) => {
                setLevels(event.target.value);
                const values = parseLevels(event.target.value);
                if (values) set({ isovalues: values.slice(0, 1) });
              }}
            />
          </div>
          {decimation}
        </div>
      );
    }
    case ViewerKind.POINCARE:
      return (
        <div className="view-params">
          <div className="field">
            <label htmlFor={`${ids}-phi`}>Section angle [rad]</label>
            <NumberInput
              id={`${ids}-phi`}
              value={params.sectionPhi}
              kind={DOUBLE}
              onChange={(value) => set({ sectionPhi: Number(value) })}
            />
          </div>
          <div className="field">
            <label htmlFor={`${ids}-transits`}>Transits (0: default)</label>
            <NumberInput
              id={`${ids}-transits`}
              value={params.transits}
              kind={UINT}
              onChange={(value) => set({ transits: Number(value) })}
            />
          </div>
        </div>
      );
    case ViewerKind.MODE_STRUCTURE:
      return (
        <div className="view-params">
          <div className="field">
            <label htmlFor={`${ids}-mode`}>Mode</label>
            <select
              id={`${ids}-mode`}
              value={params.modeIndex}
              onChange={(event) =>
                set({ modeIndex: Number(event.target.value) })
              }
            >
              {MODES.map((m) => (
                <option key={m} value={m}>
                  Mode {m + 1} (m = {m + 2})
                </option>
              ))}
            </select>
          </div>
          {decimation}
        </div>
      );
    case ViewerKind.PROFILE_1D:
      return <div className="view-params">{decimation}</div>;
    default:
      return null;
  }
}
