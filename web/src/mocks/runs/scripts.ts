import { FailureReason } from "../../gen/nebula/core/v1/run_pb";

// Scripted Run behaviours (docs/UI.md Section 7): the flows of A§3.4 to
// A§3.7 with configurable timing. A script fails once; a resumed attempt
// runs on.

export interface RunScript {
  name: string;
  /** Mock milliseconds per step iteration. */
  iterationMs: number;
  iterations: number;
  prepareMs: number;
  /** The failure of the first attempt, if any. */
  failure?: {
    reason: FailureReason;
    /** Index of the executed step that fails; -1 fails in Preparing. */
    step: number;
    iteration: number;
    detail: string;
    /** Whether checkpoints were committed before the failure (D141). */
    checkpoint: boolean;
    rank?: number;
  };
}

const BASE = { iterationMs: 250, iterations: 6, prepareMs: 800 };

export const RUN_SCRIPTS = {
  success: { name: "success", ...BASE },
  slow: { name: "slow", ...BASE, iterationMs: 20_000, iterations: 90 },
  oom: {
    name: "oom",
    ...BASE,
    failure: {
      reason: FailureReason.OOM,
      step: 1,
      iteration: 3,
      detail: "Device memory exhausted in the pool allocator",
      checkpoint: true,
      rank: 0,
    },
  },
  diverged: {
    name: "diverged",
    ...BASE,
    failure: {
      reason: FailureReason.DIVERGED,
      step: 1,
      iteration: 4,
      detail: "Residual grew for 3 consecutive iterations",
      checkpoint: true,
    },
  },
  nan: {
    name: "nan",
    ...BASE,
    failure: {
      reason: FailureReason.NAN,
      step: 0,
      iteration: 2,
      detail: "NaN in output field",
      checkpoint: false,
    },
  },
  crashed: {
    name: "crashed",
    ...BASE,
    failure: {
      reason: FailureReason.CRASHED,
      step: 0,
      iteration: 2,
      detail: "Rank 1 exited with signal 11",
      checkpoint: false,
      rank: 1,
    },
  },
  supervisor_lost: {
    name: "supervisor_lost",
    ...BASE,
    failure: {
      reason: FailureReason.SUPERVISOR_LOST,
      step: 1,
      iteration: 2,
      detail: "Orphaned on supervisor restart",
      checkpoint: true,
    },
  },
  geometry_failed: {
    name: "geometry_failed",
    ...BASE,
    failure: {
      reason: FailureReason.GEOMETRY_FAILED,
      step: -1,
      iteration: 0,
      detail: "Gmsh could not mesh component cmp-vessel",
      checkpoint: false,
    },
  },
} satisfies Record<string, RunScript>;

export type RunScriptName = keyof typeof RUN_SCRIPTS;

export const isScriptName = (name: string): name is RunScriptName =>
  name in RUN_SCRIPTS;

/** A failure is resumable when transient and checkpointed (A§3.7, D141). */
export const TRANSIENT_FAILURES: ReadonlySet<FailureReason> = new Set([
  FailureReason.OOM,
  FailureReason.CRASHED,
  FailureReason.SUPERVISOR_LOST,
]);
