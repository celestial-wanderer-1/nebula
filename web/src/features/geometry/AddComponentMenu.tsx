import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  useId,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useCreateEntity, useEntities } from "../../api/entities";
import { useImportComponent, useLibraryComponents } from "../../api/library";
import { newComponent } from "../../entities/content";
import { defaultReference } from "../../entities/references";
import { ShapeSelect } from "../../entities/ShapeSelect";
import { EntityKind, type EntityRef } from "../../gen/nebula/core/v1/entity_pb";
import { useSchema } from "../../schema/context";

type Source = "shape" | "existing" | "library";

/**
 * "Add component" menu of the assembly tree: a new shape from the plugins'
 * GEOMETRY_COMPONENT extensions, an existing project component, or a copy
 * imported from the global library (D88). Each ends in `onAdd(ref)`. A
 * dialog returns focus to `trigger`, the menu's trigger, when it closes.
 */
export function AddComponentMenu({
  projectId,
  referenced,
  onAdd,
  trigger,
}: {
  projectId: string;
  referenced: ReadonlySet<string>;
  onAdd: (ref: EntityRef) => void;
  trigger: RefObject<HTMLButtonElement>;
}) {
  const [source, setSource] = useState<Source>();
  const openChange = (next: boolean) => {
    if (!next) setSource(undefined);
  };
  const dialog = { projectId, trigger, onOpenChange: openChange, onAdd };
  return (
    <>
      {/* Not modal: the dialogs it opens own focus (Radix menu-to-dialog). */}
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger ref={trigger} className="tree-action">
          Add component ▾
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="menu" align="start" sideOffset={4}>
            <DropdownMenu.Item
              className="menu-item"
              onSelect={() => setSource("shape")}
            >
              New shape…
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="menu-item"
              onSelect={() => setSource("existing")}
            >
              Existing component…
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="menu-item"
              onSelect={() => setSource("library")}
            >
              From global library…
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {source === "shape" && <NewShapeDialog {...dialog} />}
      {source === "existing" && (
        <ExistingComponentDialog {...dialog} referenced={referenced} />
      )}
      {source === "library" && <LibraryComponentDialog {...dialog} />}
    </>
  );
}

interface SourceDialogProps {
  projectId: string;
  /** Where focus returns on close: the menu item that opened the dialog is
   *  gone by then, and the dialog has no Dialog.Trigger. */
  trigger: RefObject<HTMLButtonElement>;
  onOpenChange: (open: boolean) => void;
  onAdd: (ref: EntityRef) => void;
}

