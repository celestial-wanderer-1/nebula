import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { draftQueryOptions, useDeleteEntity } from "../../api/entities";
import { NotFoundError } from "../../api/errors";
import { useAddComponentToLibrary } from "../../api/library";
import { ComponentEditor } from "../../entities/ComponentEditor";
import type { DraftStatus } from "../../entities/useDraft";
import { VersionList } from "../../entities/VersionList";
import { EntityKind } from "../../gen/nebula/core/v1/entity_pb";
import { globalComponentPath, librariesPath } from "./paths";

/** A project component: editor, versions, add to library and delete. */
export function ComponentDetail() {
  const { projectId = "", componentId = "" } = useParams();
  const navigate = useNavigate();
  const draft = useQuery(
    draftQueryOptions(projectId, EntityKind.COMPONENT, componentId),
  );
  // The server copies its draft into the library, so an edit still unsaved
  // in the editor would be left out.
  const [editorStatus, setEditorStatus] = useState<DraftStatus>("loading");
  const unsaved = editorStatus !== "saved";
  const addToLibrary = useAddComponentToLibrary();
  const remove = useDeleteEntity(projectId, EntityKind.COMPONENT);
  const back = librariesPath(projectId, "components");

  if (draft.error instanceof NotFoundError) {
    return (
      <section className="placeholder">
        <h1>Component not found</h1>
        <p>
          <Link to={back}>Back to libraries</Link>
        </p>
      </section>
    );
  }
  if (!draft.data) {
    return <p className="muted">{draft.error?.message ?? "Loading…"}</p>;
  }
  const name = draft.data.name;

  return (
    <section className="library-detail">
      <p className="eyebrow">
        <Link to={back}>Libraries</Link> / Component
      </p>
      <div className="page-header">
        <h1>{name}</h1>
        <div className="actions">
          <button
            type="button"
            disabled={addToLibrary.isPending || unsaved}
            title={unsaved ? "Waits for the draft to save" : undefined}
            onClick={() =>
              addToLibrary.mutate({
                projectId,
                itemId: componentId,
                description: "",
              })
            }
          >
            Add to global library
          </button>
          <button
            type="button"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(componentId, {
                onSuccess: () => void navigate(back),
              })
            }
          >
            Delete
          </button>
        </div>
      </div>
      {addToLibrary.data && (
        <p role="status">
          Added to the global library as{" "}
          <Link to={globalComponentPath(projectId, addToLibrary.data.id)}>
            {addToLibrary.data.name}
          </Link>
          .
        </p>
      )}
      {addToLibrary.error && (
        <p className="field-error" role="alert">
          Adding to the global library failed: {addToLibrary.error.message}
        </p>
      )}
      {/* A geometry still using the component refuses the delete (409). */}
      {remove.error && (
        <p className="field-error" role="alert">
          Cannot delete “{name}”: {remove.error.message}
        </p>
      )}
      <div className="library-detail-body">
        <ComponentEditor
          projectId={projectId}
          componentId={componentId}
          onStatusChange={setEditorStatus}
        />
        <VersionList
          projectId={projectId}
          kind={EntityKind.COMPONENT}
          id={componentId}
          draft={draft.data}
        />
      </div>
    </section>
  );
}
