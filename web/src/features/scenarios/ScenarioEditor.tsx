import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { NotFoundError, ValidationError } from "../../api/errors";
import { packAs, unpackAs } from "../../entities/content";
import { DraftEditorHeader } from "../../entities/DraftEditorHeader";
import { useDraft } from "../../entities/useDraft";
import { useGeometryChoices } from "../../entities/useGeometryChoices";
import { VersionList } from "../../entities/VersionList";
import { ConfigForm } from "../../forms/ConfigForm";
import { EntityKind } from "../../gen/nebula/core/v1/entity_pb";
import {
  ScenarioSchema,
  type Scenario,
} from "../../gen/nebula/core/v1/scenario_pb";
import { CurrentsTable } from "./CurrentsTable";

/**
 * The scenario editor (docs/UI.md 6.4): the geometry whose circuits key the
 * currents, the currents and their waveforms, plasma targets through
 * generated forms and the conductor network (D66, D114). Solved scenarios
 * are versions minted by their Run (D110).
 */
export function ScenarioEditor() {
  const { projectId = "", scenarioId = "" } = useParams();
  return (
    <Editor
      key={`${projectId}/${scenarioId}`}
      projectId={projectId}
      scenarioId={scenarioId}
    />
  );
}

function Editor({
  projectId,
  scenarioId,
}: {
  projectId: string;
  scenarioId: string;
}) {
  const draft = useDraft(projectId, EntityKind.SCENARIO, scenarioId);
  const scenario = useMemo(
    () => unpackAs(ScenarioSchema, draft.content),
    [draft.content],
  );
  const { geometry, choices, missing } = useGeometryChoices(
    projectId,
    scenario.geometry,
  );

  if (!draft.draft) {
    if (draft.error instanceof NotFoundError) {
      return (
        <section className="placeholder">
          <h1>Scenario not found</h1>
          <p>
            <Link to=".." relative="path">
              Back to scenarios
            </Link>
          </p>
        </section>
      );
    }
    return draft.error ? (
      <p className="field-error" role="alert">
        {draft.error.message}
      </p>
    ) : (
      <p className="muted">Loading scenario…</p>
    );
  }

  const update = (next: Scenario) =>
    draft.setContent(packAs(ScenarioSchema, next));
  const violations =
    draft.error instanceof ValidationError ? draft.error.violations : [];

  return (
    <section className="editor-page">
      <div className="page-header">
        <h1>{draft.name || scenarioId}</h1>
      </div>
      <DraftEditorHeader
        draft={draft}
        label="Scenario name"
        inline={["geometry", "plasma_targets", "conductor_network"]}
      />
      <div className="setup-editor setup-editor-wide">
        <div className="editor-pane">
          <ConfigForm
            schema={ScenarioSchema}
            fields={["geometry"]}
            value={scenario}
            projectId={projectId}
            violations={violations}
            onChange={update}
          />
          {missing && (
            <p className="field-error" role="alert">
              The referenced geometry version could not be loaded.
            </p>
          )}
          <CurrentsTable
            geometry={geometry}
            currents={scenario.currents}
            onChange={(currents) => update({ ...scenario, currents })}
          />
          <ConfigForm
            schema={ScenarioSchema}
            fields={["plasma_targets", "conductor_network"]}
            value={scenario}
            projectId={projectId}
            idChoices={choices}
            violations={violations}
            onChange={update}
          />
        </div>
        <aside className="editor-pane">
          <VersionList
            projectId={projectId}
            kind={EntityKind.SCENARIO}
            id={scenarioId}
            draft={draft.draft}
          />
        </aside>
      </div>
    </section>
  );
}
