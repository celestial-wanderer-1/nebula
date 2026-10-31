import * as Dialog from "@radix-ui/react-dialog";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { DialogContent } from "./DialogContent";

function Opener() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <DialogContent>
            <Dialog.Title>Example</Dialog.Title>
            <Dialog.Description>A dialog opened from state.</Dialog.Description>
            <Dialog.Close>Close</Dialog.Close>
          </DialogContent>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

describe("DialogContent", () => {
  it("returns focus to the element that opened it (WCAG 2.4.3)", async () => {
    render(<Opener />);
    const opener = screen.getByRole("button", { name: "Open" });
    await userEvent.click(opener);
    expect(screen.getByRole("dialog", { name: "Example" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
