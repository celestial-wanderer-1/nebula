import * as Dialog from "@radix-ui/react-dialog";
import type { Any } from "@bufbuild/protobuf/wkt";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { useCreateEntity, useEntities } from "../api/entities";
import { ValidationError } from "../api/errors";
import { useProject } from "../api/projects";
import type { EntityKind } from "../gen/nebula/core/v1/entity_pb";
import type { Project } from "../gen/nebula/core/v1/project_pb";
import { ENTITY_LABELS } from "./kinds";
import { shortHash } from "./references";

export interface EntityListPageProps {
  projectId: string;
  kind: EntityKind;
  title: string;
  /** Plural noun for the empty and loading texts, such as "regions". */
  plural: string;
  /** Path of the editor of one entity. */
  editorPath: (id: string) => string;
  /** Content of a new entity, from the project (for example its concept). */
  newContent: (project: Project | undefined) => Any | undefined;
  /** What a new entity starts as, shown in the create dialog. */
  newDescription: string;
  /** More header actions, such as creating from a template. */
  actions?: ReactNode;
}

/**
 * The list of a project's entities of one kind, with links to their editor
 * and a create dialog (docs/UI.md Section 4.4). Every draft entity area
 * starts from it.
 */
export function EntityListPage({
  projectId,
  kind,
  title,
  plural,
  editorPath,
  newContent,
  newDescription,
  actions,
}: EntityListPageProps) {
  const entities = useEntities(projectId, kind);
  const [creating, setCreating] = useState(false);
  const label = ENTITY_LABELS[kind].toLowerCase();

  return (
    <section>
      <div className="page-header">
        <h1>{title}</h1>
        <div className="actions">
          {actions}
          <button
            type="button"
            className="primary"
            onClick={() => setCreating(true)}
          >
            New {label}
          </button>
        </div>
      </div>

      {entities.isPending && <p className="muted">Loading {plural}…</p>}
      {entities.error && (
        <p className="field-error" role="alert">
          {entities.error.message}
        </p>
      )}
      {entities.data?.length === 0 && <p className="muted">No {plural} yet.</p>}
      {entities.data && entities.data.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Draft revision</th>
              <th scope="col">Head version</th>
            </tr>
          </thead>
          <tbody>
            {entities.data.map((entity) => (
              <tr key={entity.id}>
                <th scope="row">
                  <Link to={editorPath(entity.id)}>
                    {entity.name || entity.id}
                  </Link>
                </th>
                <td>{entity.revision}</td>
                <td>
                  {entity.headHash ? (
                    <code title={entity.headHash}>
                      {shortHash(entity.headHash)}
                    </code>
                  ) : (
                    <span className="muted">Never versioned</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <NewEntityDialog
        projectId={projectId}
        kind={kind}
        open={creating}
        onOpenChange={setCreating}
        editorPath={editorPath}
        newContent={newContent}
        description={newDescription}
      />
    </section>
  );
}

/** Creates an entity with a name, then opens its editor. */
function NewEntityDialog({
  projectId,
  kind,
  open,
  onOpenChange,
  editorPath,
  newContent,
  description,
}: {
  projectId: string;
  kind: EntityKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editorPath: (id: string) => string;
  newContent: (project: Project | undefined) => Any | undefined;
  description: string;
}) {
  const ids = useId();
  const navigate = useNavigate();
  const project = useProject(projectId);
  const createEntity = useCreateEntity(projectId, kind);
  const [name, setName] = useState("");
  const label = ENTITY_LABELS[kind].toLowerCase();
  const nameError =
    createEntity.error instanceof ValidationError
      ? createEntity.error.violations.find((v) => v.path === "name")?.message
      : undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    createEntity.mutate(
      { name: name.trim(), content: newContent(project.data) },
      {
        onSuccess: (draft) => {
          onOpenChange(false);
          setName("");
          void navigate(editorPath(draft.id));
        },
      },
    );
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) createEntity.reset();
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog">
          <Dialog.Title>New {label}</Dialog.Title>
          <Dialog.Description>{description}</Dialog.Description>
          <form onSubmit={submit} className="stack">
            <label htmlFor={`${ids}-name`}>Name</label>
            <input
              id={`${ids}-name`}
              required
              value={name}
              aria-invalid={nameError ? true : undefined}
              onChange={(event) => setName(event.target.value)}
            />
            {nameError && (
              <p className="field-error" role="alert">
                {nameError}
              </p>
            )}
            {createEntity.error && !nameError && (
              <p className="field-error" role="alert">
                {createEntity.error.message}
              </p>
            )}
            <div className="dialog-actions">
              <Dialog.Close asChild>
                <button type="button">Cancel</button>
              </Dialog.Close>
              <button
                type="submit"
                className="primary"
                disabled={createEntity.isPending || project.isPending}
              >
                Create {label}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
