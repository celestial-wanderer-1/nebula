import { useSyncExternalStore } from "react";
import type { LogLine, Residual } from "../gen/nebula/core/v1/run_pb";
import { RingBuffer } from "./ringBuffer";

// Progress of Runs from /ws/runs/{r}: bounded ring buffers per Run, outside
// the query cache (docs/UI.md Section 4.3). Best-effort: a buffer drops its
// oldest entries, and frames lost while disconnected are gone (D106).

export const LOG_CAPACITY = 2000;
export const RESIDUAL_CAPACITY = 500;

export interface RunProgress {
  logs: readonly LogLine[];
  droppedLogs: number;
  /** Residual series per node ID. */
  residuals: ReadonlyMap<string, readonly Residual[]>;
  checkpoints: number;
}

interface Held {
  logs: RingBuffer<LogLine>;
  residuals: Map<string, RingBuffer<Residual>>;
  checkpoints: number;
  snapshot?: RunProgress;
}

const held = new Map<string, Held>();
const listeners = new Map<string, Set<() => void>>();
const pending = new Set<string>();
let scheduled = false;

const EMPTY: RunProgress = {
  logs: [],
  droppedLogs: 0,
  residuals: new Map(),
  checkpoints: 0,
};

function entry(runId: string): Held {
  let found = held.get(runId);
  if (!found) {
    found = {
      logs: new RingBuffer(LOG_CAPACITY),
      residuals: new Map(),
      checkpoints: 0,
    };
    held.set(runId, found);
  }
  return found;
}

/** Notifies subscribers at most once per frame, however fast frames come. */
function changed(runId: string): void {
  const run = held.get(runId);
  if (run) run.snapshot = undefined;
  pending.add(runId);
  if (scheduled) return;
  scheduled = true;
  const flush = () => {
    scheduled = false;
    const ids = [...pending];
    pending.clear();
    for (const id of ids) {
      for (const listener of listeners.get(id) ?? []) listener();
    }
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(flush);
  } else {
    setTimeout(flush, 16);
  }
}

export const runProgress = {
  addLog(runId: string, line: LogLine): void {
    entry(runId).logs.push(line);
    changed(runId);
  },

  addResidual(runId: string, residual: Residual): void {
    const run = entry(runId);
    let series = run.residuals.get(residual.nodeId);
    if (!series) {
      series = new RingBuffer(RESIDUAL_CAPACITY);
      run.residuals.set(residual.nodeId, series);
    }
    series.push(residual);
    changed(runId);
  },

  addCheckpoint(runId: string): void {
    entry(runId).checkpoints += 1;
    changed(runId);
  },

  /** Forgets a Run's progress: the server replays what it holds on connect. */
  reset(runId: string): void {
    held.delete(runId);
    changed(runId);
  },

  snapshot(runId: string): RunProgress {
    const run = held.get(runId);
    if (!run) return EMPTY;
    run.snapshot ??= {
      logs: [...run.logs.toArray()],
      droppedLogs: run.logs.dropped,
      residuals: new Map(
        [...run.residuals].map(([node, series]) => [
          node,
          [...series.toArray()],
        ]),
      ),
      checkpoints: run.checkpoints,
    };
    return run.snapshot;
  },

  subscribe(runId: string, listener: () => void): () => void {
    const set = listeners.get(runId) ?? new Set();
    set.add(listener);
    listeners.set(runId, set);
    return () => set.delete(listener);
  },

  /** Forgets everything; for tests. */
  clear(): void {
    held.clear();
    pending.clear();
  },
};

export function useRunProgress(runId: string): RunProgress {
  return useSyncExternalStore(
    (listener) => runProgress.subscribe(runId, listener),
    () => runProgress.snapshot(runId),
  );
}
