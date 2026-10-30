import * as Dialog from "@radix-ui/react-dialog";
import { useId, useState, type FormEvent } from "react";
import { useSaveTemplate } from "../../api/projects";
import type { Project } from "../../gen/nebula/core/v1/project_pb";

/** Saves a project as a template for new projects (D86). */
export function SaveTemplateDialog({
  project,
  onClose,
}: {
  project: Project | undefined;
  onClose: () => void;
}) {
  const ids = useId();
  const save = useSaveTemplate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const close = () => {
    save.reset();
    setName("");
    setDescription("");
    onClose();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!project) return;
    save.mutate(
      { projectId: project.id, request: { name, description } },
      { onSuccess: close },
    );
  };

  return (
    <Dialog.Root
      open={Boolean(project)}
      onOpenChange={(open) => !open && close()}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog">
          <Dialog.Title>Save “{project?.name}” as a template</Dialog.Title>
          <Dialog.Description>
            New projects can start from this template.
          </Dialog.Description>
          <form onSubmit={submit} className="stack">
            <label htmlFor={`${ids}-name`}>Template name</label>
            <input
              id={`${ids}-name`}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <label htmlFor={`${ids}-description`}>Description</label>
            <textarea
              id={`${ids}-description`}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
            {save.error && (
              <p className="field-error" role="alert">
                {save.error.message}
              </p>
            )}
            <div className="dialog-actions">
              <Dialog.Close asChild>
                <button type="button">Cancel</button>
              </Dialog.Close>
              <button
                type="submit"
                className="primary"
                disabled={save.isPending}
              >
                Save template
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
