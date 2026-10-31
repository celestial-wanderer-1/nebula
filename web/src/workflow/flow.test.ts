import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { ValidationIssueSchema } from "../gen/nebula/core/v1/project_pb";
import { pluginFixtures } from "../mocks/fixtures";
import { workflowTemplateFixtures } from "../mocks/setupFixtures";
import { toCanvasEdges, toCanvasNodes } from "./flow";
import { indexIssues } from "./issues";
import { extensionIndex } from "./ports";

const extensions = extensionIndex(pluginFixtures());
const transport = workflowTemplateFixtures().find(
  (t) => t.id === "wft-transport",
)!.workflow!;

describe("canvas mapping", () => {
  it("puts groups before their children and sizes them around them", () => {
    const nodes = toCanvasNodes(transport, extensions, indexIssues([]));
    const ids = nodes.map((n) => n.id);
    expect(ids.indexOf("slices")).toBeLessThan(ids.indexOf("stability"));
    const group = nodes.find((n) => n.id === "slices")!;
    expect(group.type).toBe("group");
    expect(group.style!.width).toBeGreaterThanOrEqual(320);
    expect(nodes.find((n) => n.id === "stability")).toMatchObject({
      parentId: "slices",
      extent: "parent",
    });
  });

  it("labels time-series edges with their time base (D92)", () => {
    const edges = toCanvasEdges(transport, extensions, indexIssues([]));
    expect(edges.find((e) => e.id === "e-2")).toMatchObject({
      label: "time series: scenario",
      animated: true,
    });
    expect(edges.find((e) => e.id === "e-1")?.label).toBeUndefined();
  });

  it("names nodes and edges for screen readers", () => {
    const nodes = toCanvasNodes(transport, extensions, indexIssues([]));
    const stability = nodes.find((n) => n.id === "stability")!;
    expect(stability.ariaLabel).toBe(
      `${stability.data.kindLabel} ${stability.data.node.label || "stability"}`,
    );
    const edges = toCanvasEdges(
      transport,
      extensions,
      indexIssues([
        create(ValidationIssueSchema, { path: "edges/e-1", message: "bad" }),
      ]),
    );
    expect(edges.find((e) => e.id === "e-1")?.ariaLabel).toMatch(
      / to .*\(has issues\)$/,
    );
    expect(edges.find((e) => e.id === "e-2")?.ariaLabel).not.toContain(
      "issues",
    );
  });
});
