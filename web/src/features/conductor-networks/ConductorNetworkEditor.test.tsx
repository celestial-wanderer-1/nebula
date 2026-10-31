import { anyUnpack } from "@bufbuild/protobuf/wkt";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ConductorNetworkSchema } from "../../gen/nebula/core/v1/conductor_network_pb";
import { EntityKind } from "../../gen/nebula/core/v1/entity_pb";
import { store } from "../../mocks/state";
import { renderRoute } from "../../test/render";

const P = "p-baseline";
const saved = () =>
  anyUnpack(
    store.entity(P, EntityKind.CONDUCTOR_NETWORK, "cn-vessel")!.draft.content!,
    ConductorNetworkSchema,
  )!;

describe("ConductorNetworkEditor", () => {
  it("builds on the geometry's circuits and the network's own supplies (D128)", async () => {
    renderRoute(`/p/${P}/conductor-networks/cn-vessel`);
    const circuit = await screen.findByRole("listitem", { name: "Circuits 1" });
    const select = within(circuit).getByLabelText("Circuit");
    await waitFor(() =>
      expect(within(select).getByText("Feed (ckt-feed)")).toBeInTheDocument(),
    );
    expect(within(circuit).getByLabelText("Power supply")).toHaveValue(
      "sup-pf",
    );

    // A new supply gets a stable ID and becomes a choice at once.
    await userEvent.click(
      screen.getByRole("button", { name: "Add power supplies" }),
    );
    const supply = screen.getByRole("listitem", { name: "Power supplies 2" });
    await userEvent.type(within(supply).getByLabelText("Name"), "Feed supply");
    await waitFor(() => expect(saved().supplies[1]?.name).toBe("Feed supply"), {
      timeout: 3000,
    });
    const id = saved().supplies[1]!.id;
    expect(id).toMatch(/^sup-[0-9a-f]{8}$/);
    expect(
      within(within(circuit).getByLabelText("Power supply")).getByText(
        "Feed supply",
      ),
    ).toBeInTheDocument();
  });

  it("puts passive elements on the geometry's components (D71)", async () => {
    renderRoute(`/p/${P}/conductor-networks/cn-vessel`);
    await userEvent.click(
      await screen.findByRole("button", { name: "Add passive elements" }),
    );
    const element = screen.getByRole("listitem", {
      name: "Passive elements 2",
    });
    const component = within(element).getByLabelText("Component");
    await waitFor(() =>
      expect(within(component).getByText("Vacuum vessel")).toBeInTheDocument(),
    );
    await userEvent.selectOptions(component, "cmp-pf1");
    await waitFor(
      () =>
        expect(saved().elements[1]).toMatchObject({
          componentId: "cmp-pf1",
          model: 1,
          id: expect.stringMatching(/^el-/),
        }),
      { timeout: 3000 },
    );
  });
});
