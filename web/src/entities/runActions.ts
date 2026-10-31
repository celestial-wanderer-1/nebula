import {
  FailureReason,
  RunState,
  type Run,
} from "../gen/nebula/core/v1/run_pb";

// Which actions a Run offers in which state (A§3.7, A§14.1, D141). Pure,
// so the matrix is tested on its own and the UI only enables valid ones.

export interface RunActions {
  pause: boolean;
  resume: boolean;
  cancel: boolean;
  discard: boolean;
  /** Re-run with the same or the latest inputs (D101). */
  rerun: boolean;
  /** Re-run with an edited workflow (D141). */
  rerunEdited: boolean;
}

/** Transient reasons; resume also needs a checkpoint (A§3.7, A§6.8). */
export const TRANSIENT_REASONS: ReadonlySet<FailureReason> = new Set([
  FailureReason.OOM,
  FailureReason.CRASHED,
  FailureReason.SUPERVISOR_LOST,
]);

const TERMINAL: ReadonlySet<RunState> = new Set([
  RunState.COMPLETED,
  RunState.FAILED,
  RunState.CANCELLED,
  RunState.DISCARDED,
]);

export const isTerminal = (state: RunState) => TERMINAL.has(state);

/** Whether a failed Run may resume from its checkpoint (D141). */
export function canResumeFailure(run: Run): boolean {
  const attempt = run.attempts.at(-1);
  return (
    run.state === RunState.FAILED &&
    Boolean(attempt?.hasCheckpoint) &&
    TRANSIENT_REASONS.has(attempt?.failure ?? FailureReason.UNSPECIFIED)
  );
}

export function runActions(run: Run): RunActions {
  const { state } = run;
  return {
    pause: state === RunState.RUNNING,
    resume: state === RunState.PAUSED || canResumeFailure(run),
    cancel:
      state === RunState.QUEUED ||
      state === RunState.PREPARING ||
      state === RunState.RUNNING ||
      state === RunState.PAUSED,
    discard: state === RunState.FAILED,
    rerun: TERMINAL.has(state),
    rerunEdited: TERMINAL.has(state),
  };
}
