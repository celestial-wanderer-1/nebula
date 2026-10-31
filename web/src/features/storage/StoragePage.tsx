import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { useParams } from "react-router";
import { errorMessage } from "../../api/errors";
import {
  useDeleteResults,
  useDependents,
  useEvict,
  useStorage,
} from "../../api/storage";
import {
  StorageClass,
  type PrimaryResult,
} from "../../gen/nebula/core/v1/storage_pb";

const CLASSES: Record<StorageClass, string> = {
  [StorageClass.UNSPECIFIED]: "Other",
  [StorageClass.PRIMARY]: "Primary results",
  [StorageClass.MESHES]: "Meshes",
  [StorageClass.DISCRETIZED]: "Discretized geometry",
  [StorageClass.FLUX_COORDINATES]: "Flux coordinates",
  [StorageClass.VIEW_PAYLOADS]: "View payloads",
  [StorageClass.CHECKPOINTS]: "Checkpoints",
  [StorageClass.LOGS]: "Logs",
};

function formatBytes(bytes: bigint): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = Number(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/**
 * Asks before deleting a Run's primary results, listing what refers to
 * them (D79, D141). Metadata and provenance stay.
 */
function DeleteDialog({
  projectId,
  result,
  onClose,
}: {
  projectId: string;
  result: PrimaryResult | undefined;
  onClose: () => void;
}) {
  const dependents = useDependents(projectId, result?.runId);
  const remove = useDeleteResults(projectId);
  return (
    <Dialog.Root
      open={Boolean(result)}
      onOpenChange={(open) => !open && onClose()}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog">
          <Dialog.Title>Delete results of {result?.runName}</Dialog.Title>
          <Dialog.Description>
            Deletes {result?.outputs} committed outputs (
            {result && formatBytes(result.bytes)}). The run’s record and
            provenance stay.
          </Dialog.Description>
          {dependents.isPending && (
            <p className="muted">Checking references…</p>
          )}
          {dependents.data?.length === 0 && (
            <p>Nothing refers to these outputs.</p>
          )}
          {dependents.data && dependents.data.length > 0 && (
            <div className="field-warning" role="alert">
              <p>
                These stored-output nodes refer to them and will no longer
                resolve:
              </p>
              <ul aria-label="Dependents">
                {dependents.data.map((d, i) => (
                  <li key={i}>
                    Workflow “{d.name}” {d.path}
                    {d.versionHash
                      ? ` (version ${d.versionHash.slice(7, 17)})`
                      : " (draft)"}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {remove.error && (
            <p className="field-error" role="alert">
              {errorMessage(remove.error)}
            </p>
          )}
          <div className="dialog-actions">
            <Dialog.Close asChild>
              <button type="button">Cancel</button>
            </Dialog.Close>
            <button
              type="button"
              className="danger"
              disabled={!dependents.data || remove.isPending}
              onClick={() =>
                result &&
                remove.mutate(
                  {
                    runIds: [result.runId],
                    acknowledgeDependents: Boolean(dependents.data?.length),
                  },
                  { onSuccess: onClose },
                )
              }
            >
              Delete results
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Project storage against its cap (docs/UI.md 6.10, A§4.7): evict derived
 * artifacts, and delete primary results after the dependency check.
 */
export function StoragePage() {
  const { projectId = "" } = useParams();
  const storage = useStorage(projectId);
  const evict = useEvict(projectId);
  const [deleting, setDeleting] = useState<PrimaryResult>();
  const usage = storage.data;
  if (!usage) {
    return storage.error ? (
      <p className="field-error" role="alert">
        {storage.error.message}
      </p>
    ) : (
      <p className="muted">Loading storage…</p>
    );
  }
  const share = Number(usage.usedBytes) / Number(usage.capBytes || 1n);
  return (
    <section className="storage-page">
      <h1>Storage</h1>
      <p>
        {formatBytes(usage.usedBytes)} of {formatBytes(usage.capBytes)} used.
      </p>
      <progress
        className="storage-bar"
        aria-label="Storage used"
        max={1}
        value={Math.min(1, share)}
      >
        {Math.round(share * 100)}%
      </progress>
      <table className="table" aria-label="Storage by class">
        <thead>
          <tr>
            <th scope="col">Class</th>
            <th scope="col">Size</th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {usage.categories.map((category) => (
            <tr key={category.storageClass}>
              <th scope="row">{CLASSES[category.storageClass]}</th>
              <td>{formatBytes(category.bytes)}</td>
              <td>
                {category.evictable && category.bytes > 0n && (
                  <button
                    type="button"
                    disabled={evict.isPending}
                    onClick={() => evict.mutate([category.storageClass])}
                  >
                    Evict {CLASSES[category.storageClass].toLowerCase()}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {evict.data && (
        <p role="status" aria-label="Eviction">
          Freed {formatBytes(evict.data.freedBytes)}.
        </p>
      )}
      <h2>Primary results</h2>
      <p className="muted small">
        Kept until you delete them; derived artifacts are rebuilt on demand.
      </p>
      <table className="table" aria-label="Primary results">
        <thead>
          <tr>
            <th scope="col">Run</th>
            <th scope="col">Outputs</th>
            <th scope="col">Size</th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {usage.results.map((result) => (
            <tr key={result.runId}>
              <th scope="row">{result.runName || result.runId}</th>
              <td>{result.outputs}</td>
              <td>{formatBytes(result.bytes)}</td>
              <td>
                <button
                  type="button"
                  className="danger"
                  onClick={() => setDeleting(result)}
                >
                  Delete results of {result.runName || result.runId}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <DeleteDialog
        projectId={projectId}
        result={deleting}
        onClose={() => setDeleting(undefined)}
      />
    </section>
  );
}
