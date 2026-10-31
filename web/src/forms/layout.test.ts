import { describe, expect, it } from "vitest";
import { CircularFilamentSchema } from "../gen/nebula/core/v1/component_pb";
import { mockSchema } from "../mocks/fixtures";
import { newMessage } from "./defaults";
import { layoutMessage, type LayoutItem } from "./layout";

const names = (items: LayoutItem[]) =>
  items.map((item) =>
    item.kind === "field" ? item.field.name : `oneof:${item.oneof.name}`,
  );

describe("layoutMessage", () => {
  it("orders by ui.order then field number, groups after ungrouped fields", () => {
    const config = mockSchema.getMessage("acme.demo.v1.DemoSolverConfig")!;
    const groups = layoutMessage(config);
    expect(groups.map((group) => group.name)).toEqual(["", "Convergence"]);
    expect(names(groups[0]!.items)).toEqual([
      "coil_current",
      "edge_temperature",
      "use_symmetry",
      "label",
      "method",
      "oneof:boundary",
      "grid",
      "radial_knots",
      "probes",
      "geometry",
      "initial_guess",
      "extra",
      "future_field",
    ]);
    expect(names(groups[1]!.items)).toEqual(["tolerance", "max_iterations"]);
  });

  it("drops hidden fields", () => {
    const config = mockSchema.getMessage("acme.demo.v1.DemoSolverConfig")!;
    const all = layoutMessage(config).flatMap((group) => names(group.items));
    expect(all).not.toContain("internal_key");
  });

  it("lays out core messages the same way (D111)", () => {
    const groups = layoutMessage(CircularFilamentSchema);
    expect(groups.map((g) => [g.name, names(g.items)])).toEqual([
      ["", ["major_radius", "height"]],
      ["Discretization", ["segments"]],
    ]);
  });
});

describe("newMessage", () => {
  it("applies ui.default_json to new messages", () => {
    const config = mockSchema.getMessage("acme.demo.v1.DemoSolverConfig")!;
    expect(newMessage(config)).toMatchObject({
      tolerance: 1e-8,
      maxIterations: 200,
      method: 2,
    });
    expect(newMessage(CircularFilamentSchema)).toMatchObject({
      segments: 128,
    });
  });
});
