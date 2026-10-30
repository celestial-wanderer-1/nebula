import { afterEach, describe, expect, it } from "vitest";
import { bootstrapToken, getToken } from "./token";

describe("bootstrapToken", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("keeps the token in memory and scrubs it from the address bar", () => {
    window.history.replaceState(
      null,
      "",
      "/p/p-baseline/workflows?x=1#token=abc_DEF-123",
    );
    expect(bootstrapToken()).toBe("abc_DEF-123");
    expect(getToken()).toBe("abc_DEF-123");
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/p/p-baseline/workflows");
    expect(window.location.search).toBe("?x=1");
  });

  it("leaves the URL alone and has no token without a fragment", () => {
    window.history.replaceState(null, "", "/p/p-baseline");
    expect(bootstrapToken()).toBeUndefined();
    expect(window.location.pathname).toBe("/p/p-baseline");
  });

  it("never stores the token in cookies or web storage (D137)", () => {
    window.history.replaceState(null, "", "/#token=secret");
    bootstrapToken();
    expect(document.cookie).not.toContain("secret");
    expect(JSON.stringify({ ...window.localStorage })).not.toContain("secret");
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain(
      "secret",
    );
  });
});
