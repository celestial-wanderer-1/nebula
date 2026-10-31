import * as Dialog from "@radix-ui/react-dialog";
import { DialogContent } from "../../components/DialogContent";
import type { Extension } from "../../gen/nebula/core/v1/plugin_pb";

/**
 * Offered when an output and an input carry different sub-contracts that
 * an installed adapter converts (D55): connecting them needs the adapter
 * as an explicit node.
 */
export function AdapterOffer({
  offer,
  onInsert,
  onCancel,
}: {
  offer: { message: string; adapters: Extension[] } | undefined;
  onInsert: (adapter: Extension) => void;
  onCancel: () => void;
}) {
  return (
    <Dialog.Root
      open={Boolean(offer)}
      onOpenChange={(open) => !open && onCancel()}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <DialogContent className="dialog">
          <Dialog.Title>Insert an adapter</Dialog.Title>
          <Dialog.Description>
            {offer?.message}. Connect them through an adapter:
          </Dialog.Description>
          <ul className="adapter-list">
            {offer?.adapters.map((adapter) => (
              <li key={adapter.id}>
                <button
                  type="button"
                  className="primary"
                  onClick={() => onInsert(adapter)}
                >
                  Insert {adapter.displayName}
                </button>{" "}
                <code className="muted">{adapter.id}</code>
              </li>
            ))}
          </ul>
          <div className="dialog-actions">
            <Dialog.Close asChild>
              <button type="button">Cancel</button>
            </Dialog.Close>
          </div>
        </DialogContent>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
