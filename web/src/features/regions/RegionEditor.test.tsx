import { anyUnpack } from "@bufbuild/protobuf/wkt";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { EntityKind } from "../../gen/nebula/core/v1/entity_pb";
import { RegionSchema } from "../../gen/nebula/core/v1/region_pb";
import { scenarios } from "../../mocks/scenarios";
import { server } from "../../mocks/node";
import { store } from "../../mocks/state";
import { renderRoute } from "../../test/render";
import type { PlacementViewProps } from "./PlacementView";

vi.mock("./PlacementView", () => ({
  PlacementView: ({ components, preview }: PlacementViewProps) => (
    <div
      data-testid="placement"
      data-meshes={components.filter((c) => c.mesh).length}
      data-region-lines={preview.lines.length}
      data-covered={preview.components.join(",")}
    />
  ),
}));

const P = "p-baseline";
const saved = (id: string) =>
  anyUnpack(
    store.entity(P, EntityKind.REGION, id)!.draft.content!,
    RegionSchema,
  )!;

describe("RegionEditor", () => {
  it("lists regions and creates one", async () => {
    const { router } = renderRoute(`/p/${P}/regions`);
    expect(
      await screen.findByRole("link", { name: "Poloidal plane" }),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "New region" }));
    const dialog = await screen.findByRole("dialog", { name: "New region" });
    await userEvent.type(
      within(dialog).getByRole("textbox", { name: "Name" }),
      "Probe",
    );
    const submit = within(dialog).getByRole("button", {
      name: "Create region",
    });
    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);
    expect(
      await screen.findByRole("heading", { name: "Probe", level: 1 }),
    ).toBeVisible();
    expect(router.state.location.pathname).toMatch(
      /^\/p\/p-baseline\/regions\/reg-/,
    );
  });

  it("places a plane over its pinned geometry version", async () => {
    renderRoute(`/p/${P}/regions/reg-midplane`);
    const placement = await screen.findByTestId("placement");
    // geo-v2 has six components, of which the open spline renders too.
    await waitFor(() =>
      expect(Number(placement.dataset.meshes)).toBeGreaterThan(0),
    );
    expect(placement).toHaveAttribute("data-region-lines", "18");
    await userEvent.clear(screen.getByLabelText("Samples along first axis"));
    await userEvent.type(
      screen.getByLabelText("Samples along first axis"),
      "3",
    );
    expect(placement).toHaveAttribute("data-region-lines", "12");
    await waitFor(
      () =>
        expect(saved("reg-midplane").shape).toMatchObject({
          case: "plane",
          value: { nu: 3 },
        }),
      { timeout: 3000 },
    );
  });

  it("offers the referenced geometry's components to a surface region", async () => {
    renderRoute(`/p/${P}/regions/reg-probe-line`);
    await userEvent.selectOptions(
      await screen.findByLabelText("Shape"),
      "componentSurface",
    );
    const component = screen.getByLabelText("Component");
    await waitFor(() =>
      expect(within(component).getByText("Vacuum vessel")).toBeInTheDocument(),
    );
    await userEvent.selectOptions(component, "cmp-vessel");
    expect(screen.getByTestId("placement")).toHaveAttribute(
      "data-covered",
      "cmp-vessel",
    );
  });

  it("asks what to keep when another client edits the region (D148)", async () => {
    // The save lands after the other client's edit, on a stale revision.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let patches = 0;
    server.use(
      http.patch(`/projects/${P}/regions/reg-probe-line`, async () => {
        if (++patches === 1) await held;
        return undefined;
      }),
    );
    renderRoute(`/p/${P}/regions/reg-probe-line`);
    await userEvent.type(await screen.findByLabelText("Samples"), "1");
    await waitFor(() => expect(patches).toBe(1), { timeout: 3000 });
    scenarios.concurrentEdit(P, EntityKind.REGION, "reg-probe-line");
    release();
    const dialog = await screen.findByRole("dialog", {
      name: "Edited elsewhere",
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Re-apply my change" }),
    );
    await waitFor(
      () =>
        expect(saved("reg-probe-line").shape).toMatchObject({
          value: { samples: 1011 },
        }),
      { timeout: 3000 },
    );
  });
});
