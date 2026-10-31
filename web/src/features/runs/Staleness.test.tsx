import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { store } from "../../mocks/state";
import { renderRoute } from "../../test/render";

describe("Run staleness (A§4.4, D101)", () => {
  it("re-runs a stale Run with the latest inputs in one click", async () => {
    const { router } = renderRoute("/p/p-baseline/runs");
    const runs = await screen.findByRole("table", { name: "Runs" });
    // r-03 pinned geo-v1 and scn-v1; the heads have moved since.
    const stale = await within(runs).findByRole("button", {
      name: "Re-run Field to stability #3 with latest inputs",
    });
    expect(
      within(runs).queryByRole("button", {
        name: /Re-run Field to stability #11/,
      }),
    ).toBeNull();
    await userEvent.click(stale);
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/runs\/r-1\d\d$/),
    );
    const id = router.state.location.pathname.split("/").pop()!;
    const run = store.engine.run(id)!;
    expect(run.rerunOf).toBe("r-03");
    // The latest inputs are r-11's: every step comes from the cache.
    expect(run.cacheHit).toBe(true);
    const state = await screen.findByRole("group", { name: "Run state" });
    expect(within(state).getByText("cache hit")).toBeVisible();
  });
});
