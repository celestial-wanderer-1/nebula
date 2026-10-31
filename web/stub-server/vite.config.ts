import { defineConfig } from "vite";

// Bundles the stub server for Node. A Vite build, so the mock backend's
// `import.meta.glob` and `import.meta.env` resolve as in the browser.
export default defineConfig({
  root: new URL("..", import.meta.url).pathname,
  publicDir: false,
  logLevel: "warn",
  define: { __NEBULA_MOCK__: "true" },
  build: {
    ssr: "stub-server/main.ts",
    outDir: "stub-server/dist",
    emptyOutDir: true,
    target: "node20",
    rollupOptions: { output: { entryFileNames: "main.mjs" } },
  },
});
