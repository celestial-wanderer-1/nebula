import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { useReferenceTessellation } from "../../api/geometry";
import { NotFoundError, ValidationError } from "../../api/errors";
import { packAs, unpackAs } from "../../entities/content";
import { DraftEditorHeader } from "../../entities/DraftEditorHeader";
import { useDraft } from "../../entities/useDraft";
import { useGeometryChoices } from "../../entities/useGeometryChoices";
import { VersionList } from "../../entities/VersionList";
import { ConfigForm } from "../../forms/ConfigForm";
import { EntityKind } from "../../gen/nebula/core/v1/entity_pb";
import { RegionSchema } from "../../gen/nebula/core/v1/region_pb";
import { lazyView } from "../../viewers/lazy";
import type { PlacementViewProps } from "./PlacementView";
import { regionPreview } from "./preview";

const PlacementSlot = lazyView<PlacementViewProps>(
  () => import("./PlacementView").then((module) => module.PlacementView),
  {
    loading: "Loading 3D view…",
    unavailable:
      "3D view unavailable: the viewer could not be loaded. Editing still works.",
  },
);

/**
 * The region editor (docs/UI.md 6.4): the generated form of the region type
 * (D89, D160) | its placement over the referenced geometry | versions.
 */
export function RegionEditor() {
  const { projectId = "", regionId = "" } = useParams();
  return (
    <Editor
      key={`${projectId}/${regionId}`}
      projectId={projectId}
      regionId={regionId}
    />
  );
}

function Editor({
  projectId,
  regionId,
}: {
  projectId: string;
  regionId: string;
}) {
  const draft = useDraft(projectId, EntityKind.REGION, regionId);
  const region = useMemo(
    () => unpackAs(RegionSchema, draft.content),
    [draft.content],
  );
  const { choices, missing } = useGeometryChoices(projectId, region.geometry);
  const tessellation = useReferenceTessellation(projectId, region.geometry);
  const preview = useMemo(() => regionPreview(region), [region]);

  if (!draft.draft) {
    if (draft.error instanceof NotFoundError) {
      return (
        <section className="placeholder">
          <h1>Region not found</h1>
          <p>
            <Link to=".." relative="path">
              Back to regions
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
      <p className="muted">Loading region…</p>
    );
  }

  const violations =
    draft.error instanceof ValidationError ? draft.error.violations : [];

  return (
    <section className="editor-page">
      <div className="page-header">
        <h1>{draft.name || regionId}</h1>
      </div>
      <DraftEditorHeader
        draft={draft}
        label="Region name"
        inline={["geometry", ...RegionSchema.fields.map((f) => f.name)]}
      />
      <div className="setup-editor">
        <section className="editor-pane" aria-label="Region">
          <ConfigForm
            schema={RegionSchema}
            value={region}
            projectId={projectId}
            idChoices={choices}
            violations={violations}
            onChange={(next) => draft.setContent(packAs(RegionSchema, next))}
          />
        </section>
        <section className="editor-pane" aria-label="Placement">
          {missing && (
            <p className="field-error" role="alert">
              The referenced geometry version could not be loaded.
            </p>
          )}
          {!region.geometry?.id && (
            <p className="muted small">
              Choose a geometry to place the region over.
            </p>
          )}
          {preview.note && <p className="muted small">{preview.note}</p>}
          <PlacementSlot
            components={tessellation.data?.components ?? []}
            preview={preview}
          />
        </section>
        <aside className="editor-pane">
          <VersionList
            projectId={projectId}
            kind={EntityKind.REGION}
            id={regionId}
            draft={draft.draft}
          />
        </aside>
      </div>
    </section>
  );
}
