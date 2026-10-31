import { useState } from "react";
import { Link } from "react-router";
import { errorMessage } from "../../api/errors";
import {
  useImportComponent,
  useImportMaterial,
  useLibraryComponents,
  useLibraryMaterials,
} from "../../api/library";
import {
  componentPath,
  globalComponentPath,
  globalMaterialPath,
  materialPath,
} from "./paths";

interface Entry {
  id: string;
  name: string;
  description: string;
}

/** A project copy made by an import, linked from the success message. */
interface Imported {
  entryName: string;
  name: string;
  path: string;
}

/**
 * Entries of a user-global library with Import. An import copies the entry
 * into the project; the copy keeps a link to its source (D88).
 */
function GlobalEntries({
  title,
  noun,
  entries,
  error,
  isPending,
  entryPath,
  importEntry,
  importing,
}: {
  title: string;
  noun: string;
  entries: readonly Entry[] | undefined;
  error: Error | null;
  isPending: boolean;
  entryPath: (id: string) => string;
  importEntry: (entry: Entry) => Promise<Imported>;
  importing: boolean;
}) {
  const [imported, setImported] = useState<Imported>();
  const [importError, setImportError] = useState<string>();

  const runImport = (entry: Entry) => {
    setImported(undefined);
    setImportError(undefined);
    importEntry(entry).then(setImported, (e: unknown) =>
      setImportError(`Import of “${entry.name}” failed: ${errorMessage(e)}`),
    );
  };

  return (
    <>
      <div className="page-header">
        <h2>{title}</h2>
      </div>
      <p role="status" className="import-result">
        {imported && (
          <>
            Imported “{imported.entryName}” as project {noun}{" "}
            <Link to={imported.path}>{imported.name}</Link>.
          </>
        )}
      </p>
      {importError && (
        <p className="field-error" role="alert">
          {importError}
        </p>
      )}
      {isPending && <p className="muted">Loading the library…</p>}
      {error && (
        <p className="field-error" role="alert">
          {error.message}
        </p>
      )}
      {entries?.length === 0 && (
        <p className="muted">The global library has no {noun}s yet.</p>
      )}
      {entries && entries.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Description</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <th scope="row">
                  <Link to={entryPath(entry.id)}>{entry.name}</Link>
                </th>
                <td>{entry.description}</td>
                <td>
                  <div className="row-actions">
                    <button
                      type="button"
                      aria-label={`Import ${entry.name}`}
                      disabled={importing}
                      onClick={() => runImport(entry)}
                    >
                      Import
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export function GlobalComponents({ projectId }: { projectId: string }) {
  const entries = useLibraryComponents();
  const importComponent = useImportComponent(projectId);
  return (
    <GlobalEntries
      title="Global components"
      noun="component"
      entries={entries.data}
      error={entries.error}
      isPending={entries.isPending}
      entryPath={(id) => globalComponentPath(projectId, id)}
      importing={importComponent.isPending}
      importEntry={async (entry) => {
        const draft = await importComponent.mutateAsync(entry.id);
        return {
          entryName: entry.name,
          name: draft.name,
          path: componentPath(projectId, draft.id),
        };
      }}
    />
  );
}

export function GlobalMaterials({ projectId }: { projectId: string }) {
  const entries = useLibraryMaterials();
  const importMaterial = useImportMaterial(projectId);
  return (
    <GlobalEntries
      title="Global materials"
      noun="material"
      entries={entries.data}
      error={entries.error}
      isPending={entries.isPending}
      entryPath={(id) => globalMaterialPath(projectId, id)}
      importing={importMaterial.isPending}
      importEntry={async (entry) => {
        const material = await importMaterial.mutateAsync(entry.id);
        return {
          entryName: entry.name,
          name: material.name,
          path: materialPath(projectId, material.id),
        };
      }}
    />
  );
}