function AddDialog({
  title,
  description,
  trigger,
  onOpenChange,
  onSubmit,
  submitLabel,
  canSubmit,
  pending = false,
  error,
  children,
}: {
  title: string;
  description: string;
  trigger: RefObject<HTMLButtonElement>;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
  submitLabel: string;
  canSubmit: boolean;
  /** A create or import in flight. Its result is added on success, which
   *  needs the dialog: closing it then would orphan the new component. */
  pending?: boolean;
  error?: Error | null;
  children: ReactNode;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        // Escape, outside clicks and Cancel all wait for the request.
        if (open || !pending) onOpenChange(open);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{description}</Dialog.Description>
          <form onSubmit={submit} className="stack">
            {children}
            {error && (
              <p className="field-error" role="alert">
                {error.message}
              </p>
            )}
            <div className="dialog-actions">
              <Dialog.Close asChild>
                <button type="button" disabled={pending}>
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="submit"
                className="primary"
                disabled={!canSubmit || pending}
              >
                {submitLabel}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function NewShapeDialog({
  projectId,
  trigger,
  onOpenChange,
  onAdd,
}: SourceDialogProps) {
  const ids = useId();
  const { typeRegistry } = useSchema();
  const createComponent = useCreateEntity(projectId, EntityKind.COMPONENT);
  const [shapeType, setShapeType] = useState("");
  const [name, setName] = useState("");
  const [unknownType, setUnknownType] = useState<Error>();

  const submit = () => {
    const desc = typeRegistry.getMessage(shapeType);
    if (!desc) {
      setUnknownType(new Error(`Shape type “${shapeType}” is not loaded.`));
      return;
    }
    createComponent.mutate(
      { name: name.trim(), content: newComponent(desc) },
      {
        onSuccess: (draft) => {
          onAdd(defaultReference(EntityKind.COMPONENT, draft.id, ""));
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <AddDialog
      title="New shape"
      description="Creates a project component and adds it to this geometry."
      trigger={trigger}
      onOpenChange={onOpenChange}
      onSubmit={submit}
      submitLabel="Create and add"
      canSubmit
      pending={createComponent.isPending}
      error={unknownType ?? createComponent.error}
    >
      <ShapeSelect
        id={`${ids}-shape`}
        label="Shape"
        value={shapeType}
        onChange={setShapeType}
      />
      <label htmlFor={`${ids}-name`}>Name</label>
      <input
        id={`${ids}-name`}
        required
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
    </AddDialog>
  );
}

function ExistingComponentDialog({
  projectId,
  referenced,
  trigger,
  onOpenChange,
  onAdd,
}: SourceDialogProps & { referenced: ReadonlySet<string> }) {
  const ids = useId();
  const components = useEntities(projectId, EntityKind.COMPONENT);
  const [componentId, setComponentId] = useState("");
  const available =
    components.data?.filter((component) => !referenced.has(component.id)) ?? [];

  const submit = () => {
    const summary = available.find((component) => component.id === componentId);
    if (!summary) return;
    // Pinned to the head version when there is one (D107).
    onAdd(defaultReference(EntityKind.COMPONENT, summary.id, summary.headHash));
    onOpenChange(false);
  };

  return (
    <AddDialog
      title="Existing component"
      description="References a project component that is not yet in this geometry."
      trigger={trigger}
      onOpenChange={onOpenChange}
      onSubmit={submit}
      submitLabel="Add"
      canSubmit={Boolean(componentId)}
      error={components.error}
    >
      <label htmlFor={`${ids}-component`}>Component</label>
      <select
        id={`${ids}-component`}
        required
        value={componentId}
        onChange={(event) => setComponentId(event.target.value)}
      >
        <option value="" disabled>
          {components.isPending
            ? "Loading…"
            : available.length === 0
              ? "Every component is already in this geometry"
              : "Choose a component"}
        </option>
        {available.map((component) => (
          <option key={component.id} value={component.id}>
            {component.name || component.id}
          </option>
        ))}
      </select>
    </AddDialog>
  );
}

function LibraryComponentDialog({
  projectId,
  trigger,
  onOpenChange,
  onAdd,
}: SourceDialogProps) {
  const ids = useId();
  const library = useLibraryComponents();
  const importComponent = useImportComponent(projectId);
  const [entryId, setEntryId] = useState("");
  const entry = library.data?.find((item) => item.id === entryId);

  const submit = () => {
    if (!entryId) return;
    importComponent.mutate(entryId, {
      onSuccess: (draft) => {
        onAdd(defaultReference(EntityKind.COMPONENT, draft.id, ""));
        onOpenChange(false);
      },
    });
  };

  return (
    <AddDialog
      title="From global library"
      description="Copies a library component into the project and adds the copy to this geometry."
      trigger={trigger}
      onOpenChange={onOpenChange}
      onSubmit={submit}
      submitLabel="Import and add"
      canSubmit={Boolean(entryId)}
      pending={importComponent.isPending}
      error={library.error ?? importComponent.error}
    >
      <label htmlFor={`${ids}-entry`}>Library component</label>
      <select
        id={`${ids}-entry`}
        required
        value={entryId}
        onChange={(event) => setEntryId(event.target.value)}
      >
        <option value="" disabled>
          {library.isPending ? "Loading…" : "Choose a library component"}
        </option>
        {library.data?.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name || item.id}
          </option>
        ))}
      </select>
      {entry?.description && <p className="muted small">{entry.description}</p>}
    </AddDialog>
  );
}
