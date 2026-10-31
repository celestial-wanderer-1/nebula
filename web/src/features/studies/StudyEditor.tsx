import { ScalarType } from "@bufbuild/protobuf";
import { useId, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { useEntities, useVersions } from "../../api/entities";
import { errorMessage } from "../../api/errors";
import { useCreateStudy } from "../../api/studies";
import { shortHash } from "../../entities/references";
import { numericKind } from "../../forms/values";
import { NumberInput } from "../../forms/widgets/NumberInput";
import { EntityKind } from "../../gen/nebula/core/v1/entity_pb";
import { DeterminismMode } from "../../gen/nebula/core/v1/run_pb";
import type { DesignVariable } from "../../workflow/designVariables";
import { useQueueSummary } from "../../ws/channels";
import { useDesignVariables } from "./useDesignVariables";

const DOUBLE = numericKind(ScalarType.DOUBLE);
const UINT = numericKind(ScalarType.UINT32);

interface Choice {
  mode: "range" | "points";
  min: number;
  max: number;
  count: number;
  points: string;
}

const parsePoints = (text: string) =>
  text
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number);

const valuesOf = (choice: Choice) =>
  choice.mode === "range" ? choice.count : parsePoints(choice.points).length;

/**
 * A parameter-scan Study (docs/UI.md 6.9, A§12.4): a pinned base workflow
 * version, design variables with ranges or point lists (D81), and a
 * concurrency limit that defaults to the GPU count (D142).
 */
