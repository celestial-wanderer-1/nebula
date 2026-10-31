import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ViewportSlot } from "./ViewportSlot";

const imports = vi.hoisted(() => ({ attempts: 0 }));

// The first load of the viewer chunk fails, as after a rebuild of the served
// bundle; the next one succeeds.
vi.mock("./Viewport", () => {
  imports.attempts++;
  if (imports.attempts === 1) {
    throw new Error("Failed to fetch dynamically imported module");
  }
  return { Viewport: () => <div data-testid="viewport" /> };
});

afterEach(() => vi.restoreAllMocks());

describe("ViewportSlot", () => {
  it("falls back when the viewer chunk fails to load, and retries the import", async () => {
    // React reports the error the boundary catches.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <ViewportSlot
        geometryId="geo-main"
        components={[]}
        replicas={new Map()}
        onSelect={() => undefined}
      />,
    );
    expect(await screen.findByRole("note")).toHaveTextContent(
      "3D view unavailable",
    );
    expect(imports.attempts).toBe(1);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    // `lazy` keeps a failed import, so only a fresh one can succeed.
    expect(await screen.findByTestId("viewport")).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(imports.attempts).toBe(2);
  });
});
