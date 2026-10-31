import { useState } from "react";
import { Link } from "react-router";
import { useDeleteEntity, useEntities } from "../../api/entities";
import { errorMessage } from "../../api/errors";
import { useMaterials } from "../../api/materials";
import { EntityKind } from "../../gen/nebula/core/v1/entity_pb";
import { useComponentInfos, useShapeName } from "./hooks";
import { NewComponentDialog } from "./NewComponentDialog";
import { componentPath } from "./paths";

/** The project's components, with New and Delete (docs/UI.md 6.2). */
export function ProjectComponents({ projectId }: { projectId: string }) {
  const components = useEntities(projectId, EntityKind.COMPONENT);
  const materials = useMaterials(projectId);
  const list = components.data ?? [];
  const infos = useComponentInfos(
    projectId,
    list.map((entry) => entry.id),
  );
  const shapeName = useShapeName();
  const remove = useDeleteEntity(projectId, EntityKind.COMPONENT);
  const [creating, setCreating] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();

  const materialName = (id: string) =>
    id
      ? (materials.data?.find((material) => material.id === id)?.name ?? id)
      : "—";

  const runDelete = (id: string, name: string) => {
    setDeleteError(undefined);
    // A component a geometry still uses is refused with 409 "in_use".
    remove.mutate(id, {
      onError: (error) =>
        setDeleteError(`Cannot delete “${name}”: ${errorMessage(error)}`),
    });
  };

  return (
    <>
      <div className="page-header">
        <h2>Project components</h2>
        <div className="actions">
          <button
            type="button"
            className="primary"
            onClick={() => setCreating(true)}
          >
            New component
          </button>
        </div>
      </div>
      {deleteError && (
        <p className="field-error" role="alert">
          {deleteError}
        </p>
      )}
      {components.isPending && <p className="muted">Loading components…</p>}
      {components.error && (
        <p className="field-error" role="alert">
          {components.error.message}
        </p>
      )}
      {components.data?.length === 0 && (
        <p className="muted">
          No components yet. Create one or import one from the global library.
        </p>
      )}
      {list.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Shape</th>
              <th scope="col">Material</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((entry) => {
              const info = infos.get(entry.id);
              return (
                <tr key={entry.id}>
                  <th scope="row">
                    <Link to={componentPath(projectId, entry.id)}>
                      {entry.name}
                    </Link>
                    {info?.sourceName && (
                      <span className="tags">
                        <span
                          className="badge badge-info"
                          title={`Imported from library entry “${info.sourceName}”`}
                        >
                          library
                        </span>
                      </span>
                    )}
                  </th>
                  {info?.error ? (
                    <td colSpan={2} className="muted" title={info.error}>
                      Content unavailable
                    </td>
                  ) : (
                    <>
                      <td>{info ? shapeName(info.shapeType) : "…"}</td>
                      <td>{info ? materialName(info.materialId) : "…"}</td>
                    </>
                  )}
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        aria-label={`Delete ${entry.name}`}
                        disabled={remove.isPending}
                        onClick={() => runDelete(entry.id, entry.name)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <NewComponentDialog
        projectId={projectId}
        open={creating}
        onOpenChange={setCreating}
      />
    </>
  );
}
