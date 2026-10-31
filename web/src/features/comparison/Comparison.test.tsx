import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../test/render";
import { resetCameras, useCameras } from "../../viewers/cameraStore";
import type { VtkCanvasProps } from "../../viewers/vtk/VtkCanvas";

vi.mock("../../viewers/vtk/VtkCanvas", () => ({
  VtkCanvas: ({ camera, onCamera }: VtkCanvasProps) => (
    <button
      type="button"
      data-testid="vtk-canvas"
      data-camera={camera ? camera.position.join(",") : ""}
      onClick={() =>
        onCamera?.({
          position: [1, 2, 3],
          focalPoint: [0, 0, 0],
          viewUp: [0, 0, 1],
        })
      }
    >
      orbit
    </button>
  ),
}));
vi.mock("../../viewers/plotly/Chart", () => ({
  Chart: ({ label, data }: { label: string; data: { name: string }[] }) => (
    <div
      role="img"
      aria-label={label}
      data-traces={data.map((d) => d.name).join("|")}
    />
  ),
}));

beforeEach(() => resetCameras());

async function compare() {
  const { router } = renderRoute("/p/p-baseline/comparison");
  const form = await screen.findByRole("form", { name: "New comparison" });
  await userEvent.click(
    await within(form).findByRole("checkbox", {
      name: /Field to stability #11/,
    }),
  );
  await userEvent.click(
    within(form).getByRole("checkbox", { name: /Field to stability #3/ }),
  );
  const region = within(form).getByRole("group", { name: "Shared region" });
  const select = within(region).getByLabelText("Region");
  await waitFor(() =>
    expect(within(select).getByText("Poloidal plane")).toBeInTheDocument(),
  );
  await userEvent.selectOptions(select, "reg-midplane");
  await userEvent.click(
    within(form).getByRole("button", { name: "Compare 2 runs" }),
  );
  await waitFor(() =>
    expect(router.state.location.pathname).toMatch(/comparison\/cmp-1$/),
  );
  return router;
}

describe("Comparison (docs/UI.md 6.8)", () => {
  it("flags scalars beyond their declared tolerance (D43)", async () => {
    await compare();
    expect(
      await screen.findByRole("status", { name: "Comparison summary" }),
    ).toHaveTextContent("1 quantity differs beyond tolerance.");
    const table = screen.getByRole("table", { name: "Scalars across runs" });
    const q95 = within(table).getByRole("row", { name: /q95/ });
    expect(q95).toHaveTextContent("3.31");
    expect(q95).toHaveTextContent("3.02");
    expect(q95).toHaveTextContent("±2%");
    expect(q95).toHaveTextContent("Out of tolerance");
    expect(
      within(table).getByRole("row", { name: /Magnetic axis R/ }),
    ).toHaveTextContent("Within tolerance");
  });

  it("overlays the Runs' profiles in one chart", async () => {
    await compare();
    await userEvent.click(await screen.findByRole("tab", { name: "Profiles" }));
    const chart = await screen.findByRole("img", {
      name: "Profiles of t1/equilibrium across runs",
    });
    await waitFor(() =>
      expect(chart.dataset.traces).toBe(
        "q · Field to stability #11|p / p0 · Field to stability #11|q · Field to stability #3|p / p0 · Field to stability #3",
      ),
    );
  });

  it("shows a difference field resampled on the shared Region (D104)", async () => {
    await compare();
    await userEvent.click(
      await screen.findByRole("tab", { name: "Difference" }),
    );
    const view = await screen.findByRole("img", {
      name: /r-11 − r-03: field · field/,
    });
    expect(view).toHaveAttribute("data-scalars", "Δ|B|");
    expect(view).toHaveAttribute("data-origin", "6.2,0,0");
  });

  it("links the 3D views to one camera (A§13.7)", async () => {
    await compare();
    await userEvent.click(
      await screen.findByRole("tab", { name: "Linked 3D" }),
    );
    const canvases = await screen.findAllByTestId(
      "vtk-canvas",
      {},
      { timeout: 5000 },
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("vtk-canvas")).toHaveLength(2),
    );
    await userEvent.click(canvases[0]!);
    expect(useCameras.getState().poses["comparison-cmp-1"]?.position).toEqual([
      1, 2, 3,
    ]);
    await waitFor(() =>
      screen
        .getAllByTestId("vtk-canvas")
        .forEach((canvas) =>
          expect(canvas).toHaveAttribute("data-camera", "1,2,3"),
        ),
    );
  });
});
