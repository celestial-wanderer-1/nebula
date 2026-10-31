import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../test/render";

// vtk.js and Plotly need WebGL and layout; their components are replaced
// by elements that expose what they would draw.
vi.mock("../../viewers/vtk/VtkCanvas", () => ({
  VtkCanvas: ({ planar }: { planar?: boolean }) => (
    <div data-testid="vtk-canvas" data-planar={String(Boolean(planar))} />
  ),
}));
vi.mock("../../viewers/plotly/Chart", () => ({
  Chart: ({ label, data }: { label: string; data: unknown[] }) => (
    <div role="figure" aria-label={label} data-traces={data.length} />
  ),
}));

const open = (output: string) =>
  renderRoute(
    `/p/p-baseline/results/r-14?output=${encodeURIComponent(output)}`,
  );
const status = () => screen.getByRole("status", { name: "View status" });

describe("RunResults (docs/UI.md 6.7)", () => {
  it("lists a Run's outputs with their kinds", async () => {
    open("");
    const list = await screen.findByRole("table", { name: "Outputs" });
    await waitFor(() =>
      expect(within(list).getAllByRole("row")).toHaveLength(10),
    );
    expect(
      within(list).getByText("Transport evolution · profiles").closest("tr"),
    ).toHaveTextContent("time series");
    expect(screen.getByText("Choose an output to view.")).toBeVisible();
  });

  it("draws flux surfaces as 2D contours around the payload origin (D156)", async () => {
    open("t1/equilibrium");
    const view = await screen.findByRole("img", { name: "t1 · equilibrium" });
    expect(view).toHaveAttribute("data-pieces", "psi,contours");
    expect(view).toHaveAttribute("data-origin", "6.2,0,0");
    expect(view).toHaveAttribute("data-scalars", "psi_n");
    // The canvas is a lazily loaded chunk.
    expect(
      await screen.findByTestId("vtk-canvas", {}, { timeout: 5000 }),
    ).toHaveAttribute("data-planar", "true");
    expect(screen.getByRole("button", { name: "2D contour" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("list", { name: "Colour scales" }),
    ).toHaveTextContent("psi_n");
  });

  it("round-trips parameter changes through the view channel and its cache (A§3.6)", async () => {
    open("t1/equilibrium");
    const view = await screen.findByRole("img", { name: "t1 · equilibrium" });
    await waitFor(() => expect(status()).toHaveTextContent("Up to date"));
    const before = Number(view.dataset.cells);
    fireEvent.change(screen.getByLabelText("Contour levels"), {
      target: { value: "0.5" },
    });
    // The previous payload stays while the new one is computed.
    expect(status()).toHaveTextContent("Updating…");
    expect(screen.getByRole("img", { name: "t1 · equilibrium" })).toBeVisible();
    await waitFor(() => expect(status()).toHaveTextContent("Up to date"));
    const after = Number(
      screen.getByRole("img", { name: "t1 · equilibrium" }).dataset.cells,
    );
    expect(after).toBeLessThan(before);
    // Back to a request the server has seen: served from its cache.
    fireEvent.change(screen.getByLabelText("Contour levels"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Contour levels"), {
      target: { value: "0.5" },
    });
    await waitFor(() =>
      expect(status()).toHaveTextContent("From the view cache"),
    );
  });

  it("switches viewers and slices time series (D146)", async () => {
    open("transport/profiles");
    const chart = await screen.findByRole("figure", {
      name: "transport · profiles",
    });
    expect(chart).toHaveAttribute("data-traces", "2");
    const table = () => screen.getByRole("table", { name: "Data of Te" });
    const first = () => within(table()).getAllByRole("cell")[1]!.textContent;
    const at0 = first();
    fireEvent.change(screen.getByLabelText("Time slice"), {
      target: { value: "9" },
    });
    expect(screen.getByText(/t = 4.5 s \(10 of 10/)).toBeVisible();
    await waitFor(() => expect(first()).not.toBe(at0));
    await userEvent.click(screen.getByRole("button", { name: "Time trace" }));
    await waitFor(() =>
      expect(
        screen.getByRole("table", { name: "Data of Te(0)" }),
      ).toBeInTheDocument(),
    );
  });

  it("uses the producing extension's view descriptor first (D87)", async () => {
    open("poincare/poincare");
    const view = await screen.findByRole("img", {
      name: "poincare · poincare",
    });
    expect(view).toHaveAttribute("data-pieces", "punctures");
    const tools = screen.getByRole("toolbar", { name: "Viewers" });
    expect(
      within(tools)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Poincaré section", "3D field"]);
  });

  it("shows scalars with their units", async () => {
    open("t1/scalars");
    const table = await screen.findByRole("table", { name: "Scalars of t1" });
    expect(
      within(table).getByRole("row", { name: /Plasma current/ }),
    ).toHaveTextContent("15,000,000 A");
    expect(within(table).getByRole("row", { name: /q95/ })).toHaveTextContent(
      "3.3",
    );
  });

  it("reports an output without a view", async () => {
    open("field/operator");
    expect(await screen.findByText("This output has no viewer.")).toBeVisible();
  });
});
