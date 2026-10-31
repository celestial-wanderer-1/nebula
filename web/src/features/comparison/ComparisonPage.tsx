import { useId, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useComparisons, useCreateComparison } from "../../api/comparisons";
import { errorMessage } from "../../api/errors";
import { useRuns } from "../../api/runs";
import { formatTime } from "../../entities/format";
import { ReferencePicker } from "../../entities/ReferencePicker";
import { EntityKind, type EntityRef } from "../../gen/nebula/core/v1/entity_pb";
import { RunState } from "../../gen/nebula/core/v1/run_pb";

/**
 * Comparisons of the project's Runs (docs/UI.md 6.8): pick completed Runs
 * and a shared Region (D104), within the project (D51).
 */
export function ComparisonPage() {
  const { projectId = "" } = useParams();
  const ids = useId();
  const navigate = useNavigate();
  const runs = useRuns(projectId);
  const comparisons = useComparisons(projectId);
  const create = useCreateComparison(projectId);
  const [chosen, setChosen] = useState<string[]>([]);
  const [region, setRegion] = useState<EntityRef>();
  const completed =
    runs.data?.filter((run) => run.state === RunState.COMPLETED) ?? [];
  const names = new Map(
    runs.data?.map((run) => [run.id, run.name || run.id]) ?? [],
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(
      { runIds: chosen, region },
      {
        onSuccess: (comparison) =>
          void navigate(
            `/p/${encodeURIComponent(projectId)}/comparison/${encodeURIComponent(comparison.id)}`,
          ),
      },
    );
  };

  return (
    <section className="comparison-page">
      <h1>Comparison</h1>
      {comparisons.data && comparisons.data.length > 0 && (
        <section aria-label="Earlier comparisons">
          <h2>Earlier comparisons</h2>
          <ul>
            {comparisons.data.map((comparison) => (
              <li key={comparison.id}>
                <Link
                  to={`/p/${encodeURIComponent(projectId)}/comparison/${encodeURIComponent(comparison.id)}`}
                >
                  {comparison.runIds
                    .map((id) => names.get(id) ?? id)
                    .join(" vs ")}
                </Link>{" "}
                <span className="muted small">
                  {formatTime(comparison.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <form
        className="stack panel"
        onSubmit={submit}
        aria-label="New comparison"
      >
        <h2>New comparison</h2>
        <fieldset>
          <legend>Runs</legend>
          {completed.length === 0 && (
            <p className="muted small">No completed runs yet.</p>
          )}
          {completed.map((run) => (
            <label key={run.id} className="checkbox">
              <input
                type="checkbox"
                checked={chosen.includes(run.id)}
                onChange={(event) =>
                  setChosen((held) =>
                    event.target.checked
                      ? [...held, run.id]
                      : held.filter((id) => id !== run.id),
                  )
                }
              />
              {run.name || run.id}{" "}
              <span className="muted small">{formatTime(run.finishedAt)}</span>
            </label>
          ))}
        </fieldset>
        <ReferencePicker
          projectId={projectId}
          kind={EntityKind.REGION}
          value={region}
          onChange={setRegion}
          label="Shared region"
        />
        <p className="muted small" id={`${ids}-help`}>
          Difference fields are resampled on the shared region.
        </p>
        {create.error && (
          <p className="field-error" role="alert">
            {errorMessage(create.error)}
          </p>
        )}
        <div className="actions">
          <button
            type="submit"
            className="primary"
            disabled={chosen.length < 2 || create.isPending}
            aria-describedby={`${ids}-help`}
          >
            Compare {chosen.length || ""} runs
          </button>
        </div>
      </form>
    </section>
  );
}
