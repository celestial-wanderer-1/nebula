import { useNavigate } from "react-router";
import { errorMessage } from "../api/errors";
import { useRerun, useRunAction } from "../api/runs";
import { RerunInputs, RunAction, type Run } from "../gen/nebula/core/v1/run_pb";
import { runActions } from "./runActions";

/**
 * A Run's actions (A§3.7, A§14.1). Only the actions valid in its state are
 * enabled: resume needs a transient failure and a checkpoint; a failure
 * that is not transient offers re-running with an edited workflow (D141).
 */
export function RunActionsBar({ run }: { run: Run }) {
  const navigate = useNavigate();
  const action = useRunAction(run.projectId);
  const rerun = useRerun(run.projectId);
  const valid = runActions(run);
  const busy = action.isPending || rerun.isPending;
  const act = (kind: RunAction) =>
    action.mutate({ runId: run.id, action: kind });
  const project = `/p/${encodeURIComponent(run.projectId)}`;
  return (
    <div className="run-actions" role="group" aria-label="Run actions">
      <button
        type="button"
        disabled={!valid.pause || busy}
        onClick={() => act(RunAction.PAUSE)}
      >
        Pause
      </button>
      <button
        type="button"
        disabled={!valid.resume || busy}
        onClick={() => act(RunAction.RESUME)}
      >
        Resume
      </button>
      <button
        type="button"
        disabled={!valid.cancel || busy}
        onClick={() => act(RunAction.CANCEL)}
      >
        Cancel
      </button>
      <button
        type="button"
        disabled={!valid.discard || busy}
        onClick={() => act(RunAction.DISCARD)}
      >
        Discard
      </button>
      <button
        type="button"
        disabled={!valid.rerun || busy}
        onClick={() =>
          rerun.mutate(
            { runId: run.id, inputs: RerunInputs.SAME },
            {
              onSuccess: (next) =>
                void navigate(`${project}/runs/${encodeURIComponent(next.id)}`),
            },
          )
        }
      >
        Re-run
      </button>
      <button
        type="button"
        disabled={!valid.rerunEdited || busy}
        onClick={() =>
          void navigate(
            `${project}/workflows/${encodeURIComponent(run.workflowId)}?rerun=${encodeURIComponent(run.id)}`,
          )
        }
      >
        Re-run with edited workflow
      </button>
      {(action.error ?? rerun.error) && (
        <p className="field-error" role="alert">
          {errorMessage(action.error ?? rerun.error)}
        </p>
      )}
    </div>
  );
}
