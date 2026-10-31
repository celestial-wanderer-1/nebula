import type { RouteObject } from "react-router";
import { describe, expect, it } from "vitest";
import { isApiPath } from "../api/paths";
import { routes } from "./routes";

/** Every route's absolute path, with parameters as sample values. */
function paths(list: RouteObject[], parent = ""): string[] {
  return list.flatMap((route) => {
    const own = route.path ?? "";
    const path = own.startsWith("/")
      ? own
      : [parent, own].filter(Boolean).join("/");
    return [path, ...paths(route.children ?? [], path)];
  });
}

describe("routes", () => {
  it("never claim a path the API owns, which a server cannot fall back on", () => {
    const browser = paths(routes)
      .filter((path) => path && path !== "*")
      .map((path) => path.replace(/:[^/]+/g, "x").replace(/\*$/, "x"));
    expect(browser).toContain("/admin/plugins");
    expect(browser.filter((path) => isApiPath(path))).toEqual([]);
  });
});
