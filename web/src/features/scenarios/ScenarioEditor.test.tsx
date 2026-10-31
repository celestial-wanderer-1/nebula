import { anyUnpack } from "@bufbuild/protobuf/wkt";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EntityKind } from "../../gen/nebula/core/v1/entity_pb";
import { ScenarioSchema } from "../../gen/nebula/core/v1/scenario_pb";
import { store } from "../../mocks/state";
import { renderRoute } from "../../test/render";

vi.mock("../../viewers/plotly/Chart", () => ({
  Chart: ({ label, data }: { label: string; data: unknown[] }) => (
    <div role="img" aria-label={label} data-traces={data.length} />
  ),
}));

const P = "p-baseline";
const saved = () =>
  anyUnpack(
    store.entity(P, EntityKind.SCENARIO, "scn-flattop")!.draft.content!,
    ScenarioSchema,
  )!;
const SAVE = { timeout: 3000 };

async function open() {
  renderRoute(`/p/${P}/scenarios/scn-flattop`);
  const currents = await screen.findByRole("region", {
    name: "Circuit currents",
  });
  await within(currents).findByRole("textbox", { name: "Current of PF" });
  return currents;
}

describe("ScenarioEditor", () => {
  it("keys currents by the circuits of the pinned geometry version (D114)", async () => {
    const currents = await open();
    const rows = within(currents).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.dataset.circuit)).toEqual([
      "ckt-pf",
      "ckt-feed",
    ]);
    const pf = within(currents).getByRole("textbox", { name: "Current of PF" });
    await userEvent.clear(pf);
    await userEvent.type(pf, "47000");
    await waitFor(
      () =>
        expect(saved().currents[0]).toMatchObject({
          circuitId: "ckt-pf",
          current: 47000,
        }),
      SAVE,
    );
  });

  it("flags currents of circuits the chosen geometry version lacks", async () => {
    const currents = await open();
    // geo-v1 has only the PF circuit.
    const picker = screen.getByRole("group", { name: "Geometry" });
    await userEvent.selectOptions(
      within(picker).getByLabelText("Version"),
      "sha256:geo-v1",
    );
    await waitFor(() =>
      expect(within(currents).getByText("Not in the geometry")).toBeVisible(),
    );
    expect(within(currents).getByRole("alert")).toHaveTextContent(
      "A current names a circuit the geometry does not have",
    );
    await userEvent.click(
      within(currents).getByRole("button", {
        name: "Remove current of ckt-feed",
      }),
    );
    expect(within(currents).queryByText("Not in the geometry")).toBeNull();
    await waitFor(() => expect(saved().currents).toHaveLength(1), SAVE);
  });

  it("edits a current's waveform as a table with a preview", async () => {
    const currents = await open();
    await userEvent.click(
      within(currents).getAllByRole("button", { name: "Static" })[0]!,
    );
    const waveform = screen.getByRole("group", {
      name: "Current of PF waveform",
    });
    await userEvent.click(
      within(waveform).getByRole("button", { name: "Add point" }),
    );
    await userEvent.click(
      within(waveform).getByRole("button", { name: "Add point" }),
    );
    const value = within(waveform).getByRole("textbox", { name: "Value 2" });
    await userEvent.clear(value);
    await userEvent.type(value, "46000");
    expect(
      await within(waveform).findByRole("img", {
        name: "Current of PF against time",
      }),
    ).toHaveAttribute("data-traces", "1");
    await waitFor(
      () =>
        expect(saved().currents[0]?.waveform).toMatchObject({
          times: [0, 1],
          values: [0, 46000],
        }),
      SAVE,
    );
  });

  it("sets a current for a circuit that has none", async () => {
    store.entity(P, EntityKind.SCENARIO, "scn-flattop")!.draft.content =
      undefined;
    renderRoute(`/p/${P}/scenarios/scn-flattop`);
    expect(
      await screen.findByText(
        "Choose a geometry: currents are keyed by its circuits.",
      ),
    ).toBeVisible();
    const picker = screen.getByRole("group", { name: "Geometry" });
    const geometry = within(picker).getByLabelText("Geometry");
    await waitFor(() =>
      expect(
        within(geometry).getByText("Baseline assembly"),
      ).toBeInTheDocument(),
    );
    await userEvent.selectOptions(geometry, "geo-main");
    const currents = screen.getByRole("region", { name: "Circuit currents" });
    await userEvent.click(
      await within(currents).findByRole("button", {
        name: "Set current of Feed",
      }),
    );
    expect(
      within(currents).getByRole("textbox", { name: "Current of Feed" }),
    ).toHaveValue("0");
  });
});
