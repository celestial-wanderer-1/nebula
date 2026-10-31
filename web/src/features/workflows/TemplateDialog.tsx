import * as Dialog from "@radix-ui/react-dialog";
import { useId, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import {
  useInstantiateWorkflow,
  useWorkflowTemplates,
} from "../../api/workflows";

/**
 * Creates a workflow from a template: the concept kit's default workflow
 * or a standard chain (D50, D86), then opens it.
 */
export function TemplateDialog({
  projectId,
  open,
  onOpenChange,
  editorPath,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editorPath: (id: string) => string;
}) {
  const ids = useId();
  const navigate = useNavigate();
  const templates = useWorkflowTemplates(projectId);
  const instantiate = useInstantiateWorkflow(projectId);
  const [templateId, setTemplateId] = useState("");
  const [name, setName] = useState("");
  const chosen = templates.data?.find((t) => t.id === templateId);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    instantiate.mutate(
      { templateId, name: name.trim() || chosen?.name || "" },
      {
        onSuccess: (draft) => {
          onOpenChange(false);
          setName("");
          setTemplateId("");
          void navigate(editorPath(draft.id));
        },
      },
    );
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) instantiate.reset();
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog">
          <Dialog.Title>New workflow from a template</Dialog.Title>
          <Dialog.Description>
            Start from the concept’s default workflow or a standard chain.
          </Dialog.Description>
          <form onSubmit={submit} className="stack">
            <fieldset className="template-choices">
              <legend>Template</legend>
              {templates.isPending && <p className="muted">Loading…</p>}
              {templates.data?.map((template) => (
                <label key={template.id} className="radio-card">
                  <input
                    type="radio"
                    name={`${ids}-template`}
                    value={template.id}
                    checked={templateId === template.id}
                    onChange={() => setTemplateId(template.id)}
                  />
                  <span>
                    <strong>{template.name}</strong>
                    <span className="muted small"> {template.description}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <label htmlFor={`${ids}-name`}>Name</label>
            <input
              id={`${ids}-name`}
              value={name}
              placeholder={chosen?.name}
              onChange={(event) => setName(event.target.value)}
            />
            {instantiate.error && (
              <p className="field-error" role="alert">
                {instantiate.error.message}
              </p>
            )}
            <div className="dialog-actions">
              <Dialog.Close asChild>
                <button type="button">Cancel</button>
              </Dialog.Close>
              <button
                type="submit"
                className="primary"
                disabled={!templateId || instantiate.isPending}
              >
                Create workflow
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
