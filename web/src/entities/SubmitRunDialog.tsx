import * as Dialog from "@radix-ui/react-dialog";
import { useId, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { errorMessage } from "../api/errors";
import { useSubmitPreview, useSubmitRun } from "../api/runs";
import { IssueSeverity } from "../gen/nebula/core/v1/project_pb";
import { DeterminismMode } from "../gen/nebula/core/v1/run_pb";
import { ENTITY_LABELS } from "./kinds";
import { shortHash } from "./references";

/**
 * Submits a workflow's saved draft as a Run (A§13.5): GPU count defaulted
 * from the manifests and bounded by the installed GPUs and the steps' rank
 * counts (D102, D116), determinism mode (deterministic by default, D77), and
 * a summary of the drafts that will be minted (A§4.2) and the steps the
 * cache serves (A§3.4).
 */
export function SubmitRunDialog({
  projectId,
  workflowId,
  revision,
  rerunOf,
  open,
  onOpenChange,
}: {
  projectId: string;
  workflowId: string;
  /** The saved draft revision the preview is for. */
  revision: number | undefined;
  /** Set for "re-run with edited workflow" (D141). */
  rerunOf?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const ids = useId();
  const navigate = useNavigate();
  const [chosenGpus, setGpus] = useState(0);
  const [mode, setMode] = useState(DeterminismMode.DETERMINISTIC);
  const [name, setName] = useState("");
  const preview = useSubmitPreview(
    projectId,
    workflowId,
    revision,
    { gpus: chosenGpus, mode },
    open,
  );
  const submit = useSubmitRun(projectId);
  const data = preview.data;
  const gpus = chosenGpus || data?.defaultGpus || 1;
  const errors =
    data?.issues.filter((i) => i.severity === IssueSeverity.ERROR) ?? [];
  const toMint = data?.minted.filter((d) => !d.reusesVersion) ?? [];

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit.mutate(
      { workflowId, gpus, mode, name: name.trim(), rerunOf },
      {
        onSuccess: (response) => {
          if (!response.run) return;
          onOpenChange(false);
          void navigate(
            `/p/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(response.run.id)}`,
          );
        },
      },
    );
  };
  const blocking = submit.data && !submit.data.run ? submit.data.issues : [];

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) submit.reset();
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog dialog-wide">
          <Dialog.Title>
            {rerunOf ? `Re-run ${rerunOf}` : "Run workflow"}
          </Dialog.Title>
          <Dialog.Description>
            Submits the saved draft. Drafts it reaches are minted into versions
            in one step.
          </Dialog.Description>
          <form className="stack" onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor={`${ids}-gpus`}>GPUs</label>
              <select
                id={`${ids}-gpus`}
                value={gpus}
                onChange={(event) => setGpus(Number(event.target.value))}
                aria-describedby={`${ids}-gpus-help`}
              >
                {(data?.allowedGpus.length ? data.allowedGpus : [gpus]).map(
                  (n) => (
                    <option key={n} value={n}>
                      {n}
                      {n === data?.defaultGpus ? " (default)" : ""}
                    </option>
                  ),
                )}
              </select>
              <p className="field-help" id={`${ids}-gpus-help`}>
                {data
                  ? `${data.maxGpus} installed; counts every step supports.`
                  : "Loading…"}
              </p>
            </div>
            <fieldset className="field">
              <legend>Determinism</legend>
              <label className="checkbox">
                <input
                  type="radio"
                  name={`${ids}-mode`}
                  checked={mode === DeterminismMode.DETERMINISTIC}
                  onChange={() => setMode(DeterminismMode.DETERMINISTIC)}
                />
                Deterministic (bitwise reproducible)
              </label>
              <label className="checkbox">
                <input
                  type="radio"
                  name={`${ids}-mode`}
                  checked={mode === DeterminismMode.FAST}
                  onChange={() => setMode(DeterminismMode.FAST)}
                />
                Fast (reproducible within tolerances)
              </label>
            </fieldset>
            <div className="field">
              <label htmlFor={`${ids}-name`}>Run name</label>
              <input
                id={`${ids}-name`}
                value={name}
                placeholder="Optional"
                onChange={(event) => setName(event.target.value)}
              />
            </div>

            <section aria-label="Submission summary" className="submit-summary">
              {preview.isPending && <p className="muted">Checking…</p>}
              {preview.error && (
                <p className="field-error" role="alert">
                  {errorMessage(preview.error)}
                </p>
              )}
              {data && (
                <>
                  <p>
                    {data.cacheHit
                      ? `All ${data.cachedSteps.length} steps are cached: the run completes at once.`
                      : data.cachedSteps.length
                        ? `${data.cachedSteps.length} steps come from the cache.`
                        : "No step is cached."}
                  </p>
                  <h3>Versions to mint</h3>
                  {toMint.length === 0 ? (
                    <p className="muted small">
                      None: every input is already a version.
                    </p>
                  ) : (
                    <ul aria-label="Drafts to mint">
                      {toMint.map((d) => (
                        <li key={`${d.kind}/${d.id}`}>
                          {ENTITY_LABELS[d.kind]} “{d.name}” (draft revision{" "}
                          {d.revision}) →{" "}
                          <code>{shortHash(d.versionHash)}</code>
                        </li>
                      ))}
                    </ul>
                  )}
                  {errors.length > 0 && (
                    <div className="field-error" role="alert">
                      <p>Fix before running:</p>
                      <ul>
                        {errors.map((issue, i) => (
                          <li key={i}>{issue.message}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </section>
            {blocking.length > 0 && (
              <p className="field-error" role="alert">
                Not submitted: {blocking.map((i) => i.message).join("; ")}
              </p>
            )}
            {submit.error && (
              <p className="field-error" role="alert">
                {errorMessage(submit.error)}
              </p>
            )}
            <div className="dialog-actions">
              <Dialog.Close asChild>
                <button type="button">Cancel</button>
              </Dialog.Close>
              <button
                type="submit"
                className="primary"
                disabled={!data || errors.length > 0 || submit.isPending}
              >
                Submit run
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
