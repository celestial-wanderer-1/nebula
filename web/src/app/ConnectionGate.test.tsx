import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { setTokenForTesting } from "../api/token";
import { UI_API_VERSION } from "../api/version";
import { server } from "../mocks/node";
import { scenarios } from "../mocks/scenarios";
import { testQueryClient } from "../test/render";
import { ConnectionGate } from "./ConnectionGate";

function renderGate() {
  return render(
    <QueryClientProvider client={testQueryClient()}>
      <ConnectionGate>
        {(registry) => (
          <p>
            Connected with{" "}
            {registry.getMessage("acme.demo.v1.DemoSolverConfig")?.name}
          </p>
        )}
      </ConnectionGate>
    </QueryClientProvider>,
  );
}

describe("ConnectionGate", () => {
  it("asks for the launch URL when there is no token", () => {
    renderGate();
    expect(
      screen.getByRole("heading", { name: "Open Nebula from its launch URL" }),
    ).toBeVisible();
    expect(screen.getByText(/reloading the page also requires/)).toBeVisible();
  });

  it("reports a rejected token", async () => {
    setTokenForTesting("stale-token");
    renderGate();
    expect(
      await screen.findByRole("heading", { name: "Access token rejected" }),
    ).toBeVisible();
  });

  it("stops on an incompatible server and shows both build identities", async () => {
    setTokenForTesting("mock-token");
    scenarios.versionMismatch();
    renderGate();
    expect(
      await screen.findByRole("heading", { name: "Incompatible server" }),
    ).toBeVisible();
    expect(screen.getByText("mock-build-1", { exact: false })).toBeVisible();
    expect(screen.getByText(UI_API_VERSION)).toBeVisible();
    expect(screen.queryByText(/Connected/)).toBeNull();
  });

  it("offers a retry when the server is unreachable", async () => {
    setTokenForTesting("mock-token");
    server.use(http.get("/version", () => HttpResponse.error()));
    renderGate();
    expect(
      await screen.findByRole("heading", { name: "Server unreachable" }),
    ).toBeVisible();

    server.resetHandlers();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByText("Connected with DemoSolverConfig"),
    ).toBeVisible();
  });

  it("treats a 502 from a proxy or forward as unreachable", async () => {
    setTokenForTesting("mock-token");
    server.use(
      http.get("/version", () => new HttpResponse(null, { status: 502 })),
    );
    renderGate();
    expect(
      await screen.findByRole("heading", { name: "Server unreachable" }),
    ).toBeVisible();
  });

  it("builds the schema registry from /plugins once compatible", async () => {
    setTokenForTesting("mock-token");
    renderGate();
    expect(
      await screen.findByText("Connected with DemoSolverConfig"),
    ).toBeVisible();
  });
});
