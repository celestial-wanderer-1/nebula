import { useState } from "react";
import { ComponentEditor } from "../../entities/ComponentEditor";
import { ReferencePicker } from "../../entities/ReferencePicker";
import { shortHash } from "../../entities/references";
import { ConfigForm } from "../../forms/ConfigForm";
import { newMessage } from "../../forms/defaults";
import { EntityKind, type EntityRef } from "../../gen/nebula/core/v1/entity_pb";
import type { FieldViolation } from "../../gen/nebula/core/v1/errors_pb";
import {
  SymmetrySchema,
  type Geometry,
  type GeometryTessellation,
} from "../../gen/nebula/core/v1/geometry_pb";
import { CircuitEditor } from "./CircuitEditor";
import { focusCircuitNeighbour } from "./focus";
import { IssueList } from "./IssueList";
import { circuitPath, componentPath, issuesAt, SYMMETRY_PATH } from "./issues";
import { useGeometryView, useSelection } from "./store";

/** What a non-draft reference shows, for the notice. */
function trackedState(ref: EntityRef): string | undefined {
  switch (ref.state.case) {
    case "pinned":
      return `pinned version ${shortHash(ref.state.value.versionHash)}`;
    case "latest":
      return "the latest version";
    default:
      return undefined;
  }
}

/**
 * The property panel of the geometry editor, by selection: the symmetry
 * form (D94), a component's reference and editor, or a circuit (D114).
 */
export function PropertyPanel({
  projectId,
  geometryId,
  geometry,
  tessellation,
  names,
  violations,
  onChange,
}: {
  projectId: string;
  geometryId: string;
  geometry: Geometry;
  tessellation: GeometryTessellation | undefined;
  names: ReadonlyMap<string, string>;
  /** Server violations of the geometry draft, by field path. */
  violations: readonly FieldViolation[];
  onChange: (geometry: Geometry) => void;
}) {
  const selection = useSelection(geometryId);
  const select = useGeometryView((state) => state.select);

  if (!selection) {
    return (
      <p className="muted">
        Select symmetry, a component or a circuit in the assembly tree or the
        viewport.
      </p>
    );
  }

  if (selection.kind === "symmetry") {
    return (
      <>
        <h2>Symmetry</h2>
        {!geometry.symmetry && (
          <p className="field-warning" role="note">
            Not set yet: every geometry needs its symmetry (D94). Editing a
            field below sets it.
          </p>
        )}
        <IssueList
          issues={issuesAt(tessellation, SYMMETRY_PATH)}
          label="Symmetry issues"
        />
        <ConfigForm
          schema={SymmetrySchema}
          value={geometry.symmetry ?? newMessage(SymmetrySchema)}
          projectId={projectId}
          violations={violations
            .filter((violation) => violation.path.startsWith("symmetry."))
            .map((violation) => ({
              ...violation,
              path: violation.path.slice("symmetry.".length),
            }))}
          onChange={(symmetry) => onChange({ ...geometry, symmetry })}
        />
      </>
    );
  }

  if (selection.kind === "component") {
    const ref = geometry.components.find((r) => r.id === selection.id);
    if (!ref) {
      return <p className="muted">This component is not in the geometry.</p>;
    }
    // Keyed: an error about one component's reference never shows on another.
    return (
      <ComponentProperties
        key={ref.id}
        projectId={projectId}
        geometryId={geometryId}
        geometry={geometry}
        reference={ref}
        tessellation={tessellation}
        names={names}
        onChange={onChange}
      />
    );
  }

  const circuit = geometry.circuits.find((c) => c.id === selection.id);
  if (!circuit) {
    return <p className="muted">This circuit is not in the geometry.</p>;
  }
  return (
    <>
      <h2>{circuit.name || "Unnamed circuit"}</h2>
      <CircuitEditor
        key={circuit.id}
        projectId={projectId}
        circuit={circuit}
        componentIds={geometry.components.map((ref) => ref.id)}
        names={names}
        issues={issuesAt(tessellation, circuitPath(circuit.id))}
        onChange={(next) =>
          onChange({
            ...geometry,
            circuits: geometry.circuits.map((c) => (c === circuit ? next : c)),
          })
        }
        onDelete={() => {
          focusCircuitNeighbour(geometryId, geometry.circuits, circuit.id);
          onChange({
            ...geometry,
            circuits: geometry.circuits.filter((c) => c !== circuit),
          });
          select(geometryId, undefined);
        }}
      />
    </>
  );
}

/** A component of the geometry: its reference, build state and editor. */
function ComponentProperties({
  projectId,
  geometryId,
  geometry,
  reference: ref,
  tessellation,
  names,
  onChange,
}: {
  projectId: string;
  geometryId: string;
  geometry: Geometry;
  reference: EntityRef;
  tessellation: GeometryTessellation | undefined;
  names: ReadonlyMap<string, string>;
  onChange: (geometry: Geometry) => void;
}) {
  const select = useGeometryView((state) => state.select);
  const [refError, setRefError] = useState<string>();
  const built = tessellation?.components.find(
    (component) => component.componentId === ref.id,
  );
  const tracked = trackedState(ref);
  const changeRef = (next: EntityRef) => {
    setRefError(undefined);
    if (next.id === ref.id) {
      onChange({
        ...geometry,
        components: geometry.components.map((r) => (r === ref ? next : r)),
      });
      return;
    }
    if (geometry.components.some((r) => r.id === next.id)) {
      setRefError(
        `${names.get(next.id) ?? next.id} is already in this geometry.`,
      );
      return;
    }
    // Another component takes this one's place, in circuits too.
    onChange({
      ...geometry,
      components: geometry.components.map((r) => (r === ref ? next : r)),
      circuits: geometry.circuits.map((circuit) => ({
        ...circuit,
        members: circuit.members.map((member) =>
          member.componentId === ref.id
            ? { ...member, componentId: next.id }
            : member,
        ),
      })),
    });
    select(geometryId, { kind: "component", id: next.id });
  };
  return (
    <>
      <h2>{names.get(ref.id) ?? ref.id}</h2>
      <ReferencePicker
        projectId={projectId}
        kind={EntityKind.COMPONENT}
        label="Reference"
        value={ref}
        onChange={changeRef}
      />
      {refError && (
        <p className="field-error" role="alert">
          {refError}
        </p>
      )}
      {tracked && (
        <p className="field-warning" role="note">
          This geometry uses {tracked}; draft edits appear here once the
          reference tracks the draft.
        </p>
      )}
      {built?.error && (
        <p className="field-error" role="alert">
          Build failed: {built.error}
        </p>
      )}
      <IssueList
        issues={issuesAt(tessellation, componentPath(ref.id))}
        label="Component issues"
      />
      <ComponentEditor projectId={projectId} componentId={ref.id} />
    </>
  );
}
