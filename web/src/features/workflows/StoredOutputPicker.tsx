import { useId } from "react";
import { useRunOutputs, useRuns } from "../../api/runs";
import { shortHash } from "../../entities/references";
import { RunState } from "../../gen/nebula/core/v1/run_pb";
import type { StoredOutputNode } from "../../gen/nebula/core/v1/workflow_pb";

/**
 * Picks the committed output a stored-output node feeds: a Run, then one
 * of its outputs; the content hash pins it (D22, D26).
 */
export function StoredOutputPicker({
  projectId,
  value,
  onChange,
}: {
  projectId: string;
  value: StoredOutputNode;
  onChange: (value: StoredOutputNode) => void;
}) {
  const ids = useId();
  const runs = useRuns(projectId);
  const outputs = useRunOutputs(projectId, value.runId || undefined);
  const completed =
    runs.data?.filter((run) => run.state === RunState.COMPLETED) ?? [];
  const key = (nodeId: string, name: string) => `${nodeId}/${name}`;
  return (
    <fieldset className="stored-output">
      <legend>Stored output</legend>
      <label htmlFor={`${ids}-run`}>Run</label>
      <select
        id={`${ids}-run`}
        value={value.runId}
        onChange={(event) =>
          onChange({
            ...value,
            runId: event.target.value,
            nodeId: "",
            outputName: "",
            contentHash: "",
          })
        }
      >
        <option value="" disabled>
          {completed.length ? "Choose a run" : "No completed runs"}
        </option>
        {completed.map((run) => (
          <option key={run.id} value={run.id}>
            {run.name || run.id}
          </option>
        ))}
      </select>
      {value.runId && (
        <>
          <label htmlFor={`${ids}-output`}>Output</label>
          <select
            id={`${ids}-output`}
            value={value.outputName ? key(value.nodeId, value.outputName) : ""}
            onChange={(event) => {
              const output = outputs.data?.find(
                (o) => key(o.nodeId, o.name) === event.target.value,
              );
              if (!output) return;
              onChange({
                ...value,
                nodeId: output.nodeId,
                outputName: output.name,
                contentHash: output.contentHash,
                subContract: output.subContract,
                timeSeries: output.timeSeries,
              });
            }}
          >
            <option value="" disabled>
              Choose an output
            </option>
            {outputs.data?.map((output) => (
              <option
                key={key(output.nodeId, output.name)}
                value={key(output.nodeId, output.name)}
              >
                {output.nodeId} · {output.name} ({output.subContract})
              </option>
            ))}
          </select>
        </>
      )}
      {value.contentHash && (
        <p className="muted small">
          Pinned to{" "}
          <code title={value.contentHash}>{shortHash(value.contentHash)}</code>
          {value.timeSeries && " · time series"}
        </p>
      )}
    </fieldset>
  );
}
