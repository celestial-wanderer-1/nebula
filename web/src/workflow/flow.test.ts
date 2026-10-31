import { describe, expect, it } from "vitest";
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
});
