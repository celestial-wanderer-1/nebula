import { create } from "@bufbuild/protobuf";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { NotFoundError, ValidationError } from "../../api/errors";
import { useAddMaterialToLibrary } from "../../api/library";
import {
  useDeleteMaterial,
  useMaterial,
  useUpdateMaterial,
} from "../../api/materials";
import { LibrarySourceLink } from "../../entities/LibrarySourceLink";
import { SaveStatus } from "../../entities/SaveStatus";
import type { DraftStatus } from "../../entities/useDraft";
import { ConfigForm } from "../../forms/ConfigForm";
import {
  MaterialPropertiesSchema,
  type Material,
  type MaterialProperties,
} from "../../gen/nebula/core/v1/material_pb";
import { globalMaterialPath, librariesPath } from "./paths";

/** A project material (D127): properties, add to library and delete. */
export function MaterialDetail() {
  const { projectId = "", materialId = "" } = useParams();
  const navigate = useNavigate();
  const material = useMaterial(projectId, materialId);
  // The server copies its stored material into the library, so an edit
  // still unsaved in the form would be left out (as for components).
  const [formStatus, setFormStatus] = useState<DraftStatus>("saved");
  const unsaved = formStatus !== "saved";
  const addToLibrary = useAddMaterialToLibrary();
  const remove = useDeleteMaterial(projectId);
  const back = librariesPath(projectId, "materials");

  if (material.error instanceof NotFoundError) {
    return (
      <section className="placeholder">
        <h1>Material not found</h1>
        <p>
          <Link to={back}>Back to libraries</Link>
        </p>
      </section>
    );
  }
  if (!material.data) {
    return <p className="muted">{material.error?.message ?? "Loading…"}</p>;
  }
  const m = material.data;

  return (
    <section className="library-detail">
      <p className="eyebrow">
        <Link to={back}>Libraries</Link> / Material
      </p>
      <div className="page-header">
        <h1>{m.name || m.id}</h1>
        <div className="actions">
          <button
            type="button"
            disabled={addToLibrary.isPending || unsaved}
            title={unsaved ? "Save your changes first" : undefined}
            onClick={() =>
              addToLibrary.mutate({
                projectId,
                itemId: materialId,
                description: "",
              })
            }
          >
            Add to global library
          </button>
          <button
            type="button"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(materialId, {
                onSuccess: () => void navigate(back),
              })
            }
          >
            Delete
          </button>
        </div>
      </div>
      {addToLibrary.data && (
        <p role="status">
          Added to the global library as{" "}
          <Link to={globalMaterialPath(projectId, addToLibrary.data.id)}>
            {addToLibrary.data.name}
          </Link>
          .
        </p>
      )}
      {addToLibrary.error && (
        <p className="field-error" role="alert">
          Adding to the global library failed: {addToLibrary.error.message}
        </p>
      )}
      {/* A component still using the material refuses the delete (409). */}
      {remove.error && (
        <p className="field-error" role="alert">
          Cannot delete “{m.name}”: {remove.error.message}
        </p>
      )}
      <LibrarySourceLink
        projectId={projectId}
        source={m.source}
        kind="material"
      />
      {/* Remount on another material so the form starts from its values. */}
      <MaterialForm
        key={m.id}
        projectId={projectId}
        material={m}
        onStatusChange={setFormStatus}
      />
    </section>
  );
}

/**
 * Name and properties with an explicit Save. Materials have no revisions:
 * the last write wins (D127).
 */
function MaterialForm({
  projectId,
  material,
  onStatusChange,
}: {
  projectId: string;
  material: Material;
  onStatusChange: (status: DraftStatus) => void;
}) {
  const ids = useId();
  const update = useUpdateMaterial(projectId);
  const [name, setName] = useState(material.name);
  const [properties, setProperties] = useState<MaterialProperties>(
    () => material.properties ?? create(MaterialPropertiesSchema),
  );
  const [dirty, setDirty] = useState(false);
  // Counts edits, so a save clears `dirty` only when nothing was edited
  // while it was in flight.
  const edits = useRef(0);
  const edited = () => {
    edits.current++;
    setDirty(true);
  };

  const violations =
    update.error instanceof ValidationError
      ? update.error.violations.map((violation) =>
          violation.path.startsWith("properties.")
            ? {
                ...violation,
                path: violation.path.slice("properties.".length),
              }
            : violation,
        )
      : [];
  const nameError = violations.find((v) => v.path === "name")?.message;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const sent = edits.current;
    update.mutate(
      { id: material.id, request: { name: name.trim(), properties } },
      { onSuccess: () => setDirty(edits.current !== sent) },
    );
  };

  let status: DraftStatus = "saved";
  if (update.isPending) status = "saving";
  else if (update.isError) status = "error";
  else if (dirty) status = "dirty";
  useEffect(() => onStatusChange(status), [onStatusChange, status]);

  return (
    <form className="stack material-form" onSubmit={submit}>
      <div className="field">
        <label htmlFor={`${ids}-name`}>Name</label>
        <input
          id={`${ids}-name`}
          required
          value={name}
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? `${ids}-name-error` : undefined}
          onChange={(event) => {
            setName(event.target.value);
            edited();
          }}
        />
        {nameError && (
          <p className="field-error" id={`${ids}-name-error`}>
            {nameError}
          </p>
        )}
      </div>
      <h2>Properties</h2>
      <ConfigForm
        schema={MaterialPropertiesSchema}
        value={properties}
        projectId={projectId}
        violations={violations}
        onChange={(next) => {
          setProperties(next);
          edited();
        }}
      />
      {update.error && !(update.error instanceof ValidationError) && (
        <p className="field-error" role="alert">
          {update.error.message}
        </p>
      )}
      <div className="actions">
        <button
          type="submit"
          className="primary"
          disabled={!dirty || update.isPending}
        >
          Save
        </button>
        <SaveStatus status={status} />
      </div>
    </form>
  );
}
