import { create, ScalarType } from "@bufbuild/protobuf";
import { useEffect, useId, useRef, useState } from "react";
import { numericKind, type NumericKind } from "../../forms/values";
import { NumberInput } from "../../forms/widgets/NumberInput";
import {
  CircuitMemberSchema,
  type Circuit,
  type CircuitMember,
} from "../../gen/nebula/core/v1/geometry_pb";
import type { ValidationIssue } from "../../gen/nebula/core/v1/project_pb";
import { IssueList } from "./IssueList";
import { useComponentTraits } from "./useComponentTraits";

/**
 * Editor of one circuit (D114): name, its stable ID, replication over the
 * field periods and the members. Only current-carrying components of this
 * geometry can be members, each once; turns are signed (winding direction)
 * and never 0.
 */
export function CircuitEditor({
  projectId,
  circuit,
  componentIds,
  names,
  issues,
  onChange,
  onDelete,
}: {
  projectId: string;
  circuit: Circuit;
  /** Components the geometry references. */
  componentIds: readonly string[];
  names: ReadonlyMap<string, string>;
  issues: readonly ValidationIssue[];
  onChange: (circuit: Circuit) => void;
  onDelete: () => void;
}) {
  const ids = useId();
  const { traits, pending } = useComponentTraits(projectId, componentIds);
  const eligible = componentIds.filter((id) => traits.get(id)?.currentCarrying);
  const nameOf = (id: string) => names.get(id) ?? id;
  const rows = useRowKeys(circuit.members.length);
  const taken = new Set(circuit.members.map((member) => member.componentId));
  const free = eligible.filter((id) => !taken.has(id));
  const removeButtons = useRef(new Map<number, HTMLButtonElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  // "Add member" is enabled only once the removal has rendered.
  const focusAdd = useRef(false);
  useEffect(() => {
    if (!focusAdd.current) return;
    focusAdd.current = false;
    addButton.current?.focus();
  });

  const setMember = (index: number, change: Partial<CircuitMember>) =>
    onChange({
      ...circuit,
      members: circuit.members.map((member, i) =>
        i === index ? { ...member, ...change } : member,
      ),
    });

  // Focus moves to a neighbouring row's Remove, else to "Add member", so it
  // never falls back to the document.
  const removeMember = (index: number) => {
    const neighbour =
      rows.keys[index + 1] ?? (index > 0 ? rows.keys[index - 1] : undefined);
    const next =
      neighbour === undefined
        ? undefined
        : removeButtons.current.get(neighbour);
    if (next) next.focus();
    else focusAdd.current = true;
    rows.remove(index);
    onChange({
      ...circuit,
      members: circuit.members.filter((_, i) => i !== index),
    });
  };

  const addMember = () => {
    const componentId = free[0];
    if (!componentId) return;
    rows.add();
    onChange({
      ...circuit,
      members: [
        ...circuit.members,
        create(CircuitMemberSchema, { componentId, turns: 1, seriesGroup: 0 }),
      ],
    });
  };

  return (
    <div className="circuit-editor">
      <div className="field">
        <label htmlFor={`${ids}-name`}>Circuit name</label>
        <input
          id={`${ids}-name`}
          value={circuit.name}
          onChange={(event) =>
            onChange({ ...circuit, name: event.target.value })
          }
        />
      </div>
      <div className="field">
        <label htmlFor={`${ids}-id`}>Circuit ID</label>
        <input id={`${ids}-id`} value={circuit.id} readOnly />
        <p className="field-help">
          Stable across versions; runs and conductor networks refer to it.
        </p>
      </div>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={circuit.replicateOverPeriods}
          onChange={(event) =>
            onChange({ ...circuit, replicateOverPeriods: event.target.checked })
          }
        />
        Replicate over field periods
      </label>

      <IssueList issues={issues} label="Circuit issues" />

      <h3>Members</h3>
      {circuit.members.length === 0 ? (
        <p className="muted small">No members yet.</p>
      ) : (
        <table className="table members" aria-label="Members">
          <thead>
            <tr>
              <th scope="col">Component</th>
              <th scope="col">Turns</th>
              <th scope="col">Series group</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {circuit.members.map((member, index) => {
              const n = index + 1;
              const listed = eligible.includes(member.componentId);
              // Keyed per row, not position: an input's unparsed text stays
              // with its member when another is removed.
              return (
                <tr key={rows.keys[index]}>
                  <td>
                    <select
                      aria-label={`Member ${n} component`}
                      value={member.componentId}
                      onChange={(event) =>
                        setMember(index, { componentId: event.target.value })
                      }
                    >
                      {/* A member the checks reject stays visible (D114). */}
                      {!listed && (
                        <option value={member.componentId}>
                          {member.componentId
                            ? `${nameOf(member.componentId)} (not eligible)`
                            : "Choose a component"}
                        </option>
                      )}
                      {eligible.map((id) => (
                        <option
                          key={id}
                          value={id}
                          disabled={id !== member.componentId && taken.has(id)}
                        >
                          {nameOf(id)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <IntegerInput
                      label={`Member ${n} turns`}
                      value={member.turns}
                      kind={INT32}
                      check={(turns) =>
                        turns === 0
                          ? "Must not be 0; the sign sets the winding direction"
                          : undefined
                      }
                      onChange={(turns) => setMember(index, { turns })}
                    />
                  </td>
                  <td>
                    <IntegerInput
                      label={`Member ${n} series group`}
                      value={member.seriesGroup}
                      kind={UINT32}
                      onChange={(seriesGroup) =>
                        setMember(index, { seriesGroup })
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      aria-label={`Remove member ${n}`}
                      ref={(element) => {
                        const key = rows.keys[index]!;
                        if (element) removeButtons.current.set(key, element);
                        else removeButtons.current.delete(key);
                      }}
                      onClick={() => removeMember(index)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {!pending && eligible.length === 0 && (
        <p className="muted small">
          No current-carrying component in this geometry yet.
        </p>
      )}
      {!pending && eligible.length > 0 && free.length === 0 && (
        <p className="muted small">
          Every current-carrying component is already a member.
        </p>
      )}
      <div className="actions">
        <button
          type="button"
          ref={addButton}
          onClick={addMember}
          disabled={pending || free.length === 0}
        >
          Add member
        </button>
        <button type="button" onClick={onDelete}>
          Delete circuit
        </button>
      </div>
    </div>
  );
}

/**
 * Stable keys of list rows, kept in step with adds and removes made here. A
 * length change from elsewhere (another client) starts afresh.
 */
function useRowKeys(length: number) {
  const [state, setState] = useState(() => ({
    keys: Array.from({ length }, (_, i) => i),
    next: length,
  }));
  let current = state;
  if (current.keys.length !== length) {
    current = {
      keys: Array.from({ length }, (_, i) => state.next + i),
      next: state.next + length,
    };
    setState(current);
  }
  return {
    keys: current.keys,
    add: () =>
      setState((s) => ({ keys: [...s.keys, s.next], next: s.next + 1 })),
    remove: (index: number) =>
      setState((s) => ({ ...s, keys: s.keys.filter((_, i) => i !== index) })),
  };
}

// CircuitMember.turns is int32, series_group uint32 (geometry.proto).
const INT32: NumericKind = numericKind(ScalarType.INT32);
const UINT32: NumericKind = numericKind(ScalarType.UINT32);

/**
 * A member's integer field: the forms' NumberInput, which holds the text
 * until it parses, plus an optional rule of the circuit's (`check`).
 */
function IntegerInput({
  label,
  value,
  kind,
  check,
  onChange,
}: {
  label: string;
  value: number;
  kind: NumericKind;
  check?: (value: number) => string | undefined;
  onChange: (value: number) => void;
}) {
  const id = useId();
  const [error, setError] = useState<string>();
  return (
    <>
      <NumberInput
        id={id}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        value={value}
        kind={kind}
        validate={check && ((next) => check(Number(next)))}
        onParseError={setError}
        onChange={(next) => onChange(Number(next))}
      />
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </>
  );
}
