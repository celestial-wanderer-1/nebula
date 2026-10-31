import * as Dialog from "@radix-ui/react-dialog";
import { create } from "@bufbuild/protobuf";
import { useId, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ValidationError } from "../../api/errors";
import { useCreateEntity, useEntities } from "../../api/entities";
import { useProject } from "../../api/projects";
import { packGeometry } from "../../entities/content";
import { shortHash } from "../../entities/references";
import { EntityKind } from "../../gen/nebula/core/v1/entity_pb";
import { GeometrySchema } from "../../gen/nebula/core/v1/geometry_pb";
import { defaultSymmetry } from "./issues";

const editorPath = (projectId: string, geometryId: string) =>
  `/p/${encodeURIComponent(projectId)}/geometry/${encodeURIComponent(geometryId)}`;

/** The project's geometries (docs/UI.md Section 6.3), with create. */
export function GeometryList() {
  const { projectId = "" } = useParams();
  const geometries = useEntities(projectId, EntityKind.GEOMETRY);
  const [creating, setCreating] = useState(false);

  return (
    <section>
      <div className="page-header">
        <h1>Geometry</h1>
        <div className="actions">
          <button
            type="button"
            className="primary"
            onClick={() => setCreating(true)}
          >
            New geometry
          </button>
        </div>
      </div>

      {geometries.isPending && <p className="muted">Loading geometries…</p>}
      {geometries.error && (
        <p className="field-error" role="alert">
          {geometries.error.message}
        </p>
      )}
      {geometries.data?.length === 0 && (
        <p className="muted">No geometries yet.</p>
      )}
      {geometries.data && geometries.data.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Draft revision</th>
              <th scope="col">Head version</th>
            </tr>
          </thead>
          <tbody>
            {geometries.data.map((geometry) => (
              <tr key={geometry.id}>
                <th scope="row">
                  <Link to={editorPath(projectId, geometry.id)}>
                    {geometry.name || geometry.id}
                  </Link>
                </th>
                <td>{geometry.revision}</td>
                <td>
                  {geometry.headHash ? (
                    <code title={geometry.headHash}>
                      {shortHash(geometry.headHash)}
                    </code>
                  ) : (
                    <span className="muted">Never versioned</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <NewGeometryDialog
        projectId={projectId}
        open={creating}
        onOpenChange={setCreating}
      />
    </section>
  );
}

/**
 * Creates a geometry whose symmetry defaults from the project's concept
 * (D94, D98), then opens it.
 */
function NewGeometryDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const ids = useId();
  const navigate = useNavigate();
  const project = useProject(projectId);
  const createGeometry = useCreateEntity(projectId, EntityKind.GEOMETRY);
  const [name, setName] = useState("");
  const nameError =
    createGeometry.error instanceof ValidationError
      ? createGeometry.error.violations.find((v) => v.path === "name")?.message
      : undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const content = packGeometry(
      create(GeometrySchema, {
        symmetry: defaultSymmetry(project.data?.concept?.conceptId),
      }),
    );
    createGeometry.mutate(
      { name: name.trim(), content },
      {
        onSuccess: (draft) => {
          onOpenChange(false);
          setName("");
          void navigate(editorPath(projectId, draft.id));
        },
      },
    );
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) createGeometry.reset();
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog">
          <Dialog.Title>New geometry</Dialog.Title>
          <Dialog.Description>
            Starts empty, with the symmetry of the project’s concept.
          </Dialog.Description>
          <form onSubmit={submit} className="stack">
            <label htmlFor={`${ids}-name`}>Name</label>
            <input
              id={`${ids}-name`}
              required
              value={name}
              aria-invalid={nameError ? true : undefined}
              onChange={(event) => setName(event.target.value)}
            />
            {nameError && (
              <p className="field-error" role="alert">
                {nameError}
              </p>
            )}
            {createGeometry.error && !nameError && (
              <p className="field-error" role="alert">
                {createGeometry.error.message}
              </p>
            )}
            <div className="dialog-actions">
              <Dialog.Close asChild>
                <button type="button">Cancel</button>
              </Dialog.Close>
              <button
                type="submit"
                className="primary"
                disabled={createGeometry.isPending || project.isPending}
              >
                Create geometry
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
