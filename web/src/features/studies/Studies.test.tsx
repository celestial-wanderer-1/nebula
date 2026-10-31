import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { scenarios } from "../../mocks/scenarios";
import { store } from "../../mocks/state";
import { renderRoute } from "../../test/render";

describe("Studies (docs/UI.md 6.9)", () => {
  it("creates a 2-variable scan and fills its points table as Runs finish", async () => {
    const { router } = renderRoute("/p/p-baseline/studies/new");
    const workflow = await screen.findByLabelText("Base workflow");
    await waitFor(() =>
      expect(
        within(workflow).getByText("Field to stability"),
      ).toBeInTheDocument(),
    );
    await userEvent.selectOptions(workflow, "wf-chain");
    expect(await screen.findByLabelText("Version")).toHaveValue("sha256:wf-v2");
    const pf = await screen.findByRole("checkbox", { name: /Current of PF/ });
    await userEvent.click(pf);
    await userEvent.click(
      screen.getByRole("checkbox", { name: /Plasma targets: Plasma current/ }),
    );
    const values = screen.getByRole("group", {
      name: "Values of Plasma targets: Plasma current",
    });
    await userEvent.selectOptions(
      within(values).getByRole("combobox"),
      "points",
    );
    const points = within(values).getByRole("textbox", { name: /Points of/ });
    await userEvent.clear(points);
    await userEvent.type(points, "1.4e7, 1.6e7");
    expect(screen.getByText("6 points")).toBeVisible();
    // Concurrency defaults to the GPU count (D142).
    expect(screen.getByLabelText("Concurrent runs")).toHaveValue("4");
    await userEvent.click(screen.getByRole("button", { name: "Create scan" }));
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/studies\/std-1$/),
    );

    const table = await screen.findByRole("table", { name: "Points" });
    expect(within(table).getAllByRole("row")).toHaveLength(7);
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    const progress = screen.getByRole("status", { name: "Study progress" });
    await waitFor(() =>
      expect(progress).toHaveTextContent("4 active (at most 4)"),
    );
    const study = store.studies.list("p-baseline")[0]!;
    act(() =>
      store.clock.advanceUntil(() =>
        study.points.every((p) => p.metrics.q95 !== undefined),
      ),
    );
    await waitFor(() =>
      expect(progress).toHaveTextContent("Completed: 6 of 6 points completed"),
    );
    const first = within(table).getAllByRole("row")[1]!;
    expect(first).toHaveTextContent("4.140e+4");
    expect(
      within(first).getByRole("link", { name: /^r-1\d\d$/ }),
    ).toBeVisible();
    expect(first.textContent).toMatch(/Completed\d\.\d+/);
    void scenarios;
  });
});
