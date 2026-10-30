import * as Dialog from "@radix-ui/react-dialog";
import type { EntityDraft } from "../gen/nebula/core/v1/entity_pb";

/**
 * Shown when a draft save hit 409 (D148): another client changed the draft.
 * The user keeps the server's version or re-applies their change on top.
 */
export function ConflictDialog({
  conflict,
  onResolve,
}: {
  conflict: EntityDraft | undefined;
  onResolve: (choice: "server" | "reapply") => void;
}) {
  return (
    <Dialog.Root open={Boolean(conflict)}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="dialog"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <Dialog.Title>Edited elsewhere</Dialog.Title>
          <Dialog.Description>
            Another client saved “{conflict?.name}” (revision{" "}
            {conflict?.revision}) while you were editing. Keep their version, or
            re-apply your change on top of it.
          </Dialog.Description>
          <div className="dialog-actions">
            <button type="button" onClick={() => onResolve("server")}>
              Keep server version
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => onResolve("reapply")}
            >
              Re-apply my change
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
