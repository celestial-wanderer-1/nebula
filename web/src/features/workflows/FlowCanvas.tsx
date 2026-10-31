import "@xyflow/react/dist/style.css";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  type Connection,
  type Edge as RfEdge,
  type Node as RfNode,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import type { Extension } from "../../gen/nebula/core/v1/plugin_pb";
import type { PortRef } from "../../gen/nebula/core/v1/workflow_pb";
import type { Workflow } from "../../gen/nebula/core/v1/workflow_pb";
import {
  toCanvasEdges,
  toCanvasNodes,
  type CanvasNodeData,
} from "../../workflow/flow";
import type { IssueIndex } from "../../workflow/issues";
import { describeType, type Port } from "../../workflow/ports";

// The workflow canvas (docs/UI.md 6.5): React Flow with a custom node per
// kind and a handle per typed port. Loaded lazily, so React Flow is its own
// chunk. Every edit is reported up; the workflow draft is the state.

export interface FlowCanvasProps {
  workflow: Workflow;
  extensions: ReadonlyMap<string, Extension>;
  issues: IssueIndex;
  selectedId?: string;
  onSelect: (nodeId: string | undefined) => void;
  /** A connection attempt; the editor checks types and offers adapters. */
  onConnect: (from: PortRef, to: PortRef) => void;
  /** Whether a connection may be attempted (React Flow greys others out). */
  canConnect: (from: PortRef, to: PortRef) => boolean;
  onMove: (nodeId: string, position: { x: number; y: number }) => void;
  onDisconnect: (edgeIds: string[]) => void;
}

type StepFlowNode = RfNode<CanvasNodeData, "step" | "group">;

const portRef = (nodeId: string | null, port: string | null | undefined) =>
  ({ nodeId: nodeId ?? "", port: port ?? "" }) as PortRef;

function PortHandle({
  port,
  kind,
  invalid,
}: {
  port: Port;
  kind: "target" | "source";
  invalid: boolean;
}) {
  const type = describeType(port.type);
  return (
    <div className={`port port-${kind}${invalid ? " port-error" : ""}`}>
      <Handle
        type={kind}
        id={port.name}
        position={kind === "target" ? Position.Left : Position.Right}
        aria-label={`${kind === "target" ? "Input" : "Output"} ${port.name}: ${type}`}
        title={type}
      />
      <span className="port-name">{port.name}</span>
      <span className="port-type">{type}</span>
    </div>
  );
}

function StepNode({ data, selected }: NodeProps<StepFlowNode>) {
  const { node, ports, kindLabel, issues, portIssues } = data;
  const errors = issues.length;
  return (
    <div
      className={`flow-node${selected ? " selected" : ""}${errors ? " has-issues" : ""}`}
      data-kind={node.kind.case}
    >
      <div className="flow-node-header">
        <span className="flow-node-kind">{kindLabel}</span>
        <strong>{node.label || node.id}</strong>
        {errors > 0 && (
          <span
            className="badge badge-error"
            title={issues.map((i) => i.message).join("\n")}
          >
            {errors} {errors === 1 ? "issue" : "issues"}
          </span>
        )}
      </div>
      {ports.bindings.length > 0 && (
        <ul className="flow-node-bindings">
          {ports.bindings.map((port) => (
            <li
              key={port.name}
              className={portIssues.has(port.name) ? "port-error" : undefined}
            >
              {port.name}
            </li>
          ))}
        </ul>
      )}
      <div className="flow-node-ports">
        <div>
          {ports.inputs.map((port) => (
            <PortHandle
              key={port.name}
              port={port}
              kind="target"
              invalid={portIssues.has(port.name)}
            />
          ))}
        </div>
        <div>
          {ports.outputs.map((port) => (
            <PortHandle
              key={port.name}
              port={port}
              kind="source"
              invalid={false}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function GroupNode({ data, selected }: NodeProps<StepFlowNode>) {
  const { node, kindLabel, issues } = data;
  return (
    <div
      className={`flow-group${selected ? " selected" : ""}${issues.length ? " has-issues" : ""}`}
      data-kind={node.kind.case}
    >
      <span className="flow-node-kind">{kindLabel}</span>{" "}
      <strong>{node.label || node.id}</strong>
    </div>
  );
}

const nodeTypes = { step: StepNode, group: GroupNode };

function Canvas({
  workflow,
  extensions,
  issues,
  selectedId,
  onSelect,
  onConnect,
  canConnect,
  onMove,
  onDisconnect,
}: FlowCanvasProps) {
  const derived = useMemo(
    () =>
      toCanvasNodes(workflow, extensions, issues, selectedId) as StepFlowNode[],
    [workflow, extensions, issues, selectedId],
  );
  const edges = useMemo(
    () => toCanvasEdges(workflow, extensions, issues) as RfEdge[],
    [workflow, extensions, issues],
  );
  // Positions move locally while dragging; the draft gets the drop only.
  const [nodes, setNodes] = useState(derived);
  useEffect(() => setNodes(derived), [derived]);

  return (
    <div
      className="flow-canvas"
      data-testid="flow-canvas"
      data-nodes={workflow.nodes.length}
      data-edges={workflow.edges.length}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={(changes: NodeChange<StepFlowNode>[]) =>
          setNodes((held) => applyNodeChanges(changes, held))
        }
        onNodeDragStop={(_, node) => onMove(node.id, node.position)}
        onNodeClick={(_, node) => onSelect(node.id)}
        onPaneClick={() => onSelect(undefined)}
        onConnect={(connection: Connection) =>
          onConnect(
            portRef(connection.source, connection.sourceHandle),
            portRef(connection.target, connection.targetHandle),
          )
        }
        isValidConnection={(connection) =>
          canConnect(
            portRef(connection.source, connection.sourceHandle),
            portRef(connection.target, connection.targetHandle),
          )
        }
        onEdgesDelete={(deleted) => onDisconnect(deleted.map((e) => e.id))}
        nodesConnectable
        elementsSelectable
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
        ariaLabelConfig={{
          "node.a11yDescription.default":
            "Press Enter to select this node; Delete removes selected edges.",
        }}
      >
        <Background gap={24} color="#2c3f54" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
