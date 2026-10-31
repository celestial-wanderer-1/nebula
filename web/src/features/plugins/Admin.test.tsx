import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { store } from "../../mocks/state";
import { renderRoute } from "../../test/render";

describe("Plugins and settings (docs/UI.md 6.10)", () => {
  it("lists manifests with ABI, .so hash and smoke results per GPU model", async () => {
    renderRoute("/admin/plugins");
    const acme = await screen.findByRole("region", { name: "acme.demo 1.2.0" });
    expect(acme).toHaveTextContent(
      "clang 19.1, libstdc++ 14, ROCm 7.1, Nebula ABI 1",
    );
    expect(acme).toHaveTextContent("acme1200");
    expect(acme).toHaveTextContent("Solvers: Demo solver");
    const smoke = within(acme).getByRole("table", {
      name: "Smoke V&V of acme.demo",
    });
    expect(within(smoke).getByRole("row", { name: /W7900/ })).toHaveTextContent(
      "failed Residual above tolerance",
    );
    expect(
      screen.getByRole("region", { name: "nebula.core 1.0.0" }),
    ).toHaveTextContent("Compiled into the core");
  });

  it("shows the configuration read-only and switches a project's strict cache", async () => {
    renderRoute("/admin/settings");
    const file = await screen.findByLabelText("Configuration file");
    await waitFor(() => expect(file).toHaveTextContent("[gpus]"));
    const toggle = await screen.findByRole("switch", {
      name: "Tokamak baseline",
    });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await userEvent.click(toggle);
    await waitFor(() =>
      expect(store.project("p-baseline")?.settings?.strictCache).toBe(true),
    );
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
  });
});
