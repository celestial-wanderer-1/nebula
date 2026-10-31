import { expect, test as base } from "@playwright/test";

// Every e2e test fails on an uncaught page error or a Content Security
// Policy violation: the bundle must run under the production CSP (D117,
// docs/UI.md P7).
export const test = base.extend<{ guard: void }>({
  guard: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("pageerror", (error) =>
        problems.push(`page error: ${error.message}`),
      );
      await page.exposeFunction("__reportCsp", (violation: string) =>
        problems.push(`CSP violation: ${violation}`),
      );
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) =>
          (
            window as unknown as { __reportCsp: (v: string) => void }
          ).__reportCsp(
            `${event.effectiveDirective} blocked ${event.blockedURI || "inline"} in ${event.sourceFile}:${event.lineNumber}`,
          ),
        );
      });
      await use();
      expect(problems).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
