import { create } from "@bufbuild/protobuf";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ComponentTessellationSchema,
  MeshTopology,
} from "../../gen/nebula/core/v1/geometry_pb";
import { encodeMesh } from "../../mocks/tessellate";
import { Viewport } from "./Viewport";

afterEach(() => vi.restoreAllMocks());

describe("Viewport", () => {
  it("falls back without WebGL and still reports the meshes", () => {
    // React reports the error the boundary catches.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const mesh = encodeMesh(MeshTopology.LINE_LOOP, [
      [1, 0, 0],
      [0, 1, 0],
      [-1, 0, 0],
    ]);
    render(
      <Viewport
        geometryId="geo-main"
        components={[
          create(ComponentTessellationSchema, {
            componentId: "cmp-pf1",
            revision: 3,
            mesh,
          }),
        ]}
        replicas={new Map([["cmp-pf1", [Math.PI]]])}
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByTestId("viewport")).toHaveAttribute(
      "data-mesh-revisions",
      "cmp-pf1:3",
    );
    expect(screen.getByTestId("viewport")).toHaveAttribute(
      "data-replicas",
      "cmp-pf1:1",
    );
    expect(screen.getByRole("note")).toHaveTextContent("3D view unavailable");
  });
});
