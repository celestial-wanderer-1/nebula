import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import {
  FailureReason,
  RunSchema,
  RunState,
} from "../gen/nebula/core/v1/run_pb";
import { runActions } from "./runActions";

const run = (
  state: RunState,
  failure = FailureReason.UNSPECIFIED,
  hasCheckpoint = false,
) => create(RunSchema, { state, attempts: [{ failure, hasCheckpoint }] });

const enabled = (r: ReturnType<typeof run>) =>
  Object.entries(runActions(r))
    .filter(([, on]) => on)
    .map(([name]) => name)
    .sort();

describe("runActions (A§3.7, A§14.1)", () => {
  it.each([
    [RunState.QUEUED, ["cancel"]],
    [RunState.PREPARING, ["cancel"]],
    [RunState.RUNNING, ["cancel", "pause"]],
    [RunState.PAUSED, ["cancel", "resume"]],
    [RunState.COMPLETED, ["rerun", "rerunEdited"]],
    [RunState.CANCELLED, ["rerun", "rerunEdited"]],
    [RunState.DISCARDED, ["rerun", "rerunEdited"]],
  ])("state %s enables %j", (state, actions) => {
    expect(enabled(run(state))).toEqual(actions);
  });

  it.each([
    [FailureReason.OOM, true],
    [FailureReason.CRASHED, true],
    [FailureReason.SUPERVISOR_LOST, true],
    [FailureReason.NAN, false],
    [FailureReason.DIVERGED, false],
    [FailureReason.PLUGIN_ERROR, false],
    [FailureReason.GEOMETRY_FAILED, false],
  ])(
    "a failure of reason %s with a checkpoint resumes: %s",
    (reason, resumes) => {
      const failed = run(RunState.FAILED, reason, true);
      expect(runActions(failed).resume).toBe(resumes);
      // Discard and both re-runs are always offered (D141).
      expect(runActions(failed)).toMatchObject({
        discard: true,
        rerun: true,
        rerunEdited: true,
        pause: false,
        cancel: false,
      });
    },
  );

  it("does not resume a transient failure without a checkpoint", () => {
    expect(
      runActions(run(RunState.FAILED, FailureReason.OOM, false)).resume,
    ).toBe(false);
  });
});
