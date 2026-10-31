import { useId, useState, type FormEvent } from "react";
import { useInputDatasets, useUploadInputDataset } from "../../api/inputs";
import { errorMessage } from "../../api/errors";
import { shortHash } from "../../entities/references";
import type { InputDatasetNode } from "../../gen/nebula/core/v1/workflow_pb";

/**
 * Picks or uploads the ingested HDF5 dataset an input-dataset node feeds
 * (D144). An upload is validated, hashed and versioned by the server.
 */
export function InputDatasetPicker({
  projectId,
  value,
  onChange,
}: {
  projectId: string;
  value: InputDatasetNode;
  onChange: (value: InputDatasetNode) => void;
}) {
  const ids = useId();
  const datasets = useInputDatasets(projectId);
  const upload = useUploadInputDataset(projectId);
  const [file, setFile] = useState<File>();
  const [subContract, setSubContract] = useState(value.subContract);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!file) return;
    upload.mutate(
      { file, name: file.name, subContract: subContract.trim() },
      {
        onSuccess: (dataset) =>
          onChange({
            ...value,
            datasetId: dataset.id,
            versionHash: dataset.versionHash,
            subContract: dataset.subContract,
          }),
      },
    );
  };

  return (
    <fieldset className="input-dataset">
      <legend>Input dataset</legend>
      <label htmlFor={`${ids}-dataset`}>Dataset</label>
      <select
        id={`${ids}-dataset`}
        value={value.datasetId}
        onChange={(event) => {
          const dataset = datasets.data?.find(
            (d) => d.id === event.target.value,
          );
          if (dataset) {
            onChange({
              ...value,
              datasetId: dataset.id,
              versionHash: dataset.versionHash,
              subContract: dataset.subContract,
            });
          }
        }}
      >
        <option value="" disabled>
          {datasets.data?.length ? "Choose a dataset" : "No datasets yet"}
        </option>
        {datasets.data?.map((dataset) => (
          <option key={dataset.id} value={dataset.id}>
            {dataset.name} ({dataset.subContract})
          </option>
        ))}
      </select>
      {value.versionHash && (
        <p className="muted small">
          Version{" "}
          <code title={value.versionHash}>{shortHash(value.versionHash)}</code>
        </p>
      )}
      <form className="stack" onSubmit={submit} aria-label="Upload dataset">
        <label htmlFor={`${ids}-file`}>Upload HDF5 file</label>
        <input
          id={`${ids}-file`}
          type="file"
          accept=".h5,.hdf5,application/x-hdf5"
          onChange={(event) => setFile(event.target.files?.[0])}
        />
        <label htmlFor={`${ids}-sub`}>Sub-contract</label>
        <input
          id={`${ids}-sub`}
          value={subContract}
          placeholder="Equilibrium.Axisym2D"
          onChange={(event) => setSubContract(event.target.value)}
        />
        <button
          type="submit"
          disabled={!file || !subContract.trim() || upload.isPending}
        >
          Upload
        </button>
        {upload.error && (
          <p className="field-error" role="alert">
            {errorMessage(upload.error)}
          </p>
        )}
      </form>
    </fieldset>
  );
}
