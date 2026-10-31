import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import {
  ViewerKind,
  ViewRequestSchema,
  type ViewParamsSchema,
} from "../../gen/nebula/core/v1/view_pb";
import { MockStore } from "../store";
import { contourSegments } from "./contour";

const request = (
  output: [string, string, string],
  viewer: ViewerKind,
  params: MessageInitShape<typeof ViewParamsSchema> = {},
) =>
  create(ViewRequestSchema, {
    requestId: "q",
    output: { runId: output[0], nodeId: output[1], outputName: output[2] },
    viewer,
    params,
  });

describe("contourSegments", () => {
  it("finds the circle of a radial field", () => {
    const xs = Array.from({ length: 41 }, (_, i) => -1 + i / 20);
    const values = xs.flatMap((y) => xs.map((x) => Math.hypot(x, y)));
    const segments = contourSegments(xs, xs, values, 0.5);
    expect(segments.length).toBeGreaterThan(20);
    for (const [a] of segments) expect(Math.hypot(...a)).toBeCloseTo(0.5, 1);
  });
});

describe("ViewService (A§3.6)", () => {
  it("builds a payload per catalogue viewer", () => {
    const store = new MockStore("1");
    const cases: [[string, string, string], ViewerKind, string][] = [
      [["r-14", "transport", "profiles"], ViewerKind.PROFILE_1D, "plotly"],
      [["r-14", "transport", "profiles"], ViewerKind.TIME_TRACE, "plotly"],
      [["r-14", "stability", "growth_rates"], ViewerKind.SPECTRUM, "plotly"],
      [["r-14", "t1", "equilibrium"], ViewerKind.CONTOUR_2D, "polydata"],
      [["r-11", "field", "field"], ViewerKind.CONTOUR_2D, "polydata"],
      [["r-14", "field", "field"], ViewerKind.FIELD_3D, "polydata"],
      [["r-14", "poincare", "poincare"], ViewerKind.POINCARE, "polydata"],
      [["r-14", "stability", "modes"], ViewerKind.MODE_STRUCTURE, "polydata"],
    ];
    for (const [output, viewer, body] of cases) {
      const { reply } = store.views.handle(request(output, viewer));
      expect(reply.result.case, `${output.join("/")} ${viewer}`).toBe(
        "payload",
      );
      const payload = reply.result.value as {
        body: { case: string };
        viewer: ViewerKind;
      };
      expect(payload.body.case).toBe(body);
      expect(payload.viewer).toBe(viewer);
    }
  });

  it("serves a repeated request from the payload cache", () => {
    const store = new MockStore("1");
    const first = store.views.handle(
      request(["r-14", "t1", "equilibrium"], ViewerKind.CONTOUR_2D),
    );
    expect(first.reply.cached).toBe(false);
    expect(first.delayMs).toBeGreaterThan(0);
    const again = store.views.handle(
      request(["r-14", "t1", "equilibrium"], ViewerKind.CONTOUR_2D),
    );
    expect(again).toMatchObject({ delayMs: 0, reply: { cached: true } });
    // Other parameters are another payload.
    const other = store.views.handle(
      request(["r-14", "t1", "equilibrium"], ViewerKind.CONTOUR_2D, {
        isovalues: [0.5],
      }),
    );
    expect(other.reply.cached).toBe(false);
  });

  it("returns an isosurface as glTF with a payload origin (D117, D156)", () => {
    const store = new MockStore("1");
    const { reply } = store.views.handle(
      request(["r-14", "field", "field"], ViewerKind.FIELD_3D, {
        isovalues: [0.6],
      }),
    );
    expect(
      reply.result.case === "payload" && reply.result.value.body.case,
    ).toBe("gltf");
  });

  it("reports outputs it cannot view", () => {
    const store = new MockStore("1");
    expect(
      store.views.handle(
        request(["r-14", "field", "operator"], ViewerKind.FIELD_3D),
      ).reply.result,
    ).toMatchObject({ case: "error", value: { code: "not_viewable" } });
    expect(
      store.views.handle(request(["r-14", "nope", "x"], ViewerKind.FIELD_3D))
        .reply.result,
    ).toMatchObject({ case: "error", value: { code: "not_found" } });
    expect(
      store.views.handle(
        request(["r-14", "t1", "equilibrium"], ViewerKind.TIME_TRACE),
      ).reply.result,
    ).toMatchObject({ case: "error", value: { message: "Not a time series" } });
  });

  it("slices time series by time index (D146)", () => {
    const store = new MockStore("1");
    const at = (timeIndex: number) => {
      const { reply } = store.views.handle(
        request(["r-14", "transport", "profiles"], ViewerKind.PROFILE_1D, {
          timeIndex,
        }),
      );
      const figure =
        reply.result.case === "payload" &&
        reply.result.value.body.case === "plotly"
          ? reply.result.value.body.value.figure
          : undefined;
      return (figure?.data as { y: number[] }[])[0]!.y[0]!;
    };
    expect(at(9)).toBeGreaterThan(at(0));
  });
});
