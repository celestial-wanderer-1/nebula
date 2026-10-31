import * as Dialog from "@radix-ui/react-dialog";
import { forwardRef, useState, type ComponentPropsWithoutRef } from "react";

/**
 * Dialog content that returns focus to whatever opened it. Radix returns
 * focus to a Dialog.Trigger, but these dialogs open from state; this
 * remembers the element focused when the dialog first renders, before
 * focus moves into it (WCAG 2.4.3).
 */
export const DialogContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof Dialog.Content>
>(function DialogContent({ onCloseAutoFocus, ...props }, ref) {
  const [opener] = useState(() =>
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  return (
    <Dialog.Content
      ref={ref}
      {...props}
      onCloseAutoFocus={(event) => {
        onCloseAutoFocus?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        if (opener?.isConnected) opener.focus();
      }}
    />
  );
});
