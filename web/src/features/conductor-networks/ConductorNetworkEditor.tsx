import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { NotFoundError, ValidationError } from "../../api/errors";
import { newStableId, packAs, unpackAs } from "../../entities/content";
import { DraftEditorHeader } from "../../entities/DraftEditorHeader";
import { useDraft } from "../../entities/useDraft";
import { useGeometryChoices } from "../../entities/useGeometryChoices";
import { VersionList } from "../../entities/VersionList";
import { ConfigForm } from "../../forms/ConfigForm";
import {
  ConductorNetworkSchema,
  type ConductorNetwork,
} from "../../gen/nebula/core/v1/conductor_network_pb";
import { EntityKind } from "../../gen/nebula/core/v1/entity_pb";
import { IdRef } from "../../gen/nebula/core/v1/options_pb";

/**
 * Gives new elements, supplies and feedback loops stable IDs, once: other
 * rows refer to them by ID, so renaming never breaks a reference.
 */
function withIds(network: ConductorNetwork): ConductorNetwork {
  const ensure = <T extends { id: string }>(items: T[], prefix: string) =>
    items.map((item) =>
      item.id ? item : { ...item, id: newStableId(prefix) },
    );
  return {
    ...network,
    elements: ensure(network.elements, "el"),
    supplies: ensure(network.supplies, "sup"),
    feedback: ensure(network.feedback, "fb"),
  };
}

/**
 * The conductor network editor (docs/UI.md 6.4): passive elements on the
 * geometry's components, circuit topology on its circuits, power supplies
 * and feedback (D71, D128).
 */
export function ConductorNetworkEditor() {
  const { projectId = "", networkId = "" } = useParams();
  return (
    <Editor
      key={`${projectId}/${networkId}`}
      projectId={projectId}
      networkId={networkId}
    />
  );
}

function Editor({
  projectId,
  networkId,
}: {
  projectId: string;
  networkId: string;
}) {
  const draft = useDraft(projectId, EntityKind.CONDUCTOR_NETWORK, networkId);
  const network = useMemo(
    () => unpackAs(ConductorNetworkSchema, draft.content),
    [draft.content],
  );
  const geometry = useGeometryChoices(projectId, network.geometry);
  const choices = useMemo(
    () => ({
      ...geometry.choices,
      [IdRef.ELEMENT]: network.elements.map((e) => ({
        id: e.id,
        label: e.name || e.id,
      })),
      [IdRef.SUPPLY]: network.supplies.map((s) => ({
        id: s.id,
        label: s.name || s.id,
      })),
    }),
    [geometry.choices, network.elements, network.supplies],
  );

  if (!draft.draft) {
    if (draft.error instanceof NotFoundError) {
      return (
        <section className="placeholder">
          <h1>Conductor network not found</h1>
          <p>
            <Link to=".." relative="path">
              Back to conductor networks
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
      <p className="muted">Loading conductor network…</p>
    );
  }

  const violations =
    draft.error instanceof ValidationError ? draft.error.violations : [];

  return (
    <section className="editor-page">
      <div className="page-header">
        <h1>{draft.name || networkId}</h1>
      </div>
      <DraftEditorHeader
        draft={draft}
        label="Conductor network name"
        inline={ConductorNetworkSchema.fields.map((f) => f.name)}
      />
      <div className="setup-editor setup-editor-wide">
        <div className="editor-pane">
          {geometry.missing && (
            <p className="field-error" role="alert">
              The referenced geometry version could not be loaded.
            </p>
          )}
          <ConfigForm
            schema={ConductorNetworkSchema}
            value={network}
            projectId={projectId}
            idChoices={choices}
            violations={violations}
            onChange={(next) =>
              draft.setContent(packAs(ConductorNetworkSchema, withIds(next)))
            }
          />
        </div>
        <aside className="editor-pane">
          <VersionList
            projectId={projectId}
            kind={EntityKind.CONDUCTOR_NETWORK}
            id={networkId}
            draft={draft.draft}
          />
        </aside>
      </div>
    </section>
  );
}
