import { RunState, type Run } from "../gen/nebula/core/v1/run_pb";
import { FailureReasonChip } from "./FailureReasonChip";
import { RUN_STATE_LABELS } from "./runLabels";

/** A Run's state (A§14.1), with the typed reason of a failure (A§3.7). */
export function RunStateBadge({ run }: { run: Run }) {
  const failure = run.attempts.at(-1)?.failure;
  return (
    <span className="run-state" data-state={RunState[run.state]}>
      <span className={`badge state-${RunState[run.state].toLowerCase()}`}>
        {RUN_STATE_LABELS[run.state]}
      </span>
      {run.state === RunState.FAILED && failure ? (
        <>
          {" "}
          <FailureReasonChip reason={failure} />
        </>
      ) : null}
      {run.cacheHit && <span className="badge badge-info">cache hit</span>}
    </span>
  );
}
