// Time for the mock's scripted Runs (docs/UI.md Section 7: scenarios with
// configurable timing). A discrete-event scheduler over mock time: in
// "auto" mode real timers drive it, scaled; in "manual" mode time moves
// only when a test advances it, so intermediate states hold still.

interface Pending {
  id: number;
  at: number;
  callback: () => void;
}

export type ClockMode = "auto" | "manual";

export class MockClock {
  mode: ClockMode;
  /** Real milliseconds per mock millisecond. */
  private scale: number;
  private time: number;
  /** Real time when `time` was last set, for reading it between events. */
  private syncedAt = Date.now();
  private pending: Pending[] = [];
  private next = 1;
  private timer?: ReturnType<typeof setTimeout>;

  constructor({
    mode = "auto",
    scale = 1,
    start = Date.now(),
  }: { mode?: ClockMode; scale?: number; start?: number } = {}) {
    this.mode = mode;
    this.scale = scale;
    this.time = start;
  }

  now(): number {
    if (this.mode === "manual") return this.time;
    return this.time + (Date.now() - this.syncedAt) / this.scale;
  }

  /** Calls `callback` after `ms` of mock time; returns a handle. */
  after(ms: number, callback: () => void): number {
    const id = this.next++;
    this.pending.push({ id, at: this.now() + Math.max(0, ms), callback });
    this.arm();
    return id;
  }

  cancel(id: number | undefined): void {
    if (id === undefined) return;
    this.pending = this.pending.filter((p) => p.id !== id);
    this.arm();
  }

  cancelAll(): void {
    this.pending = [];
    this.disarm();
  }

  setMode(mode: ClockMode): void {
    this.sync();
    this.mode = mode;
    this.arm();
  }

  setScale(scale: number): void {
    this.sync();
    this.scale = scale;
    this.arm();
  }

  /** Moves mock time forward, running each callback due on the way. */
  advance(ms: number): void {
    this.sync();
    const end = this.time + ms;
    for (let due = this.due(end); due; due = this.due(end)) {
      this.run(due);
    }
    this.time = Math.max(this.time, end);
    this.syncedAt = Date.now();
    this.arm();
  }

  /**
   * Runs pending callbacks in time order until `done` holds. Throws when
   * nothing is pending or after `limit` callbacks, so a test cannot spin.
   */
  advanceUntil(done: () => boolean, limit = 10_000): void {
    this.sync();
    for (let i = 0; !done(); i++) {
      const due = this.due(Infinity);
      if (!due || i >= limit) {
        throw new Error(
          "The mock clock ran out of work before the condition held",
        );
      }
      this.run(due);
    }
    this.syncedAt = Date.now();
    this.arm();
  }

  private due(end: number): Pending | undefined {
    return this.pending
      .filter((p) => p.at <= end)
      .sort((a, b) => a.at - b.at || a.id - b.id)[0];
  }

  private run(due: Pending): void {
    this.pending = this.pending.filter((p) => p !== due);
    this.time = Math.max(this.time, due.at);
    due.callback();
  }

  private sync(): void {
    this.time = this.now();
    this.syncedAt = Date.now();
  }

  private disarm(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private arm(): void {
    this.disarm();
    if (this.mode !== "auto") return;
    const due = this.due(Infinity);
    if (!due) return;
    const delay = Math.max(0, (due.at - this.now()) * this.scale);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.sync();
      for (let next = this.due(this.time); next; next = this.due(this.time)) {
        this.run(next);
      }
      this.syncedAt = Date.now();
      this.arm();
    }, delay);
  }
}
