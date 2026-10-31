import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LogLineSchema, ResidualSchema } from "../gen/nebula/core/v1/run_pb";
import { RingBuffer } from "./ringBuffer";
import { LOG_CAPACITY, runProgress } from "./runProgress";

afterEach(() => runProgress.clear());

describe("RingBuffer", () => {
  it("drops the oldest items past its capacity and counts them", () => {
    const buffer = new RingBuffer<number>(3);
    for (let i = 1; i <= 5; i++) buffer.push(i);
    expect(buffer.toArray()).toEqual([3, 4, 5]);
    expect(buffer.dropped).toBe(2);
    buffer.clear();
    expect(buffer.size).toBe(0);
  });
});

describe("runProgress (D106)", () => {
  it("bounds logs per Run and batches notifications", async () => {
    const listener = vi.fn();
    runProgress.subscribe("r-1", listener);
    for (let i = 0; i < LOG_CAPACITY + 10; i++) {
      runProgress.addLog(
        "r-1",
        create(LogLineSchema, { message: `line ${i}` }),
      );
    }
    const snapshot = runProgress.snapshot("r-1");
    expect(snapshot.logs).toHaveLength(LOG_CAPACITY);
    expect(snapshot.droppedLogs).toBe(10);
    expect(snapshot.logs[0]?.message).toBe("line 10");
    // The same snapshot object until something changes.
    expect(runProgress.snapshot("r-1")).toBe(snapshot);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
  });

  it("keeps residual series per step and forgets a Run on reset", () => {
    runProgress.addResidual(
      "r-1",
      create(ResidualSchema, { nodeId: "t1", iteration: 1, value: 0.1 }),
    );
    runProgress.addResidual(
      "r-1",
      create(ResidualSchema, { nodeId: "t1", iteration: 2, value: 0.01 }),
    );
    runProgress.addResidual(
      "r-1",
      create(ResidualSchema, { nodeId: "field", iteration: 1, value: 1 }),
    );
    expect([...runProgress.snapshot("r-1").residuals.keys()]).toEqual([
      "t1",
      "field",
    ]);
    expect(runProgress.snapshot("r-1").residuals.get("t1")).toHaveLength(2);
    runProgress.reset("r-1");
    expect(runProgress.snapshot("r-1").residuals.size).toBe(0);
  });
});
