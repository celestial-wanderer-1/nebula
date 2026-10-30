import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { scenarios } from "../mocks/scenarios";
import { renderRoute } from "../test/render";

describe("Shell", () => {
  it("shows live queue counts and GPU use", async () => {
    renderRoute("/");
    const queue = screen.getByRole("status", { name: "Queue" });
    await waitFor(() => expect(queue).toHaveTextContent("1 running"));
    expect(queue).toHaveTextContent("2 queued");
    await waitFor(() => expect(queue).toHaveTextContent("GPUs 1/4"));

    scenarios.setQueue(0, 3);
    await waitFor(() => expect(queue).toHaveTextContent("3 running"));
    expect(queue).toHaveTextContent("0 queued");
  });

  it("warns about failed plugin smoke tests (D61)", async () => {
    renderRoute("/");
    const status = await screen.findByRole("link", { name: /2 plugins/ });
    expect(status).toHaveTextContent("1 smoke failure");
    expect(status).toHaveAttribute("href", "/plugins");
  });

  it("shows project navigation and phase placeholders inside a project", async () => {
    renderRoute("/p/p-baseline/workflows");
    const nav = screen.getByRole("navigation", { name: "Project" });
    expect(within(nav).getByRole("link", { name: "Workflows" })).toHaveClass(
      "active",
    );
    expect(screen.getByRole("heading", { name: "Workflows" })).toBeVisible();
    expect(screen.getByText("This area arrives in phase P3.")).toBeVisible();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Switch project" }),
      ).toHaveTextContent("Tokamak baseline"),
    );
  });

  it("reports an unknown project", async () => {
    renderRoute("/p/nope");
    expect(
      await screen.findByRole("heading", { name: "Project not found" }),
    ).toBeVisible();
  });
});
