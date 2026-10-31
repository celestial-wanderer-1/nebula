import { create } from "@bufbuild/protobuf";
import type { Any } from "@bufbuild/protobuf/wkt";
import { ENTITY_LABELS } from "../entities/kinds";
import type { EntityRef } from "../gen/nebula/core/v1/entity_pb";
import type { Extension } from "../gen/nebula/core/v1/plugin_pb";
import {
  IssueSeverity,
  ValidationIssueSchema,
  type ValidationIssue,
} from "../gen/nebula/core/v1/project_pb";
import {
  EdgeSchema,
  InputBindingSchema,
  NodeLayoutSchema,
  NodeSchema,
  WorkflowSchema,
  type Edge,
  type Node,
  type PortRef,
  type Workflow,
} from "../gen/nebula/core/v1/workflow_pb";
import {
  bindingKind,
  compatible,
  inFanOut,
  isGroup,
  nodePorts,
  stepOf,
  type Port,
} from "./ports";

// Pure edits and structural checks of a workflow DAG (D50). Edits return
// a new Workflow; the editor saves it as the draft.

/** A node ID unused in the workflow: "<prefix>-<n>". */
export function newNodeId(workflow: Workflow, prefix: string): string {
  const used = new Set([
    ...workflow.nodes.map((n) => n.id),
    ...workflow.edges.map((e) => e.id),
  ]);
  for (let n = 1; ; n++) {
    const id = `${prefix}-${n}`;
    if (!used.has(id)) return id;
  }
}

export function addNode(workflow: Workflow, node: Node): Workflow {
  return { ...workflow, nodes: [...workflow.nodes, node] };
}

/** A node running an extension, of the kind its manifest declares. */
export function extensionNode(
  workflow: Workflow,
  extension: Extension,
  kind: "solver" | "adapter" | "postOp" | "objective",
  config: Any | undefined,
  position: { x: number; y: number },
): Node {
  return create(NodeSchema, {
    id: newNodeId(workflow, extension.id.split(".").pop() ?? "step"),
    label: extension.displayName,
    layout: position,
    kind: { case: kind, value: { extensionId: extension.id, config } },
  });
}

/** Removes a node, its children and every edge touching them. */
export function removeNode(workflow: Workflow, nodeId: string): Workflow {
  const removed = new Set([nodeId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of workflow.nodes) {
      if (!removed.has(node.id) && removed.has(node.parentId)) {
        removed.add(node.id);
        grew = true;
      }
    }
  }
  return {
    ...workflow,
    nodes: workflow.nodes.filter((node) => !removed.has(node.id)),
    edges: workflow.edges.filter(
      (edge) =>
        !removed.has(edge.from?.nodeId ?? "") &&
        !removed.has(edge.to?.nodeId ?? ""),
    ),
  };
}

/** Moves a node; inside a group, the position is relative to it. */
export function moveNode(
  workflow: Workflow,
  nodeId: string,
  position: { x: number; y: number },
): Workflow {
  return updateNode(workflow, nodeId, (node) => ({
    ...node,
    layout: create(NodeLayoutSchema, position),
  }));
}

export function updateNode(
  workflow: Workflow,
  nodeId: string,
  change: (node: Node) => Node,
): Workflow {
  return {
    ...workflow,
    nodes: workflow.nodes.map((node) =>
      node.id === nodeId ? change(node) : node,
    ),
  };
}

/** Sets or clears the reference bound to an entity port (D107). */
export function bindInput(
  workflow: Workflow,
  nodeId: string,
  port: string,
  ref: EntityRef | undefined,
): Workflow {
  return updateNode(workflow, nodeId, (node) => {
    const step = stepOf(node);
    if (!step) return node;
    const bindings = step.bindings.filter((b) => b.port !== port);
    const value = {
      ...step,
      bindings: ref
        ? [...bindings, create(InputBindingSchema, { port, ref })]
        : bindings,
    } as typeof step;
    return { ...node, kind: { ...node.kind, value } as Node["kind"] };
  });
}

/** Replaces a step's config message. */
export function setConfig(
  workflow: Workflow,
  nodeId: string,
  config: Any,
): Workflow {
  return updateNode(workflow, nodeId, (node) => {
    const step = stepOf(node);
    if (!step) return node;
    return {
      ...node,
      kind: { ...node.kind, value: { ...step, config } } as Node["kind"],
    };
  });
}

