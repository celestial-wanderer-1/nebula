import * as Dialog from "@radix-ui/react-dialog";
import { DialogContent } from "../../components/DialogContent";
import { useId, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { ValidationError } from "../../api/errors";
import { useCreateMaterial } from "../../api/materials";
import { materialPath } from "./paths";

/** Creates a project material; its properties are edited on its page. */
export function NewMaterialDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const ids = useId();
  const navigate = useNavigate();
  const createMaterial = useCreateMaterial(projectId);
  const [name, setName] = useState("");

  const nameError =
    createMaterial.error instanceof ValidationError
      ? createMaterial.error.violations.find((v) => v.path === "name")?.message
      : undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    createMaterial.mutate(
      { name: name.trim(), properties: {} },
      {
        onSuccess: (material) => {
          onOpenChange(false);
          setName("");
          void navigate(materialPath(projectId, material.id));
        },
      },
    );
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) createMaterial.reset();
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <DialogContent className="dialog">
          <Dialog.Title>New material</Dialog.Title>
          <Dialog.Description>
            A project material. Set its properties after creating it.
          </Dialog.Description>
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
            {createMaterial.error && !nameError && (
              <p className="field-error" role="alert">
                {createMaterial.error.message}
              </p>
            )}
            <div className="dialog-actions">
              <Dialog.Close asChild>
                <button type="button">Cancel</button>
              </Dialog.Close>
              <button
                type="submit"
                className="primary"
                disabled={createMaterial.isPending}
              >
                Create material
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
