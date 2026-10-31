import { Link } from "react-router";
import { errorMessage } from "../../api/errors";
import { useCancelQueued, useQueue, useReorderQueue } from "../../api/queue";
import { RUN_STATE_LABELS } from "../../entities/runLabels";
import { RunState } from "../../gen/nebula/core/v1/run_pb";
import { runPath } from "./paths";

/**
 * The FIFO queue shared across projects (D100, D102): waiting Runs in
 * order, with Preparing shown (D121), then running ones with their GPU
 * subsets (D40). Waiting Runs reorder; any active Run cancels.
 */
export function QueueView() {
  const queue = useQueue();
  const reorder = useReorderQueue();
  const cancel = useCancelQueued();
  if (queue.isPending) return <p className="muted">Loading the queue…</p>;
  if (queue.error) {
    return (
      <p className="field-error" role="alert">
        {queue.error.message}
      </p>
    );
  }
  const waiting = queue.data.filter((e) => e.position > 0);
  if (queue.data.length === 0) {
    return <p className="muted">The queue is empty.</p>;
  }
  return (
    <>
      <table className="table" aria-label="Queue">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Run</th>
            <th scope="col">Project</th>
            <th scope="col">State</th>
            <th scope="col">GPUs</th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {queue.data.map((entry) => {
            const name = entry.runName || entry.runId;
            return (
              <tr key={entry.runId} data-run={entry.runId}>
                <td>{entry.position || ""}</td>
                <th scope="row">
                  <Link to={runPath(entry.projectId, entry.runId)}>{name}</Link>
                </th>
                <td>{entry.projectName}</td>
                <td>{RUN_STATE_LABELS[entry.state]}</td>
                <td>
                  {entry.gpus}
                  {entry.gpuIndices.length > 0 && (
                    <span className="muted">
                      {" "}
                      (GPU {entry.gpuIndices.join(", ")})
                    </span>
                  )}
                </td>
                <td className="row-actions">
                  {entry.position > 0 && (
                    <>
                      <button
                        type="button"
                        className="icon"
                        aria-label={`Move ${name} up`}
                        disabled={entry.position === 1 || reorder.isPending}
                        onClick={() =>
                          reorder.mutate({
                            runId: entry.runId,
                            position: entry.position - 1,
                          })
                        }
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="icon"
                        aria-label={`Move ${name} down`}
                        disabled={
                          entry.position === waiting.length || reorder.isPending
                        }
                        onClick={() =>
                          reorder.mutate({
                            runId: entry.runId,
                            position: entry.position + 1,
                          })
                        }
                      >
                        ↓
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    disabled={
                      cancel.isPending || entry.state === RunState.UNSPECIFIED
                    }
                    onClick={() => cancel.mutate(entry.runId)}
                  >
                    Cancel {name}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {(reorder.error ?? cancel.error) && (
        <p className="field-error" role="alert">
          {errorMessage(reorder.error ?? cancel.error)}
        </p>
      )}
    </>
  );
}
