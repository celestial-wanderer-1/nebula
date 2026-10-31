import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import { reactRefresh } from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores([
    "dist/**",
    "stub-server/dist/**",
    "src/gen/**",
    "src/mocks/fixtures/acme-demo.ts",
    "public/mockServiceWorker.js",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
  ]),
  js.configs.recommended,
  {
    files: [
      "**/*.{js,mjs}",
      "*.config.ts",
      "e2e/**/*.ts",
      "stub-server/**/*.ts",
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [tseslint.configs.recommended],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  reactRefresh.configs.vite(),
  {
    // Test helpers are never hot-reloaded.
    files: ["src/test/**", "src/**/*.test.{ts,tsx}"],
    rules: { "react-refresh/only-export-components": "off" },
  },
);
