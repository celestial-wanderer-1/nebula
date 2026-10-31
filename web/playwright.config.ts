import { defineConfig, devices } from "@playwright/test";

// E2E_TARGET picks the backend (docs/UI.md P7):
// - mock: the mock bundle under `vite preview`, the backend in the page;
// - real: the production bundle served by the stub server, which applies
//   the server's controls; its one shared backend means serial tests.
const real = process.env.E2E_TARGET === "real";
const port = real ? 4174 : 4173;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: !real,
  workers: real ? 1 : undefined,
  forbidOnly: true,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: real ? "real" : "mock",
      use: {
        ...devices["Desktop Chrome"],
        // Software WebGL for the geometry viewport in headless runs.
        launchOptions: {
          args: [
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
            "--ignore-gpu-blocklist",
          ],
        },
      },
    },
  ],
  webServer: {
    command: real
      ? `pnpm run build && pnpm run build:stub && node stub-server/dist/main.mjs --port ${port}`
      : `pnpm run build:mock && pnpm exec vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    env: real ? { NEBULA_STUB_TOKEN: "stub-e2e-token" } : {},
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