/**
 * Connects an output to an input. An input takes one edge, so an existing
 * edge into it is replaced.
 */
export function connect(
  workflow: Workflow,
  from: PortRef,
  to: PortRef,
): Workflow {
  const edges = workflow.edges.filter(
    (edge) => !(edge.to?.nodeId === to.nodeId && edge.to.port === to.port),
  );
  const edge = create(EdgeSchema, {
    id: newNodeId(workflow, "e"),
    from,
    to,
  });
  return { ...workflow, edges: [...edges, edge] };
}

export function disconnect(workflow: Workflow, edgeId: string): Workflow {
  return {
    ...workflow,
    edges: workflow.edges.filter((edge) => edge.id !== edgeId),
  };
}

/**
 * Inserts an adapter between an output and an input whose sub-contracts
 * differ (D55): a new adapter node and two edges.
 */
export function insertAdapter(
  workflow: Workflow,
  from: PortRef,
  to: PortRef,
  adapter: Extension,
  config: Any | undefined,
): Workflow {
  const source = workflow.nodes.find((n) => n.id === from.nodeId);
  const target = workflow.nodes.find((n) => n.id === to.nodeId);
  const at = (node: Node | undefined) => node?.layout ?? { x: 0, y: 0 };
  const node = extensionNode(workflow, adapter, "adapter", config, {
    x: (at(source).x + at(target).x) / 2,
    y: (at(source).y + at(target).y) / 2 + 80,
  });
  if (source?.parentId && source.parentId === target?.parentId) {
    node.parentId = source.parentId;
  }
  const input = adapter.inputs.find((p) => p.type?.type.case === "subContract");
  const output = adapter.outputs.find(
    (p) => p.type?.type.case === "subContract",
  );
  let next = addNode(workflow, node);
  next = connect(next, from, {
    ...to,
    nodeId: node.id,
    port: input?.name ?? "",
  });
  next = connect(
    next,
    { ...from, nodeId: node.id, port: output?.name ?? "" },
    to,
  );
  return next;
}

const issue = (
  severity: IssueSeverity,
  path: string,
  code: string,
  message: string,
): ValidationIssue =>
  create(ValidationIssueSchema, { severity, path, code, message });

const portPath = (nodeId: string, port: string) =>
  `nodes/${nodeId}/ports/${port}`;

/**
 * The coupled group a node iterates in, if any. Edges between members of
 * one coupled group may form cycles: the group iterates them to a fixed
 * point (D49).
 */
function coupledGroup(workflow: Workflow, node: Node | undefined) {
  const parent = workflow.nodes.find((n) => n.id === node?.parentId);
  return parent?.kind.case === "coupled" ? parent.id : undefined;
}

/** Edge IDs on a cycle that no coupled group iterates. */
export function cyclicEdges(workflow: Workflow): Set<string> {
  const byId = new Map(workflow.nodes.map((n) => [n.id, n]));
  const acyclic = workflow.edges.filter((edge) => {
    const a = coupledGroup(workflow, byId.get(edge.from?.nodeId ?? ""));
    const b = coupledGroup(workflow, byId.get(edge.to?.nodeId ?? ""));
    return !(a && a === b);
  });
  const next = new Map<string, Edge[]>();
  for (const edge of acyclic) {
    const from = edge.from?.nodeId ?? "";
    next.set(from, [...(next.get(from) ?? []), edge]);
  }
  const cyclic = new Set<string>();
  const state = new Map<string, "open" | "done">();
  const stack: Edge[] = [];
  const visit = (id: string) => {
    state.set(id, "open");
    for (const edge of next.get(id) ?? []) {
      const to = edge.to?.nodeId ?? "";
      stack.push(edge);
      if (state.get(to) === "open") {
        // Every edge on the stack from where the cycle re-enters.
        const start = stack.findIndex((e) => e.from?.nodeId === to);
        for (const e of stack.slice(start)) cyclic.add(e.id);
      } else if (!state.has(to)) {
        visit(to);
      }
      stack.pop();
    }
    state.set(id, "done");
  };
  for (const node of workflow.nodes) if (!state.has(node.id)) visit(node.id);
  return cyclic;
}

