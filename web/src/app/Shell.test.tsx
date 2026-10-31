import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeterminismMode, RunState } from "../gen/nebula/core/v1/run_pb";
import { submitRun } from "../mocks/runs/service";
import { scenarios } from "../mocks/scenarios";
import { store } from "../mocks/state";
import { renderRoute } from "../test/render";

describe("Shell", () => {
  it("shows live queue counts and GPU use", async () => {
    renderRoute("/");
    const queue = screen.getByRole("status", { name: "Queue" });
    await waitFor(() => expect(queue).toHaveTextContent("1 running"));
    expect(queue).toHaveTextContent("0 queued");
    await waitFor(() => expect(queue).toHaveTextContent("GPUs 1/4"));

    // A submitted Run queues, prepares, then takes its GPUs (A§3.4).
    const submitted = submitRun(store, "p-baseline", {
      workflowId: "wf-default-less",
      gpus: 0,
      mode: 0,
      dryRun: false,
      name: "",
      rerunOf: "",
    });
    expect(submitted.ok).toBe(false);
    const run = submitRun(store, "p-baseline", {
      workflowId: "wf-chain",
      gpus: 2,
      mode: DeterminismMode.FAST,
      dryRun: false,
      name: "",
      rerunOf: "",
    });
    const runId = run.ok ? run.value.run!.id : "";
    await waitFor(() => expect(queue).toHaveTextContent("1 queued"));
    act(() => scenarios.runUntil(runId, RunState.RUNNING));
    await waitFor(() => expect(queue).toHaveTextContent("2 running"));
    expect(queue).toHaveTextContent("0 queued");
  });

  it("warns about failed plugin smoke tests (D61)", async () => {
    renderRoute("/");
    const status = await screen.findByRole("link", { name: /2 plugins/ });
    expect(status).toHaveTextContent("1 smoke failure");
    expect(status).toHaveAttribute("href", "/admin/plugins");
  });

  it("shows project navigation inside a project", async () => {
    renderRoute("/p/p-baseline/studies");
    // Areas load lazily: the layout renders once the route has loaded.
    const nav = await screen.findByRole("navigation", { name: "Project" });
    expect(within(nav).getByRole("link", { name: "Studies" })).toHaveClass(
      "active",
    );
    expect(
      await screen.findByRole("heading", { name: "Studies" }),
    ).toBeVisible();
    expect(
      within(nav)
        .getAllByRole("link")
        .map((l) => l.textContent),
    ).toEqual([
      "Overview",
      "Geometry",
      "Libraries",
      "Regions",
      "Scenarios",
      "Conductor networks",
      "Workflows",
      "Runs and queue",
      "Results",
      "Comparison",
      "Studies",
      "Storage",
    ]);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^Switch project/ }),
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
