import { create, type DescField } from "@bufbuild/protobuf";
import { useId, useState } from "react";
import { useInputDatasets } from "../../api/inputs";
import { useRunOutputs, useRuns } from "../../api/runs";
import { shortHash } from "../../entities/references";
import {
  DatasetRefSchema,
  type DatasetRef,
} from "../../gen/nebula/core/v1/entity_pb";
import { RunState } from "../../gen/nebula/core/v1/run_pb";
import { fieldLabel, uiHintOf } from "../../schema/annotations";
import { useFormContext } from "../context";
import { violationsAt } from "../validate";
import { RawJsonField } from "./RawJsonField";

type Source = "" | "input" | "run";

const sameDataset = (a: DatasetRef | undefined, b: DatasetRef) =>
  a?.contentHash === b.contentHash && a.datasetPath === b.datasetPath;

/**
 * A `DatasetRef` field: picks a committed Run output or an ingested input
 * dataset (docs/UI.md Section 5, D144). Arrays never travel inline (D25):
 * only the reference is stored.
 */
export function DatasetRefField({
  field,
  value,
  onChange,
  path,
}: {
  field: DescField;
  value: DatasetRef | undefined;
  onChange: (value: DatasetRef | undefined) => void;
  path: string;
}) {
  const ids = useId();
  const { projectId, readOnly, violations } = useFormContext();
  const inputs = useInputDatasets(projectId);
  const runs = useRuns(projectId);
  const ownerIsRun = Boolean(
    value?.owner && runs.data?.some((run) => run.id === value.owner),
  );
  const [chosen, setSource] = useState<Source>();
  const source: Source =
    chosen ?? (!value?.contentHash ? "" : ownerIsRun ? "run" : "input");
  const [chosenRun, setRunId] = useState<string>();
  const runId = chosenRun ?? (ownerIsRun ? value?.owner : "");
  const outputs = useRunOutputs(projectId, runId || undefined);

  if (!projectId) {
    return (
      <RawJsonField
        field={field}
        value={value}
        path={path}
        reason="Datasets can be picked inside a project."
      />
    );
  }
  const help = uiHintOf(field).help;
  const datasets =
    outputs.data?.flatMap((output) =>
      output.datasets.map((dataset) => ({ output, dataset })),
    ) ?? [];
  const selected = datasets.findIndex(({ dataset }) =>
    sameDataset(value, dataset),
  );
  const completed =
    runs.data?.filter((run) => run.state === RunState.COMPLETED) ?? [];

  return (
    <fieldset
      className="field dataset-ref"
      data-path={path}
      disabled={readOnly}
    >
      <legend>{fieldLabel(field)}</legend>
      {help && <p className="field-help">{help}</p>}
      <label htmlFor={`${ids}-source`}>Source</label>
      <select
        id={`${ids}-source`}
        value={source}
        onChange={(event) => {
          const next = event.target.value as Source;
          setSource(next);
          if (!next) onChange(undefined);
        }}
      >
        <option value="">None</option>
        <option value="input">Input dataset</option>
        <option value="run">Run output</option>
      </select>

      {source === "input" && (
        <>
          <label htmlFor={`${ids}-input`}>Input dataset</label>
          <select
            id={`${ids}-input`}
            value={
              inputs.data?.find((input) =>
                input.dataset ? sameDataset(value, input.dataset) : false,
              )?.id ?? ""
            }
            onChange={(event) => {
              const input = inputs.data?.find(
                (i) => i.id === event.target.value,
              );
              if (input?.dataset) onChange(input.dataset);
            }}
          >
            <option value="" disabled>
              {inputs.data?.length === 0
                ? "No input datasets yet"
                : "Choose a dataset"}
            </option>
            {inputs.data?.map((input) => (
              <option key={input.id} value={input.id}>
                {input.name} ({input.subContract})
              </option>
            ))}
          </select>
        </>
      )}

      {source === "run" && (
        <>
          <label htmlFor={`${ids}-run`}>Run</label>
          <select
            id={`${ids}-run`}
            value={runId}
            onChange={(event) => setRunId(event.target.value)}
          >
            <option value="" disabled>
              {completed.length === 0 ? "No completed runs" : "Choose a run"}
            </option>
            {completed.map((run) => (
              <option key={run.id} value={run.id}>
                {run.name || run.id}
              </option>
            ))}
          </select>
          {runId && (
            <>
              <label htmlFor={`${ids}-dataset`}>Output dataset</label>
              <select
                id={`${ids}-dataset`}
                value={selected >= 0 ? String(selected) : ""}
                onChange={(event) => {
                  const picked = datasets[Number(event.target.value)];
                  if (picked) {
                    onChange(create(DatasetRefSchema, picked.dataset));
                  }
                }}
              >
                <option value="" disabled>
                  Choose an output
                </option>
                {datasets.map(({ output, dataset }, index) => (
                  <option key={index} value={index}>
                    {output.name} · {dataset.datasetPath} (
                    {shortHash(dataset.contentHash)})
                  </option>
                ))}
              </select>
            </>
          )}
        </>
      )}
      {value?.contentHash && (
        <p className="muted small">
          Selected: <code>{value.datasetPath}</code> ·{" "}
          <code title={value.contentHash}>{shortHash(value.contentHash)}</code>
        </p>
      )}
      {violationsAt(violations, path).map((message) => (
        <p key={message} className="field-error" role="alert">
          {message}
        </p>
      ))}
    </fieldset>
  );
}
