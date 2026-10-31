import { useId, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { useEntities } from "../../api/entities";
import { errorMessage, NotFoundError, ValidationError } from "../../api/errors";
import {
  downloadStep,
  tessellationFingerprint,
  useGeometryTessellation,
} from "../../api/geometry";
import { ConflictDialog } from "../../entities/ConflictDialog";
import { packGeometry, unpackGeometry } from "../../entities/content";
import { shortHash } from "../../entities/references";
import { DraftViolations, SaveStatus } from "../../entities/SaveStatus";
import { useDraft } from "../../entities/useDraft";
import { VersionList } from "../../entities/VersionList";
import { EntityKind } from "../../gen/nebula/core/v1/entity_pb";
import type { Geometry } from "../../gen/nebula/core/v1/geometry_pb";
import { AssemblyTree } from "./AssemblyTree";
import { PropertyPanel } from "./PropertyPanel";
import { replicaRotations, replicatedComponents } from "./scene";
import { useGeometryView, useSelection } from "./store";
import { ViewportSlot } from "./ViewportSlot";

const NO_REPLICAS: ReadonlyMap<string, readonly number[]> = new Map();

/**
 * A readable name of a geometry field path, such as
 * "circuits.0.members.1.turns" -> "Circuit “PF”, member 2, turns".
 */
function describePath(
  geometry: Geometry,
  names: ReadonlyMap<string, string>,
  path: string,
): string {
  const [list, index, ...rest] = path.split(".");
  const at = Number(index);
  if (list === "components" && Number.isInteger(at)) {
    const id = geometry.components[at]?.id;
    const name = id ? `Component “${names.get(id) ?? id}”` : path;
    return rest.length ? `${name}, ${rest.join(".")}` : name;
  }
  if (list === "circuits" && Number.isInteger(at)) {
    const circuit = geometry.circuits[at];
    if (!circuit) return path;
    const parts = [`Circuit “${circuit.name || circuit.id}”`];
    const [members, member, ...field] = rest;
    if (members === "members" && Number.isInteger(Number(member))) {
      parts.push(`member ${Number(member) + 1}`, ...field);
    } else if (rest.length) {
      parts.push(rest.join("."));
    }
    return parts.join(", ");
  }
  return path;
}

/**
 * The geometry editor (docs/UI.md Section 6.3): assembly tree | viewport |
 * property panel. Edits go to the geometry draft through useDraft; each
 * accepted revision changes the tessellation fingerprint, so the viewport
 * refetches and replaces the mesh, never with an older build (D148).
 */
export function GeometryEditor() {
  const { projectId = "", geometryId = "" } = useParams();
  // Keyed: local edits and view state never carry over to another geometry.
  return (
    <Editor
      key={`${projectId}/${geometryId}`}
      projectId={projectId}
      geometryId={geometryId}
    />
  );
}

function Editor({
  projectId,
  geometryId,
}: {
  projectId: string;
  geometryId: string;
}) {
  const ids = useId();
  const draft = useDraft(projectId, EntityKind.GEOMETRY, geometryId);
  const components = useEntities(projectId, EntityKind.COMPONENT);
  const selection = useSelection(geometryId);
  const select = useGeometryView((state) => state.select);
  const showReplicas = useGeometryView((state) => state.showReplicas);
  const setShowReplicas = useGeometryView((state) => state.setShowReplicas);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [stepError, setStepError] = useState<string>();
  const [exporting, setExporting] = useState(false);

  // The editor shows local edits; the fingerprint follows what the server
  // accepted, since that is what it tessellates.
  const geometry = useMemo(
    () => unpackGeometry(draft.content),
    [draft.content],
  );
  const saved = useMemo(
    () => unpackGeometry(draft.draft?.content),
    [draft.draft?.content],
  );
  const fingerprint = tessellationFingerprint(
    draft.draft,
    saved.components,
    components.data,
  );
  const tessellation = useGeometryTessellation(
    projectId,
    geometryId,
    fingerprint,
  );

  const names = useMemo(
    () =>
      new Map(
        (components.data ?? []).map((summary) => [
          summary.id,
          summary.name || summary.id,
        ]),
      ),
    [components.data],
  );
  const replicas = useMemo(() => {
    if (!showReplicas) return NO_REPLICAS;
    const angles = replicaRotations(geometry.symmetry);
    return new Map(
      [...replicatedComponents(geometry)].map((id) => [id, angles]),
    );
  }, [geometry, showReplicas]);

  if (!draft.draft) {
    if (draft.error instanceof NotFoundError) {
      return (
        <section className="placeholder">
          <h1>Geometry not found</h1>
          <p>
            <Link to=".." relative="path">
              Back to geometries
            </Link>
          </p>
        </section>
      );
    }
    return draft.error ? (
      <p className="field-error" role="alert">
        {draft.error.message}
      </p>
    ) : (
      <p className="muted">Loading geometry…</p>
    );
  }

  const update = (next: Geometry) => draft.setContent(packGeometry(next));
  // Applies to the geometry as held when it runs, for edits that finish
  // after a request (D148).
  const updateWith = (change: (geometry: Geometry) => Geometry) =>
    draft.setContent((current) =>
      packGeometry(change(unpackGeometry(current))),
    );
  // The server builds STEP from its draft: export once it holds the edits.
  const stepBlocked = draft.status !== "saved";
  const exportStep = (versionHash?: string) => {
    setStepError(undefined);
    setExporting(true);
    downloadStep(projectId, geometryId, versionHash)
      .catch((error: unknown) =>
        setStepError(
          `STEP export${versionHash ? ` of ${shortHash(versionHash)}` : ""} failed: ${errorMessage(error)}`,
        ),
      )
      .finally(() => setExporting(false));
  };

  const built = tessellation.data?.components ?? [];
  const failed = built.filter((component) => component.error);
  // Symmetry violations show in its form, the name's at the name field and
  // any other in a list, so a rejected save always says why (Section 5).
  const violations =
    draft.error instanceof ValidationError ? draft.error.violations : [];
  const nameError = violations.find((v) => v.path === "name")?.message;
  const otherViolations = violations.filter(
    (v) => v.path !== "name" && !v.path.startsWith("symmetry."),
  );

  return (
    <section className="geometry-page">
      <div className="page-header">
        <h1>{draft.name || geometryId}</h1>
        <div className="actions">
          <button
            type="button"
            aria-expanded={versionsOpen}
            aria-controls={`${ids}-versions`}
            onClick={() => setVersionsOpen((open) => !open)}
          >
            Versions
          </button>
          <button
            type="button"
            className="primary"
            disabled={exporting || stepBlocked}
            aria-describedby={stepBlocked ? `${ids}-step-wait` : undefined}
            onClick={() => exportStep()}
          >
            Export STEP
          </button>
        </div>
      </div>
      {stepBlocked && (
        <p id={`${ids}-step-wait`} className="muted small">
          STEP export of the draft waits until your edits are saved.
        </p>
      )}

      <div className="geometry-header" role="group" aria-label="Geometry draft">
        <div className="field">
          <label htmlFor={`${ids}-name`}>Geometry name</label>
          <input
            id={`${ids}-name`}
            value={draft.name}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? `${ids}-name-error` : undefined}
            onChange={(event) => draft.setName(event.target.value)}
          />
          {nameError && (
            <p className="field-error" id={`${ids}-name-error`}>
              {nameError}
            </p>
          )}
        </div>
        <SaveStatus status={draft.status} />
      </div>
      {draft.error && !(draft.error instanceof ValidationError) && (
        <p className="field-error" role="alert">
          {draft.error.message}
        </p>
      )}
      <DraftViolations
        violations={otherViolations}
        describe={(path) => describePath(geometry, names, path)}
      />
      {stepError && (
        <p className="field-error" role="alert">
          {stepError}
        </p>
      )}
      {versionsOpen && (
        <div id={`${ids}-versions`} className="geometry-versions">
          <VersionList
            projectId={projectId}
            kind={EntityKind.GEOMETRY}
            id={geometryId}
            draft={draft.draft}
            actions={(version) => (
              <button
                type="button"
                disabled={exporting}
                onClick={() => exportStep(version.hash)}
              >
                Export STEP {shortHash(version.hash)}
              </button>
            )}
          />
        </div>
      )}

      <div className="geometry-editor">
        <div className="geometry-pane geometry-tree-pane">
          <AssemblyTree
            projectId={projectId}
            geometryId={geometryId}
            geometry={geometry}
            tessellation={tessellation.data}
            names={names}
            onChange={updateWith}
          />
        </div>

        <section
          className="geometry-pane geometry-viewport-pane"
          aria-label="Viewport"
        >
          <div className="viewport-toolbar">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={showReplicas}
                onChange={(event) => setShowReplicas(event.target.checked)}
              />
              Show symmetry replicas
            </label>
            {tessellation.isFetching && (
              <span className="muted small" role="status">
                Updating…
              </span>
            )}
          </div>
          {tessellation.error && (
            <p className="field-error" role="alert">
              Tessellation failed: {tessellation.error.message}
            </p>
          )}
          {failed.length > 0 && (
            <div className="build-errors" role="alert">
              <p>Some components could not be built:</p>
              <ul>
                {failed.map((component) => (
                  <li key={component.componentId}>
                    {names.get(component.componentId) ?? component.componentId}:{" "}
                    {component.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ViewportSlot
            geometryId={geometryId}
            components={built}
            replicas={replicas}
            selectedId={
              selection?.kind === "component" ? selection.id : undefined
            }
            onSelect={(id) => select(geometryId, { kind: "component", id })}
          />
        </section>

        <aside
          className="geometry-pane geometry-properties-pane"
          aria-label="Properties"
        >
          <PropertyPanel
            projectId={projectId}
            geometryId={geometryId}
            geometry={geometry}
            tessellation={tessellation.data}
            names={names}
            violations={violations}
            onChange={update}
          />
        </aside>
      </div>

      <ConflictDialog
        conflict={draft.conflict}
        onResolve={draft.resolveConflict}
      />
    </section>
  );
}
