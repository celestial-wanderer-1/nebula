import { create } from "@bufbuild/protobuf";
import { EntityKind } from "../gen/nebula/core/v1/entity_pb";
import {
  ExtensionKind,
  PortTypeSchema,
  type Extension,
  type PluginInfo,
  type PortDecl,
  type PortType,
} from "../gen/nebula/core/v1/plugin_pb";
import type { Node, Workflow } from "../gen/nebula/core/v1/workflow_pb";

// Port typing of the workflow graph (A§13.4, D55, D92). Pure, so the
// editor and the mock server's validation share it.

const STEP_KINDS: ReadonlyMap<
  ExtensionKind,
  "solver" | "adapter" | "postOp" | "objective"
> = new Map([
  [ExtensionKind.SOLVER, "solver"],
  [ExtensionKind.ADAPTER, "adapter"],
  [ExtensionKind.POST_OP, "postOp"],
  [ExtensionKind.OBJECTIVE, "objective"],
]);

/** The node kind an extension runs as, if it is a workflow extension. */
export function stepKindOf(extension: Extension) {
  return STEP_KINDS.get(extension.kind);
}

/** A port of a node as the graph sees it. */
export interface Port {
  name: string;
  type: PortType;
  optional: boolean;
  description: string;
}

export interface NodePorts {
  /** Data inputs, connected by edges. */
  inputs: Port[];
  /** Entity inputs, bound with a reference (D107). */
  bindings: Port[];
  outputs: Port[];
}

const NO_PORTS: NodePorts = { inputs: [], bindings: [], outputs: [] };

/** Every extension of every plugin, by ID. */
export function extensionIndex(
  plugins: readonly PluginInfo[],
): Map<string, Extension> {
  return new Map(
    plugins.flatMap((plugin) =>
      plugin.extensions.map((extension) => [extension.id, extension] as const),
    ),
  );
}

/** The extension step of a node, if it runs one. */
export function stepOf(node: Node) {
  switch (node.kind.case) {
    case "solver":
    case "adapter":
    case "postOp":
    case "objective":
      return node.kind.value;
    default:
      return undefined;
  }
}

/** Node kinds that group child nodes (D49, D92). */
export function isGroup(node: Node | undefined): boolean {
  return node?.kind.case === "coupled" || node?.kind.case === "fanOut";
}

const toPort = (decl: PortDecl): Port => ({
  name: decl.name,
  type: decl.type ?? create(PortTypeSchema),
  optional: decl.optional,
  description: decl.description,
});

const dataPort = (name: string, subContract: string, timeSeries: boolean) => ({
  name,
  type: create(PortTypeSchema, {
    type: { case: "subContract", value: subContract },
    timeSeries,
  }),
  optional: false,
  description: "",
});

/** Port names of stored-output and input-dataset nodes, whatever they hold. */
export const STORED_PORT = "output";
export const DATASET_PORT = "dataset";

/** Whether a node maps over time slices: inside a fan-out node (D92). */
export function inFanOut(workflow: Workflow, node: Node): boolean {
  const parent = workflow.nodes.find((n) => n.id === node.parentId);
  return parent?.kind.case === "fanOut";
}

/**
 * The ports of a node. An extension step's come from its manifest; a stored
 * output or input dataset has one output of its sub-contract. Inside a
 * fan-out, outputs become time series on the input's time base (D92).
 */
export function nodePorts(
  workflow: Workflow,
  node: Node,
  extensions: ReadonlyMap<string, Extension>,
): NodePorts {
  switch (node.kind.case) {
    case "storedOutput": {
      const { subContract, timeSeries } = node.kind.value;
      return {
        ...NO_PORTS,
        outputs: [dataPort(STORED_PORT, subContract, timeSeries)],
      };
    }
    case "inputDataset":
      return {
        ...NO_PORTS,
        outputs: [dataPort(DATASET_PORT, node.kind.value.subContract, false)],
      };
    case "coupled":
    case "fanOut":
    case undefined:
      return NO_PORTS;
  }
  const extension = extensions.get(stepOf(node)?.extensionId ?? "");
  if (!extension) return NO_PORTS;
  const inputs = extension.inputs.map(toPort);
  const mapped = inFanOut(workflow, node);
  return {
    inputs: inputs.filter((port) => port.type.type.case !== "entity"),
    bindings: inputs.filter((port) => port.type.type.case === "entity"),
    outputs: extension.outputs.map((decl) => {
      const port = toPort(decl);
      return mapped
        ? { ...port, type: { ...port.type, timeSeries: true } }
        : port;
    }),
  };
}

