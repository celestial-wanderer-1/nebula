import { useState } from "react";
import { Link } from "react-router";
import { errorMessage } from "../../api/errors";
import { useDeleteMaterial, useMaterials } from "../../api/materials";
import { NewMaterialDialog } from "./NewMaterialDialog";
import { materialPath } from "./paths";

/** The project's materials (D127), with New and Delete. */
export function ProjectMaterials({ projectId }: { projectId: string }) {
  const materials = useMaterials(projectId);
  const remove = useDeleteMaterial(projectId);
  const [creating, setCreating] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();

  const runDelete = (id: string, name: string) => {
    setDeleteError(undefined);
    // A material a component still uses is refused with 409 "in_use".
    remove.mutate(id, {
      onError: (error) =>
        setDeleteError(`Cannot delete “${name}”: ${errorMessage(error)}`),
    });
  };

  return (
    <>
      <div className="page-header">
        <h2>Project materials</h2>
        <div className="actions">
          <button
            type="button"
            className="primary"
            onClick={() => setCreating(true)}
          >
            New material
          </button>
        </div>
      </div>
      {deleteError && (
        <p className="field-error" role="alert">
          {deleteError}
        </p>
      )}
      {materials.isPending && <p className="muted">Loading materials…</p>}
      {materials.error && (
        <p className="field-error" role="alert">
          {materials.error.message}
        </p>
      )}
      {materials.data?.length === 0 && (
        <p className="muted">
          No materials yet. Create one or import one from the global library.
        </p>
      )}
      {materials.data && materials.data.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Source</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {materials.data.map((material) => (
              <tr key={material.id}>
                <th scope="row">
                  <Link to={materialPath(projectId, material.id)}>
                    {material.name || material.id}
                  </Link>
                </th>
                <td>
                  {material.source ? (
                    <span className="badge badge-info">
                      library: {material.source.entryName}
                    </span>
                  ) : (
                    <span className="muted">Project</span>
                  )}
                </td>
                <td>
                  <div className="row-actions">
                    <button
                      type="button"
                      aria-label={`Delete ${material.name || material.id}`}
                      disabled={remove.isPending}
                      onClick={() =>
                        runDelete(material.id, material.name || material.id)
                      }
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <NewMaterialDialog
        projectId={projectId}
        open={creating}
        onOpenChange={setCreating}
      />
    </>
  );
}