/**
 * Checks the editor can make on its own: every edge joins existing,
 * compatible ports (D55, D92), required inputs are fed or bound, no cycle
 * outside a coupled group (D49), extensions exist. Advisory in the browser;
 * the server repeats them with the checks that need more context.
 */
export function structuralIssues(
  workflow: Workflow,
  extensions: ReadonlyMap<string, Extension>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const byId = new Map(workflow.nodes.map((n) => [n.id, n]));
  const ports = new Map(
    workflow.nodes.map((n) => [n.id, nodePorts(workflow, n, extensions)]),
  );
  if (workflow.nodes.length === 0) {
    issues.push(
      issue(IssueSeverity.ERROR, "", "empty", "The workflow has no steps"),
    );
  }

  for (const node of workflow.nodes) {
    const step = stepOf(node);
    if (step && !extensions.has(step.extensionId)) {
      issues.push(
        issue(
          IssueSeverity.ERROR,
          `nodes/${node.id}`,
          "unknown_extension",
          `Extension ${step.extensionId} is not installed`,
        ),
      );
    }
    if (node.parentId && !isGroup(byId.get(node.parentId))) {
      issues.push(
        issue(
          IssueSeverity.ERROR,
          `nodes/${node.id}`,
          "invalid_parent",
          `Parent ${node.parentId} is not a coupled or fan-out node`,
        ),
      );
    }
    if (node.kind.case === "storedOutput" && !node.kind.value.contentHash) {
      issues.push(
        issue(
          IssueSeverity.ERROR,
          `nodes/${node.id}`,
          "missing_input",
          "Choose a run output",
        ),
      );
    }
    if (node.kind.case === "inputDataset" && !node.kind.value.versionHash) {
      issues.push(
        issue(
          IssueSeverity.ERROR,
          `nodes/${node.id}`,
          "missing_input",
          "Choose an input dataset",
        ),
      );
    }
    const own = ports.get(node.id);
    const fed = (port: Port) =>
      workflow.edges.some(
        (e) => e.to?.nodeId === node.id && e.to.port === port.name,
      );
    for (const port of own?.inputs ?? []) {
      if (!port.optional && !fed(port)) {
        issues.push(
          issue(
            IssueSeverity.ERROR,
            portPath(node.id, port.name),
            "missing_input",
            `Input “${port.name}” is not connected`,
          ),
        );
      }
    }
    for (const port of own?.bindings ?? []) {
      const bound = step?.bindings.find((b) => b.port === port.name)?.ref?.id;
      if (!port.optional && !bound) {
        issues.push(
          issue(
            IssueSeverity.ERROR,
            portPath(node.id, port.name),
            "missing_input",
            `No ${ENTITY_LABELS[bindingKind(port)].toLowerCase()} bound to “${port.name}”`,
          ),
        );
      }
    }
  }

  for (const edge of workflow.edges) {
    const path = `edges/${edge.id}`;
    const fromNode = byId.get(edge.from?.nodeId ?? "");
    const toNode = byId.get(edge.to?.nodeId ?? "");
    const from = ports
      .get(fromNode?.id ?? "")
      ?.outputs.find((p) => p.name === edge.from?.port);
    const to = ports
      .get(toNode?.id ?? "")
      ?.inputs.find((p) => p.name === edge.to?.port);
    if (!fromNode || !toNode || !from || !to) {
      issues.push(
        issue(
          IssueSeverity.ERROR,
          path,
          "unknown_port",
          "The edge joins a port that does not exist",
        ),
      );
      continue;
    }
    const check = compatible(from.type, to.type, inFanOut(workflow, toNode));
    if (!check.ok) {
      issues.push(issue(IssueSeverity.ERROR, path, check.code, check.message));
    }
  }

  for (const id of cyclicEdges(workflow)) {
    issues.push(
      issue(
        IssueSeverity.ERROR,
        `edges/${id}`,
        "cycle",
        "The edge closes a cycle; iterate steps inside a coupled node",
      ),
    );
  }
  return issues;
}

/** An empty workflow, for new drafts. */
export const emptyWorkflow = () => create(WorkflowSchema);
