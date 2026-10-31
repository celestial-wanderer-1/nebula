import type { Extension } from "../gen/nebula/core/v1/plugin_pb";
import type { ValidationIssue } from "../gen/nebula/core/v1/project_pb";
import type { Node, Workflow } from "../gen/nebula/core/v1/workflow_pb";
import type { IssueIndex } from "./issues";
import { isGroup, nodePorts, type NodePorts } from "./ports";

// Workflow <-> canvas mapping: the workflow is the source of truth; the
// canvas draws it (React Flow node and edge shapes, without importing it).

export const NODE_WIDTH = 220;
const GROUP_PADDING = { x: 40, top: 60, bottom: 40 };

export const KIND_LABELS: Readonly<
  Record<NonNullable<Node["kind"]["case"]>, string>
> = {
  solver: "Solver step",
  adapter: "Adapter",
  postOp: "PostOp",
  objective: "Objective",
  coupled: "Coupled",
  fanOut: "Fan-out",
  storedOutput: "Stored output",
  inputDataset: "Input dataset",
};

export interface CanvasNodeData {
  node: Node;
  ports: NodePorts;
  kindLabel: string;
  issues: ValidationIssue[];
  /** Issues by port name. */
  portIssues: ReadonlyMap<string, ValidationIssue[]>;
  [key: string]: unknown;
}

export interface CanvasNode {
  id: string;
  type: "step" | "group";
  position: { x: number; y: number };
  parentId?: string;
  extent?: "parent";
  data: CanvasNodeData;
  style?: { width: number; height: number };
  selected?: boolean;
  ariaLabel: string;
}

export interface CanvasEdge {
  id: string;
  ariaLabel: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  label?: string;
  animated?: boolean;
  className?: string;
  data: { issues: ValidationIssue[] };
}

/** Size of a group node: around its children, at least a minimum. */
function groupSize(workflow: Workflow, group: Node) {
  const children = workflow.nodes.filter((n) => n.parentId === group.id);
  const width = Math.max(
    320,
    ...children.map((c) => (c.layout?.x ?? 0) + NODE_WIDTH + GROUP_PADDING.x),
  );
  const height = Math.max(
    200,
    ...children.map((c) => (c.layout?.y ?? 0) + 140 + GROUP_PADDING.bottom),
  );
  return { width, height };
}

/** Parents before children, as the canvas requires. */
function ordered(workflow: Workflow): Node[] {
  const placed = new Set<string>();
  const out: Node[] = [];
  let remaining = [...workflow.nodes];
  while (remaining.length) {
    const ready = remaining.filter(
      (n) =>
        !n.parentId ||
        placed.has(n.parentId) ||
        !workflow.nodes.some((p) => p.id === n.parentId),
    );
    if (ready.length === 0) {
      out.push(...remaining);
      break;
    }
    for (const n of ready) {
      placed.add(n.id);
      out.push(n);
    }
    remaining = remaining.filter((n) => !placed.has(n.id));
  }
  return out;
}

export function toCanvasNodes(
  workflow: Workflow,
  extensions: ReadonlyMap<string, Extension>,
  issues: IssueIndex,
  selectedId?: string,
): CanvasNode[] {
  const ids = new Set(workflow.nodes.map((n) => n.id));
  return ordered(workflow).map((node) => {
    const ports = nodePorts(workflow, node, extensions);
    const portIssues = new Map<string, ValidationIssue[]>();
    for (const [key, list] of issues.ports) {
      const [nodeId, port] = key.split("/");
      if (nodeId === node.id && port) portIssues.set(port, list);
    }
    const group = isGroup(node);
    const kindLabel = KIND_LABELS[node.kind.case ?? "solver"];
    return {
      id: node.id,
      type: group ? "group" : "step",
      // Screen readers name nodes, not just their IDs (docs/UI.md P7).
      ariaLabel: `${kindLabel} ${node.label || node.id}`,
      position: { x: node.layout?.x ?? 0, y: node.layout?.y ?? 0 },
      ...(node.parentId && ids.has(node.parentId)
        ? { parentId: node.parentId, extent: "parent" as const }
        : {}),
      ...(group ? { style: groupSize(workflow, node) } : {}),
      selected: node.id === selectedId,
      data: {
        node,
        ports,
        kindLabel,
        issues: issues.nodes.get(node.id) ?? [],
        portIssues,
      },
    };
  });
}

export function toCanvasEdges(
  workflow: Workflow,
  extensions: ReadonlyMap<string, Extension>,
  issues: IssueIndex,
): CanvasEdge[] {
  const byId = new Map(workflow.nodes.map((n) => [n.id, n]));
  return workflow.edges.map((edge) => {
    const source = byId.get(edge.from?.nodeId ?? "");
    const port =
      source &&
      nodePorts(workflow, source, extensions).outputs.find(
        (p) => p.name === edge.from?.port,
      );
    const found = issues.edges.get(edge.id) ?? [];
    // Time-series edges show their time base (D92).
    const label = port?.type.timeSeries
      ? `time series: ${port.type.timeBase || "slices"}`
      : undefined;
    const target = byId.get(edge.to?.nodeId ?? "");
    const end = (node: typeof source, port = "") =>
      `${node?.label || node?.id || "?"} ${port}`;
    return {
      id: edge.id,
      ariaLabel: `${end(source, edge.from?.port)} to ${end(target, edge.to?.port)}${found.length ? " (has issues)" : ""}`,
      source: edge.from?.nodeId ?? "",
      sourceHandle: edge.from?.port ?? "",
      target: edge.to?.nodeId ?? "",
      targetHandle: edge.to?.port ?? "",
      label,
      animated: Boolean(port?.type.timeSeries),
      className: found.length ? "edge-error" : undefined,
      data: { issues: found },
    };
  });
}
