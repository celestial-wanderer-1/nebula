import * as Dialog from "@radix-ui/react-dialog";
import { useId, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { ValidationError } from "../../api/errors";
import { useCreateEntity } from "../../api/entities";
import { newComponent } from "../../entities/content";
import { ShapeSelect } from "../../entities/ShapeSelect";
import { EntityKind } from "../../gen/nebula/core/v1/entity_pb";
import { useSchema } from "../../schema/context";
import { componentPath } from "./paths";

/**
 * Creates a project component of a shape type that an installed plugin
 * registers (A§10.1), with the shape's `ui.default_json` defaults (D87).
 */
export function NewComponentDialog({
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
  const { typeRegistry } = useSchema();
  const createComponent = useCreateEntity(projectId, EntityKind.COMPONENT);
  const [name, setName] = useState("");
  const [shapeType, setShapeType] = useState("");
  const [unknownType, setUnknownType] = useState<string>();

  const nameError =
    createComponent.error instanceof ValidationError
      ? createComponent.error.violations.find((v) => v.path === "name")?.message
      : undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const desc = typeRegistry.getMessage(shapeType);
    if (!desc) {
      setUnknownType(`Shape type “${shapeType}” is not loaded.`);
      return;
    }
    setUnknownType(undefined);
    createComponent.mutate(
      { name: name.trim(), content: newComponent(desc) },
      {
        onSuccess: (draft) => {
          onOpenChange(false);
          setName("");
          setShapeType("");
          void navigate(componentPath(projectId, draft.id));
        },
      },
    );
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) createComponent.reset();
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog">
          <Dialog.Title>New component</Dialog.Title>
          <Dialog.Description>
            A project component of a shape type an installed plugin provides.
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

            <ShapeSelect
              id={`${ids}-shape`}
              label="Shape type"
              value={shapeType}
              onChange={setShapeType}
            />

            {unknownType && (
              <p className="field-error" role="alert">
                {unknownType}
              </p>
            )}
            {createComponent.error && !nameError && (
              <p className="field-error" role="alert">
                {createComponent.error.message}
              </p>
            )}
            <div className="dialog-actions">
              <Dialog.Close asChild>
                <button type="button">Cancel</button>
              </Dialog.Close>
              <button
                type="submit"
                className="primary"
                disabled={createComponent.isPending}
              >
                Create component
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
