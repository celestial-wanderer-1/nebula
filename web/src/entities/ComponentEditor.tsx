import { useEffect, useId, useMemo } from "react";
import { NotFoundError, ValidationError } from "../api/errors";
import { useMaterials } from "../api/materials";
import { usePlugins } from "../api/plugins";
import { ConfigForm } from "../forms/ConfigForm";
import { EntityKind } from "../gen/nebula/core/v1/entity_pb";
import { ExtensionKind } from "../gen/nebula/core/v1/plugin_pb";
import { useSchema } from "../schema/context";
import { ConflictDialog } from "./ConflictDialog";
import { packComponent, unpackComponent, withShape } from "./content";
import { LibrarySourceLink } from "./LibrarySourceLink";
import { DraftViolations, SaveStatus } from "./SaveStatus";
import { useDraft, type DraftStatus } from "./useDraft";

/**
 * Editor of a component draft: name, shape form, material and library
 * source (A§4.1). Shared by the libraries and geometry features. A shape
 * type the registry lacks stays read-only and is never dropped.
 * `onStatusChange` lets a page hold back actions that read the server's
 * draft while an edit is unsaved.
 */
export function ComponentEditor({
  projectId,
  componentId,
  onStatusChange,
}: {
  projectId: string;
  componentId: string;
  onStatusChange?: (status: DraftStatus) => void;
}) {
  const ids = useId();
  const { typeRegistry } = useSchema();
  const plugins = usePlugins();
  const materials = useMaterials(projectId);
  const draft = useDraft(projectId, EntityKind.COMPONENT, componentId);
  const { component, shapeDesc, shape, shapeType } = useMemo(
    () => unpackComponent(draft.content, typeRegistry),
    [draft.content, typeRegistry],
  );
  useEffect(
    () => onStatusChange?.(draft.status),
    [onStatusChange, draft.status],
  );

  if (!draft.draft) {
    if (draft.error instanceof NotFoundError) {
      return <p className="muted">Component not found.</p>;
    }
    return draft.error ? (
      <p className="field-error" role="alert">
        {draft.error.message}
      </p>
    ) : (
      <p className="muted">Loading component…</p>
    );
  }

  const shapeName =
    plugins.data
      ?.flatMap((plugin) => plugin.extensions)
      .find(
        (extension) =>
          extension.kind === ExtensionKind.GEOMETRY_COMPONENT &&
          extension.configMessage === shapeType,
      )?.displayName ||
    shapeDesc?.name ||
    shapeType ||
    "None";

  // Violations of the shape come back under `shape.` (Component field);
  // the name's show at the name field, any other in a list.
  const violations =
    draft.error instanceof ValidationError ? draft.error.violations : [];
  const shapeViolations = violations
    .filter((violation) => violation.path.startsWith("shape."))
    .map((violation) => ({
      ...violation,
      path: violation.path.slice("shape.".length),
    }));
  const nameError = violations.find((v) => v.path === "name")?.message;
  const otherViolations = violations.filter(
    (v) => v.path !== "name" && !v.path.startsWith("shape."),
  );
  const materialList = materials.data ?? [];
  const missingMaterial =
    component.materialId !== "" &&
    !materialList.some((material) => material.id === component.materialId);

  return (
    <div className="component-editor">
      <div className="field">
        <label htmlFor={`${ids}-name`}>Name</label>
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
      <p>
        <SaveStatus status={draft.status} />
      </p>
      {draft.error && !(draft.error instanceof ValidationError) && (
        <p className="field-error" role="alert">
          {draft.error.message}
        </p>
      )}
      <DraftViolations violations={otherViolations} />

      <LibrarySourceLink
        projectId={projectId}
        source={component.source}
        kind="component"
      />

      <dl className="details">
        <dt>Shape</dt>
        <dd data-shape-type={shapeType}>{shapeName}</dd>
      </dl>

      {shapeDesc && shape ? (
        <ConfigForm
          schema={shapeDesc}
          value={shape}
          projectId={projectId}
          violations={shapeViolations}
          onChange={(next) =>
            draft.setContent(
              packComponent(withShape(component, shapeDesc, next)),
            )
          }
        />
      ) : (
        shapeType && (
          <p className="field-warning" role="note">
            Shape type “{shapeType}” is not known to this UI (its plugin may be
            missing or disabled). It is kept unchanged and cannot be edited
            here.
          </p>
        )
      )}

      <div className="field">
        <label htmlFor={`${ids}-material`}>Material</label>
        <select
          id={`${ids}-material`}
          value={component.materialId}
          onChange={(event) =>
            draft.setContent(
              packComponent({ ...component, materialId: event.target.value }),
            )
          }
        >
          <option value="">None</option>
          {/* Keep a reference the list does not (yet) hold selectable. */}
          {missingMaterial && (
            <option value={component.materialId}>
              {materials.isPending ? "Loading…" : component.materialId}
            </option>
          )}
          {materialList.map((material) => (
            <option key={material.id} value={material.id}>
              {material.name || material.id}
            </option>
          ))}
        </select>
        {materials.error && (
          <p className="field-error" role="alert">
            {materials.error.message}
          </p>
        )}
      </div>

      <ConflictDialog
        conflict={draft.conflict}
        onResolve={draft.resolveConflict}
      />
    </div>
  );
}