/** The entity kind a binding port takes. */
export function bindingKind(port: Port): EntityKind {
  return port.type.type.case === "entity"
    ? port.type.type.value
    : EntityKind.UNSPECIFIED;
}

export type Compatibility =
  | { ok: true }
  | { ok: false; code: "port_mismatch" | "time_series"; message: string };

/** "Equilibrium.Axisym2D", with "(time series)" when it is one. */
export function describeType(type: PortType): string {
  const base =
    type.type.case === "subContract"
      ? type.type.value
      : type.type.case === "entity"
        ? `${EntityKind[type.type.value]} reference`
        : "untyped";
  return type.timeSeries ? `${base} (time series)` : base;
}

/**
 * Whether an output can feed an input (D55, D92). Sub-contracts must match
 * exactly: a different representation needs an explicit adapter. A time
 * series feeds only a time-series input, or a step mapped over its slices
 * inside a fan-out.
 */
export function compatible(
  from: PortType,
  to: PortType,
  mappedOverSlices = false,
): Compatibility {
  const out = from.type.case === "subContract" ? from.type.value : "";
  const into = to.type.case === "subContract" ? to.type.value : "";
  if (!out || !into || out !== into) {
    return {
      ok: false,
      code: "port_mismatch",
      message: `${describeType(from)} does not match ${describeType(to)}`,
    };
  }
  if (from.timeSeries === to.timeSeries) return { ok: true };
  if (from.timeSeries && mappedOverSlices) return { ok: true };
  return {
    ok: false,
    code: "time_series",
    message: from.timeSeries
      ? `A time series needs a time-series input or a fan-out over its slices`
      : `${describeType(to)} needs a time series`,
  };
}

/**
 * Adapters that convert one sub-contract into another (D55): an adapter
 * extension whose input and output carry those sub-contracts.
 */
export function adaptersFor(
  from: PortType,
  to: PortType,
  extensions: Iterable<Extension>,
): Extension[] {
  const out = from.type.case === "subContract" ? from.type.value : "";
  const into = to.type.case === "subContract" ? to.type.value : "";
  if (!out || !into) return [];
  return [...extensions].filter(
    (extension) =>
      extension.kind === ExtensionKind.ADAPTER &&
      extension.inputs.some(
        (port) =>
          port.type?.type.case === "subContract" &&
          port.type.type.value === out,
      ) &&
      extension.outputs.some(
        (port) =>
          port.type?.type.case === "subContract" &&
          port.type.type.value === into,
      ),
  );
}

export type ConnectionCheck =
  | { status: "ok" }
  | { status: "adapter"; message: string; adapters: Extension[] }
  | { status: "blocked"; message: string };

/**
 * Whether an output may feed an input (D55, D92): the ports must exist on
 * two different nodes and their types match. A sub-contract mismatch that
 * an installed adapter converts is offered with the adapters.
 */
export function checkConnection(
  workflow: Workflow,
  extensions: ReadonlyMap<string, Extension>,
  from: { nodeId: string; port: string },
  to: { nodeId: string; port: string },
): ConnectionCheck {
  const source = workflow.nodes.find((n) => n.id === from.nodeId);
  const target = workflow.nodes.find((n) => n.id === to.nodeId);
  if (!source || !target) {
    return { status: "blocked", message: "No such node" };
  }
  if (source.id === target.id) {
    return { status: "blocked", message: "A node cannot feed itself" };
  }
  const out = nodePorts(workflow, source, extensions).outputs.find(
    (p) => p.name === from.port,
  );
  const into = nodePorts(workflow, target, extensions).inputs.find(
    (p) => p.name === to.port,
  );
  if (!out || !into) return { status: "blocked", message: "No such port" };
  const check = compatible(out.type, into.type, inFanOut(workflow, target));
  if (check.ok) return { status: "ok" };
  const adapters =
    check.code === "port_mismatch"
      ? adaptersFor(out.type, into.type, extensions.values())
      : [];
  return adapters.length
    ? { status: "adapter", message: check.message, adapters }
    : { status: "blocked", message: check.message };
}