export function StudyEditor() {
  const { projectId = "" } = useParams();
  const ids = useId();
  const navigate = useNavigate();
  const workflows = useEntities(projectId, EntityKind.WORKFLOW);
  const [workflowId, setWorkflowId] = useState("");
  const versions = useVersions(
    projectId,
    EntityKind.WORKFLOW,
    workflowId || undefined,
  );
  const [chosenHash, setHash] = useState("");
  const versionHash = chosenHash || versions.data?.headHash || "";
  const { variables, pending } = useDesignVariables(
    projectId,
    workflowId,
    versionHash,
  );
  const [chosen, setChosen] = useState<Record<string, Choice>>({});
  const queue = useQueueSummary();
  const [concurrency, setConcurrency] = useState(0);
  const [gpus, setGpus] = useState(1);
  const [name, setName] = useState("");
  const create = useCreateStudy(projectId);
  const versioned = workflows.data?.filter((w) => w.headHash) ?? [];
  const points = Object.values(chosen).reduce(
    (n, c) => n * Math.max(valuesOf(c), 0),
    1,
  );

  const toggle = (variable: DesignVariable, on: boolean) =>
    setChosen((held) => {
      const next = { ...held };
      if (on) {
        const base = variable.value || 1;
        next[variable.path] = {
          mode: "range",
          min: base * 0.9,
          max: base * 1.1,
          count: 3,
          points: String(base),
        };
      } else {
        delete next[variable.path];
      }
      return next;
    });
  const change = (path: string, update: Partial<Choice>) =>
    setChosen((held) => ({ ...held, [path]: { ...held[path]!, ...update } }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(
      {
        name: name.trim(),
        workflowId,
        workflowVersionHash: versionHash,
        concurrency: concurrency || queue?.gpusTotal || 0,
        gpusPerRun: gpus,
        mode: DeterminismMode.DETERMINISTIC,
        variables: variables
          .filter((v) => chosen[v.path])
          .map((v) => {
            const choice = chosen[v.path]!;
            return {
              path: v.path,
              label: v.label,
              unit: v.unit,
              values:
                choice.mode === "range"
                  ? {
                      case: "range",
                      value: {
                        min: choice.min,
                        max: choice.max,
                        count: choice.count,
                      },
                    }
                  : {
                      case: "points",
                      value: { values: parsePoints(choice.points) },
                    },
            };
          }),
      },
      {
        onSuccess: (study) =>
          void navigate(
            `/p/${encodeURIComponent(projectId)}/studies/${encodeURIComponent(study.id)}`,
          ),
      },
    );
  };

  return (
    <section className="study-editor">
      <h1>New parameter scan</h1>
      <form className="stack" onSubmit={submit}>
        <div className="field">
          <label htmlFor={`${ids}-name`}>Name</label>
          <input
            id={`${ids}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`${ids}-workflow`}>Base workflow</label>
          <select
            id={`${ids}-workflow`}
            value={workflowId}
            onChange={(event) => {
              setWorkflowId(event.target.value);
              setHash("");
              setChosen({});
            }}
          >
            <option value="" disabled>
              {versioned.length
                ? "Choose a workflow"
                : "No workflow has a version yet"}
            </option>
            {versioned.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        {workflowId && (
          <div className="field">
            <label htmlFor={`${ids}-version`}>Version</label>
            <select
              id={`${ids}-version`}
              value={versionHash}
              onChange={(event) => setHash(event.target.value)}
            >
              {versions.data?.versions.map((v) => (
                <option key={v.hash} value={v.hash}>
                  {shortHash(v.hash)}
                  {v.hash === versions.data.headHash ? " (head)" : ""}
                </option>
              ))}
            </select>
            <p className="field-help">
              A scan runs a pinned version, with an override vector per point
              (D109).
            </p>
          </div>
        )}

        {workflowId && (
          <fieldset className="design-variables">
            <legend>Design variables</legend>
            {pending && <p className="muted small">Reading the workflow…</p>}
            {!pending && variables.length === 0 && (
              <p className="muted small">
                The workflow has no annotated design variables.
              </p>
            )}
            <table className="table">
              <tbody>
                {variables.map((variable) => {
                  const choice = chosen[variable.path];
                  const label = variable.label;
                  return (
                    <tr key={variable.path} data-path={variable.path}>
                      <th scope="row">
                        <label className="checkbox">
                          <input
                            type="checkbox"
                            checked={Boolean(choice)}
                            onChange={(event) =>
                              toggle(variable, event.target.checked)
                            }
                          />
                          {label}
                          {variable.unit && (
                            <span className="unit"> [{variable.unit}]</span>
                          )}
                        </label>
                        <span className="muted small">
                          {" "}
                          base {variable.value}
                        </span>
                      </th>
                      <td>
                        {choice && (
                          <div
                            className="variable-values"
                            role="group"
                            aria-label={`Values of ${label}`}
                          >
                            <select
                              aria-label={`Values of ${label} as`}
                              value={choice.mode}
                              onChange={(event) =>
                                change(variable.path, {
                                  mode: event.target.value as Choice["mode"],
                                })
                              }
                            >
                              <option value="range">Range</option>
                              <option value="points">Points</option>
                            </select>
                            {choice.mode === "range" ? (
                              <>
                                <NumberInput
                                  aria-label={`Minimum of ${label}`}
                                  value={choice.min}
                                  kind={DOUBLE}
                                  onChange={(v) =>
                                    change(variable.path, { min: Number(v) })
                                  }
                                />
                                <NumberInput
                                  aria-label={`Maximum of ${label}`}
                                  value={choice.max}
                                  kind={DOUBLE}
                                  onChange={(v) =>
                                    change(variable.path, { max: Number(v) })
                                  }
                                />
                                <NumberInput
                                  aria-label={`Count of ${label}`}
                                  value={choice.count}
                                  kind={UINT}
                                  onChange={(v) =>
                                    change(variable.path, { count: Number(v) })
                                  }
                                />
                              </>
                            ) : (
                              <input
                                aria-label={`Points of ${label}`}
                                value={choice.points}
                                onChange={(event) =>
                                  change(variable.path, {
                                    points: event.target.value,
                                  })
                                }
                              />
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </fieldset>
        )}

        <div className="field">
          <label htmlFor={`${ids}-concurrency`}>Concurrent runs</label>
          <NumberInput
            id={`${ids}-concurrency`}
            value={concurrency || queue?.gpusTotal || 1}
            kind={UINT}
            onChange={(v) => setConcurrency(Number(v))}
          />
          <p className="field-help">Defaults to the GPU count (D142).</p>
        </div>
        <div className="field">
          <label htmlFor={`${ids}-gpus`}>GPUs per run</label>
          <NumberInput
            id={`${ids}-gpus`}
            value={gpus}
            kind={UINT}
            onChange={(v) => setGpus(Number(v) || 1)}
          />
        </div>
        <p role="status">
          {Object.keys(chosen).length
            ? `${points} points`
            : "Choose at least one variable."}
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
            disabled={
              !workflowId ||
              !Object.keys(chosen).length ||
              points === 0 ||
              create.isPending
            }
          >
            Create scan
          </button>
        </div>
      </form>
    </section>
  );
}
