import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { bootstrapToken } from "./api/token";
import { App } from "./app/App";
import { applyCspNonce } from "./app/cspNonce";
import "./app/styles.css";

async function main() {
  applyCspNonce();
  // The dynamic import keeps the mock out of production bundles.
  if (__NEBULA_MOCK__) {
    const { startMockBackend } = await import("./mocks/browser");
    await startMockBackend();
  }
  bootstrapToken();

  const root = document.getElementById("root");
  if (!root) {
    throw new Error("Missing application root element");
  }
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void main();
