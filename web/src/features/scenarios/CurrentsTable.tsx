import { create, ScalarType } from "@bufbuild/protobuf";
import { Fragment, useState } from "react";
import { numericKind } from "../../forms/values";
import { NumberInput } from "../../forms/widgets/NumberInput";
import type { Geometry } from "../../gen/nebula/core/v1/geometry_pb";
import {
  CircuitCurrentSchema,
  type CircuitCurrent,
} from "../../gen/nebula/core/v1/scenario_pb";
import { WaveformEditor } from "./WaveformEditor";

const DOUBLE = numericKind(ScalarType.DOUBLE);

/**
 * Coil currents keyed by the stable circuit IDs of the scenario's geometry
 * (D114): one row per circuit, plus currents naming circuits the geometry
 * does not have, which the server would reject (A§3.4).
 */
export function CurrentsTable({
  geometry,
  currents,
  onChange,
  readOnly = false,
}: {
  geometry: Geometry | undefined;
  currents: readonly CircuitCurrent[];
  onChange: (currents: CircuitCurrent[]) => void;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState<string>();
  const circuits = geometry?.circuits ?? [];
  const known = new Set(circuits.map((c) => c.id));
  const unknown = currents.filter((c) => !known.has(c.circuitId));
  const rows = [
    ...circuits.map((circuit) => ({
      id: circuit.id,
      name: circuit.name || circuit.id,
      current: currents.find((c) => c.circuitId === circuit.id),
      inGeometry: true,
    })),
    ...unknown.map((current) => ({
      id: current.circuitId,
      name: current.circuitId,
      current,
      inGeometry: false,
    })),
  ];

  const put = (circuitId: string, change: Partial<CircuitCurrent>) => {
    const held = currents.find((c) => c.circuitId === circuitId);
    const next = {
      ...(held ?? create(CircuitCurrentSchema, { circuitId })),
      ...change,
    };
    onChange(
      held ? currents.map((c) => (c === held ? next : c)) : [...currents, next],
    );
  };
  const remove = (circuitId: string) =>
    onChange(currents.filter((c) => c.circuitId !== circuitId));

  return (
    <section className="currents" aria-label="Circuit currents">
      <h2>Circuit currents</h2>
      {!geometry && (
        <p className="muted small">
          Choose a geometry: currents are keyed by its circuits.
        </p>
      )}
      {geometry && rows.length === 0 && (
        <p className="muted small">The geometry has no circuits.</p>
      )}
      {rows.length > 0 && (
        <table className="table currents-table">
          <thead>
            <tr>
              <th scope="col">Circuit</th>
              <th scope="col">Current per turn [A]</th>
              <th scope="col">Waveform</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const points = row.current?.waveform?.times.length ?? 0;
              return (
                <Fragment key={row.id}>
                  <tr data-circuit={row.id}>
                    <th scope="row">
                      {row.name} <code className="muted">{row.id}</code>
                      {!row.inGeometry && (
                        <span className="badge badge-error" role="status">
                          Not in the geometry
                        </span>
                      )}
                    </th>
                    <td>
                      {row.current ? (
                        <NumberInput
                          aria-label={`Current of ${row.name}`}
                          value={row.current.current}
                          kind={DOUBLE}
                          readOnly={readOnly}
                          onChange={(current) =>
                            put(row.id, { current: Number(current) })
                          }
                        />
                      ) : (
                        <button
                          type="button"
                          disabled={readOnly}
                          onClick={() => put(row.id, { current: 0 })}
                        >
                          Set current of {row.name}
                        </button>
                      )}
                    </td>
                    <td>
                      {row.current && (
                        <button
                          type="button"
                          className="link"
                          aria-expanded={open === row.id}
                          onClick={() =>
                            setOpen((id) =>
                              id === row.id ? undefined : row.id,
                            )
                          }
                        >
                          {points ? `${points} points` : "Static"}
                        </button>
                      )}
                    </td>
                    <td>
                      {row.current && (
                        <button
                          type="button"
                          className="icon"
                          aria-label={`Remove current of ${row.name}`}
                          disabled={readOnly}
                          onClick={() => remove(row.id)}
                        >
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                  {open === row.id && row.current && (
                    <tr>
                      <td colSpan={4}>
                        <WaveformEditor
                          label={`Current of ${row.name}`}
                          unit="A"
                          value={row.current.waveform}
                          readOnly={readOnly}
                          onChange={(waveform) => put(row.id, { waveform })}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
      {unknown.length > 0 && (
        <p className="field-error" role="alert">
          {unknown.length === 1 ? "A current names" : "Currents name"} a circuit
          the geometry does not have; remove{" "}
          {unknown.length === 1 ? "it" : "them"} or choose another geometry
          version (D114).
        </p>
      )}
    </section>
  );
}
