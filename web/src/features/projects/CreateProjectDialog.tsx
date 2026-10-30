import * as Dialog from "@radix-ui/react-dialog";
import { useId, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { ValidationError } from "../../api/errors";
import { useCreateProject } from "../../api/projects";
import { useTemplates } from "../../api/templates";
import { TemplateKind } from "../../gen/nebula/core/v1/project_pb";

/** Creates a project from a concept starter or a saved template (D86). */
export function CreateProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const ids = useId();
  const navigate = useNavigate();
  const templates = useTemplates();
  const create = useCreateProject();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [templateId, setTemplateId] = useState("");

  const starters =
    templates.data?.filter((t) => t.kind === TemplateKind.CONCEPT_STARTER) ??
    [];
  const saved =
    templates.data?.filter((t) => t.kind === TemplateKind.SAVED) ?? [];
  const nameError =
    create.error instanceof ValidationError
      ? create.error.violations.find((v) => v.path === "name")?.message
      : undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(
      { name, description, templateId },
      {
        onSuccess: (project) => {
          onOpenChange(false);
          setName("");
          setDescription("");
          setTemplateId("");
          void navigate(`/p/${encodeURIComponent(project.id)}`);
        },
      },
    );
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) create.reset();
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog">
          <Dialog.Title>New project</Dialog.Title>
          <Dialog.Description>
            Start from a concept kit or a saved template.
          </Dialog.Description>
          <form onSubmit={submit} className="stack">
            <label htmlFor={`${ids}-template`}>Template</label>
            <select
              id={`${ids}-template`}
              required
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
            >
              <option value="" disabled>
                {templates.isPending ? "Loading…" : "Choose a template"}
              </option>
              {starters.length > 0 && (
                <optgroup label="Concept kits">
                  {starters.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {saved.length > 0 && (
                <optgroup label="Saved templates">
                  {saved.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>

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

            <label htmlFor={`${ids}-description`}>Description</label>
            <textarea
              id={`${ids}-description`}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />

            {create.error && !nameError && (
              <p className="field-error" role="alert">
                {create.error.message}
              </p>
            )}
            <div className="dialog-actions">
              <Dialog.Close asChild>
                <button type="button">Cancel</button>
              </Dialog.Close>
              <button
                type="submit"
                className="primary"
                disabled={create.isPending}
              >
                Create project
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
