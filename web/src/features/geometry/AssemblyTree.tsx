import { create } from "@bufbuild/protobuf";
import { useId, useRef } from "react";
import { shortHash } from "../../entities/references";
import { newCircuitId } from "../../entities/content";
import type { EntityRef } from "../../gen/nebula/core/v1/entity_pb";
import {
  CircuitSchema,
  type Geometry,
  type GeometryTessellation,
} from "../../gen/nebula/core/v1/geometry_pb";
import { AddComponentMenu } from "./AddComponentMenu";
import { circuitRowId, newCircuitButtonId } from "./focus";
import { IssueMarker } from "./IssueList";
import { circuitPath, componentPath, issuesAt, SYMMETRY_PATH } from "./issues";
import {
  sameSelection,
  useGeometryView,
  useSelection,
  type Selection,
} from "./store";

/** The state chip of a component reference (A§4.2, D107). */
function refStateLabel(ref: EntityRef): string {
  switch (ref.state.case) {
    case "pinned":
      return `pinned ${shortHash(ref.state.value.versionHash)}`;
    case "latest":
      return "latest";
    case "draft":
      return "draft";
    default:
      return "unset";
  }
}

/** The next free "Circuit N" name. */
function circuitName(geometry: Geometry): string {
  const taken = new Set(geometry.circuits.map((circuit) => circuit.name));
  let n = geometry.circuits.length + 1;
  while (taken.has(`Circuit ${n}`)) n++;
  return `Circuit ${n}`;
}

/**
 * The assembly tree (docs/UI.md Section 6.3): symmetry, the referenced
 * components with their reference state, and the circuits with their stable
 * IDs (D114). Markers flag issues from the tessellation checks. Edits are
 * functions of the geometry, applied to what the editor holds when they
 * land: adding a component finishes after a request.
 */
export function AssemblyTree({
  projectId,
  geometryId,
  geometry,
  tessellation,
  names,
  onChange,
}: {
  projectId: string;
  geometryId: string;
  geometry: Geometry;
  tessellation: GeometryTessellation | undefined;
  names: ReadonlyMap<string, string>;
  onChange: (change: (geometry: Geometry) => Geometry) => void;
}) {
  const ids = useId();
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const addTrigger = useRef<HTMLButtonElement>(null);
  const selection = useSelection(geometryId);
  const select = useGeometryView((state) => state.select);
  const choose = (item: Selection) => select(geometryId, item);
  const referenced = new Set(geometry.components.map((ref) => ref.id));

  const item = (target: Selection) => ({
    className: "tree-item",
    "aria-current": sameSelection(selection, target)
      ? ("true" as const)
      : undefined,
    onClick: () => choose(target),
  });

  const addComponent = (ref: EntityRef) => {
    onChange((current) =>
      current.components.some((r) => r.id === ref.id)
        ? current
        : { ...current, components: [...current.components, ref] },
    );
    choose({ kind: "component", id: ref.id });
  };

  // Circuit members of a removed component go too: a member must be in the
  // geometry (D114).
  const removeComponent = (id: string) => {
    // Focus moves to a neighbouring row before this one goes.
    const index = geometry.components.findIndex((ref) => ref.id === id);
    const neighbour =
      geometry.components[index + 1] ?? geometry.components[index - 1];
    (
      (neighbour && rows.current.get(neighbour.id)) ??
      addTrigger.current
    )?.focus();
    onChange((current) => ({
      ...current,
      components: current.components.filter((ref) => ref.id !== id),
      circuits: current.circuits.map((circuit) => ({
        ...circuit,
        members: circuit.members.filter((member) => member.componentId !== id),
      })),
    }));
    if (sameSelection(selection, { kind: "component", id })) {
      select(geometryId, undefined);
    }
  };

  const addCircuit = () => {
    const circuit = create(CircuitSchema, {
      id: newCircuitId(),
      name: circuitName(geometry),
    });
    onChange((current) => ({
      ...current,
      circuits: [...current.circuits, circuit],
    }));
    choose({ kind: "circuit", id: circuit.id });
  };

  return (
    <nav className="assembly-tree" aria-label="Assembly">
      <ul className="tree-list">
        <li>
          <button type="button" {...item({ kind: "symmetry" })}>
            <span className="tree-label">Symmetry</span>
            <IssueMarker issues={issuesAt(tessellation, SYMMETRY_PATH)} />
          </button>
        </li>
      </ul>

      <h2 className="tree-heading" id={`${ids}-components`}>
        Components
      </h2>
      {geometry.components.length === 0 && (
        <p className="muted small">No components yet.</p>
      )}
      <ul className="tree-list" aria-labelledby={`${ids}-components`}>
        {geometry.components.map((ref) => {
          const name = names.get(ref.id) ?? ref.id;
          const built = tessellation?.components.find(
            (component) => component.componentId === ref.id,
          );
          return (
            <li key={ref.id} className="tree-row">
              <button
                type="button"
                ref={(element) => {
                  if (element) rows.current.set(ref.id, element);
                  else rows.current.delete(ref.id);
                }}
                {...item({ kind: "component", id: ref.id })}
              >
                <span className="tree-label">{name}</span>
                <span className="chip" data-state={ref.state.case}>
                  {refStateLabel(ref)}
                </span>
                <IssueMarker
                  issues={issuesAt(tessellation, componentPath(ref.id))}
                  buildError={built?.error}
                />
              </button>
              <button
                type="button"
                className="icon"
                aria-label={`Remove ${name} from geometry`}
                title="Remove from geometry"
                onClick={() => removeComponent(ref.id)}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
      <AddComponentMenu
        projectId={projectId}
        referenced={referenced}
        trigger={addTrigger}
        onAdd={addComponent}
      />

      <h2 className="tree-heading" id={`${ids}-circuits`}>
        Circuits
      </h2>
      {geometry.circuits.length === 0 && (
        <p className="muted small">No circuits yet.</p>
      )}
      <ul className="tree-list" aria-labelledby={`${ids}-circuits`}>
        {geometry.circuits.map((circuit) => (
          <li key={circuit.id}>
            <button
              type="button"
              id={circuitRowId(geometryId, circuit.id)}
              {...item({ kind: "circuit", id: circuit.id })}
            >
              <span className="tree-label">{circuit.name || "Unnamed"}</span>
              <code className="circuit-id">{circuit.id}</code>
              <IssueMarker
                issues={issuesAt(tessellation, circuitPath(circuit.id))}
              />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        id={newCircuitButtonId(geometryId)}
        className="tree-action"
        onClick={addCircuit}
      >
        New circuit
      </button>
    </nav>
  );
}
