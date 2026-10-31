import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DeterminismMode, RunState } from "../../gen/nebula/core/v1/run_pb";
import { submitRun } from "../../mocks/runs/service";
import { scenarios } from "../../mocks/scenarios";
import { store } from "../../mocks/state";
import { renderRoute } from "../../test/render";

vi.mock("../../viewers/plotly/Chart", () => ({
  Chart: ({ label, data }: { label: string; data: unknown[] }) => (
    <div role="figure" aria-label={label} data-traces={data.length} />
  ),
}));

const P = "p-baseline";

/** Submits wf-chain in fast mode, which no fixture Run has cached. */
function submit(script = "success") {
  scenarios.scriptNextRun(script);
  const result = submitRun(store, P, {
    workflowId: "wf-chain",
    gpus: 1,
    mode: DeterminismMode.FAST,
    dryRun: false,
    name: "",
    rerunOf: "",
  });
  if (!result.ok || !result.value.run) throw new Error("not submitted");
  return result.value.run.id;
}

const actions = () => screen.getByRole("group", { name: "Run actions" });
const button = (name: string) =>
  within(actions()).getByRole("button", { name });
const enabled = () =>
  within(actions())
    .getAllByRole("button")
    .filter((b) => !b.hasAttribute("disabled"))
    .map((b) => b.textContent);

describe("RunDetail", () => {
  it("follows a Run through its states with only valid actions enabled", async () => {
    const id = submit();
    renderRoute(`/p/${P}/runs/${id}`);
    expect(
      await screen.findByText("Queued", { selector: ".badge" }),
    ).toBeVisible();
    expect(enabled()).toEqual(["Cancel"]);

    act(() => scenarios.runUntil(id, RunState.RUNNING));
    await waitFor(() => expect(enabled()).toEqual(["Pause", "Cancel"]));
    act(() => scenarios.advance(600));
    const logs = await screen.findByRole("list", { name: "Log lines" });
    await waitFor(() => expect(logs).toHaveTextContent("Started attempt 1"));
    expect(
      await screen.findByRole("figure", { name: "Convergence residuals" }),
    ).toHaveAttribute("data-traces", "1");

    await userEvent.click(button("Pause"));
    act(() => scenarios.runUntil(id, RunState.PAUSED));
    await waitFor(() => expect(enabled()).toEqual(["Resume", "Cancel"]));

    await userEvent.click(button("Resume"));
    act(() => scenarios.runUntil(id, RunState.COMPLETED));
    await waitFor(() =>
      expect(enabled()).toEqual(["Re-run", "Re-run with edited workflow"]),
    );
    const attempts = screen.getByRole("region", { name: "Attempts" });
    expect(within(attempts).getAllByRole("row")).toHaveLength(3);
    const outputs = screen.getByRole("region", { name: "Outputs" });
    expect(
      within(outputs).getByText(/Local stability · growth_rates/),
    ).toBeVisible();
  });

  it("offers resume after oom with a checkpoint (A§3.7)", async () => {
    const id = submit("oom");
    renderRoute(`/p/${P}/runs/${id}`);
    await screen.findByText("Queued", { selector: ".badge" });
    act(() => scenarios.runUntil(id, RunState.FAILED));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Attempt 1 failed (oom)",
    );
    await waitFor(() =>
      expect(enabled()).toEqual([
        "Resume",
        "Discard",
        "Re-run",
        "Re-run with edited workflow",
      ]),
    );
  });

  it("offers only re-runs and discard after divergence", async () => {
    const id = submit("diverged");
    renderRoute(`/p/${P}/runs/${id}`);
    await screen.findByText("Queued", { selector: ".badge" });
    act(() => scenarios.runUntil(id, RunState.FAILED));
    await waitFor(() =>
      expect(enabled()).toEqual([
        "Discard",
        "Re-run",
        "Re-run with edited workflow",
      ]),
    );
    expect(screen.getByText("diverged", { selector: ".badge" })).toBeVisible();
  });

  it("filters logs by level and text", async () => {
    const id = submit();
    renderRoute(`/p/${P}/runs/${id}`);
    await screen.findByText("Queued", { selector: ".badge" });
    act(() => scenarios.runUntil(id, RunState.COMPLETED));
    const logs = await screen.findByRole("list", { name: "Log lines" });
    await waitFor(() => expect(logs).toHaveTextContent("Run completed"));
    expect(logs).not.toHaveTextContent("Iteration 2");
    await userEvent.selectOptions(
      screen.getByLabelText("Level"),
      "debug and above",
    );
    await waitFor(() => expect(logs).toHaveTextContent("Iteration 2"));
    await userEvent.type(screen.getByLabelText("Contains"), "committed");
    await waitFor(() =>
      expect(within(logs).getAllByRole("listitem").length).toBe(3),
    );
  });

  it("lists the project's runs and the shared queue", async () => {
    const id = submit();
    renderRoute(`/p/${P}/runs?tab=queue`);
    const queue = await screen.findByRole("table", { name: "Queue" });
    await waitFor(() =>
      expect(within(queue).getAllByRole("row")).toHaveLength(3),
    );
    await userEvent.click(
      within(queue).getByRole("button", {
        name: /^Cancel Field to stability #13/,
      }),
    );
    await waitFor(() =>
      expect(store.engine.run(id)?.state).toBe(RunState.CANCELLED),
    );
    await userEvent.click(screen.getByRole("tab", { name: "Project runs" }));
    const runs = await screen.findByRole("table", { name: "Runs" });
    expect(
      within(runs).getByRole("link", { name: "Field to stability #13" }),
    ).toBeVisible();
  });
});
