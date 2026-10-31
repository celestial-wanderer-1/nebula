import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  DEFAULT_CAMERA,
  resetGeometryView,
  useGeometryView,
  useSelection,
} from "./store";

beforeEach(() => resetGeometryView());

describe("geometry view store", () => {
  it("scopes the selection to its geometry", () => {
    const main = renderHook(() => useSelection("geo-main"));
    const alt = renderHook(() => useSelection("geo-alt"));
    act(() =>
      useGeometryView
        .getState()
        .select("geo-main", { kind: "component", id: "cmp-pf1" }),
    );
    expect(main.result.current).toEqual({ kind: "component", id: "cmp-pf1" });
    expect(alt.result.current).toBeUndefined();

    act(() =>
      useGeometryView.getState().select("geo-alt", { kind: "symmetry" }),
    );
    expect(main.result.current).toBeUndefined();
    expect(alt.result.current).toEqual({ kind: "symmetry" });
  });

  it("keeps a camera per geometry", () => {
    const camera = {
      position: [1, 2, 3] as [number, number, number],
      target: [0, 0, 1] as [number, number, number],
    };
    useGeometryView.getState().setCamera("geo-main", camera);
    useGeometryView.getState().select("geo-alt", { kind: "symmetry" });
    expect(useGeometryView.getState().cameras["geo-main"]).toEqual(camera);
    expect(useGeometryView.getState().cameras["geo-alt"]).toBeUndefined();
    expect(DEFAULT_CAMERA.target).toEqual([0, 0, 0]);
  });
});
