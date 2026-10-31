import { anyPack, anyUnpack, type Any } from "@bufbuild/protobuf/wkt";
import { useId } from "react";
import { typeNameOf } from "../../entities/content";
import { ReferencePicker } from "../../entities/ReferencePicker";
import { ConfigForm } from "../../forms/ConfigForm";
import { newMessage } from "../../forms/defaults";
import type { Extension } from "../../gen/nebula/core/v1/plugin_pb";
import {
  IssueSeverity,
  type ValidationIssue,
} from "../../gen/nebula/core/v1/project_pb";
import {
  CoupledNodeSchema,
  FanOutNodeSchema,
  type Node,
  type PortRef,
  type Workflow,
} from "../../gen/nebula/core/v1/workflow_pb";
import { useSchema } from "../../schema/context";
import { KIND_LABELS } from "../../workflow/flow";
import {
  bindInput,
  disconnect,
  moveNode,
  setConfig,
  updateNode,
} from "../../workflow/graph";
import type { IssueIndex } from "../../workflow/issues";
import {
  bindingKind,
  checkConnection,
  describeType,
  isGroup,
  nodePorts,
  stepOf,
} from "../../workflow/ports";
import { InputDatasetPicker } from "./InputDatasetPicker";
import { StoredOutputPicker } from "./StoredOutputPicker";

/** Issues on a node or one of its ports. */
export function NodeIssues({
  issues,
  label,
}: {
  issues: readonly ValidationIssue[];
  label: string;
}) {
  if (issues.length === 0) return null;
  return (
    <ul className="issues" aria-label={label}>
      {issues.map((issue, index) => (
        <li
          key={index}
          className={
            issue.severity === IssueSeverity.WARNING
              ? "issue issue-warning"
              : "issue issue-error"
          }
        >
          <strong>
            {issue.severity === IssueSeverity.WARNING ? "Warning" : "Error"}
          </strong>
          <span>{issue.message}</span>
        </li>
      ))}
    </ul>
  );
}

/** A step's config form from its extension's config message (D87). */
function StepConfig({
  projectId,
  extension,
  config,
  onChange,
}: {
  projectId: string;
  extension: Extension | undefined;
  config: Any | undefined;
  onChange: (config: Any) => void;
}) {
  const schema = useSchema();
  const typeName = extension?.configMessage || typeNameOf(config);
  if (!typeName) {
    return <p className="muted small">This step has no settings.</p>;
  }
  const desc = schema.getMessage(typeName);
  if (!desc) {
    return (
      <p className="field-warning" role="status">
        Settings of type {typeName} cannot be edited: the plugin that defines
        them is not loaded.
      </p>
    );
  }
  const value =
    (config && typeNameOf(config) === typeName && anyUnpack(config, desc)) ||
    undefined;
  return (
    <ConfigForm
      schema={desc}
      value={value ?? newMessage(desc)}
      projectId={projectId}
      onChange={(next) => onChange(anyPack(desc, next))}
    />
  );
}

/**
 * The side panel of the selected node (docs/UI.md 6.5): its generated config
 * form, a reference picker per entity input (D107), its data inputs with a
 * keyboard way to connect them, and the pickers of stored outputs and input
 * datasets.
 */
export function NodePanel({
  projectId,
  workflow,
  node,
  extensions,
  issues,
  onChange,
  onConnect,
  onRemove,
}: {
  projectId: string;
  workflow: Workflow;
  node: Node;
  extensions: ReadonlyMap<string, Extension>;
  issues: IssueIndex;
  onChange: (workflow: Workflow) => void;
  onConnect: (from: PortRef, to: PortRef) => void;
  onRemove: () => void;
}) {
  const ids = useId();
  const step = stepOf(node);
  const extension = step ? extensions.get(step.extensionId) : undefined;
  const ports = nodePorts(workflow, node, extensions);
  const portIssues = (port: string) =>
    issues.ports.get(`${node.id}/${port}`) ?? [];
  const nodeIssues = (issues.nodes.get(node.id) ?? []).filter(
    (issue) => !issue.path.includes("/ports/"),
  );
  const change = (next: (node: Node) => Node) =>
    onChange(updateNode(workflow, node.id, next));
  const label = (n: Node) => n.label || n.id;

  // Groups this node may sit in: none of its own descendants.
  const descendants = new Set([node.id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const n of workflow.nodes) {
      if (!descendants.has(n.id) && descendants.has(n.parentId)) {
        descendants.add(n.id);
        grew = true;
      }
    }
  }
  const groups = workflow.nodes.filter(
    (n) => isGroup(n) && !descendants.has(n.id),
  );

  // Every output of another node, for the keyboard connect form.
  const sources = workflow.nodes
    .filter((n) => n.id !== node.id)
    .flatMap((n) =>
      nodePorts(workflow, n, extensions).outputs.map((port) => ({
        node: n,
        port,
      })),
    );

  return (
    <section className="node-panel" aria-label={`Node ${label(node)}`}>
      <div className="node-panel-header">
        <span className="flow-node-kind">
          {KIND_LABELS[node.kind.case ?? "solver"]}
        </span>
        <button type="button" className="danger" onClick={onRemove}>
          Remove node
        </button>
      </div>
      <div className="field">
        <label htmlFor={`${ids}-label`}>Node label</label>
        <input
          id={`${ids}-label`}
          value={node.label}
          onChange={(event) =>
            change((n) => ({ ...n, label: event.target.value }))
          }
        />
      </div>
      {step && (
        <p className="muted small">
          {extension ? (
            <>
              {extension.displayName} · <code>{extension.id}</code>
            </>
          ) : (
            <>
              Extension <code>{step.extensionId}</code> is not installed.
            </>
          )}
        </p>
      )}
      <NodeIssues issues={nodeIssues} label="Node issues" />

      {groups.length > 0 && !isGroup(node) && (
        <div className="field">
          <label htmlFor={`${ids}-parent`}>Inside</label>
          <select
            id={`${ids}-parent`}
            value={node.parentId}
            onChange={(event) =>
              onChange(
                // Positions inside a group are relative to it.
                moveNode(
                  updateNode(workflow, node.id, (n) => ({
                    ...n,
                    parentId: event.target.value,
                  })),
                  node.id,
                  event.target.value ? { x: 40, y: 60 } : { x: 0, y: 320 },
                ),
              )
            }
          >
            <option value="">Top level</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {label(group)} ({KIND_LABELS[group.kind.case ?? "coupled"]})
              </option>
            ))}
          </select>
        </div>
      )}

      {ports.bindings.length > 0 && (
        <section aria-label="Entity inputs">
          <h3>Entity inputs</h3>
          {ports.bindings.map((port) => {
            const kind = bindingKind(port);
            const ref = step?.bindings.find((b) => b.port === port.name)?.ref;
            return (
              <div key={port.name} className="binding">
                <ReferencePicker
                  projectId={projectId}
                  kind={kind}
                  value={ref}
                  label={`${port.name}${port.optional ? " (optional)" : ""}`}
                  onChange={(next) =>
                    onChange(bindInput(workflow, node.id, port.name, next))
                  }
                />
                {ref && (
                  <button
                    type="button"
                    className="link"
                    onClick={() =>
                      onChange(
                        bindInput(workflow, node.id, port.name, undefined),
                      )
                    }
                  >
                    Unbind {port.name}
                  </button>
                )}
                <NodeIssues
                  issues={portIssues(port.name)}
                  label={`Issues of ${port.name}`}
                />
              </div>
            );
          })}
        </section>
      )}

      {ports.inputs.length > 0 && (
        <section aria-label="Data inputs">
          <h3>Data inputs</h3>
          <ul className="port-list">
            {ports.inputs.map((port) => {
              const edge = workflow.edges.find(
                (e) => e.to?.nodeId === node.id && e.to.port === port.name,
              );
              const from = workflow.nodes.find(
                (n) => n.id === edge?.from?.nodeId,
              );
              const selectId = `${ids}-in-${port.name}`;
              return (
                <li key={port.name}>
                  <div>
                    <strong>{port.name}</strong>{" "}
                    <span className="muted">{describeType(port.type)}</span>
                    {port.optional && (
                      <span className="muted"> (optional)</span>
                    )}
                  </div>
                  {edge && from ? (
                    <div>
                      From {label(from)} · {edge.from?.port}{" "}
                      <button
                        type="button"
                        className="link"
                        onClick={() => onChange(disconnect(workflow, edge.id))}
                      >
                        Disconnect {port.name}
                      </button>
                    </div>
                  ) : (
                    <div className="field">
                      <label htmlFor={selectId}>Connect {port.name} from</label>
                      <select
                        id={selectId}
                        value=""
                        onChange={(event) => {
                          const [nodeId = "", name = ""] =
                            event.target.value.split("\u0000");
                          onConnect(
                            { nodeId, port: name } as PortRef,
                            { nodeId: node.id, port: port.name } as PortRef,
                          );
                        }}
                      >
                        <option value="" disabled>
                          Choose an output…
                        </option>
                        {sources.map(({ node: source, port: out }) => {
                          const check = checkConnection(
                            workflow,
                            extensions,
                            { nodeId: source.id, port: out.name },
                            { nodeId: node.id, port: port.name },
                          );
                          return (
                            <option
                              key={`${source.id}/${out.name}`}
                              value={`${source.id}\u0000${out.name}`}
                              disabled={check.status === "blocked"}
                            >
                              {label(source)} · {out.name} (
                              {describeType(out.type)})
                              {check.status === "adapter"
                                ? " — needs an adapter"
                                : check.status === "blocked"
                                  ? " — incompatible"
                                  : ""}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  )}
                  <NodeIssues
                    issues={portIssues(port.name)}
                    label={`Issues of ${port.name}`}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {ports.outputs.length > 0 && (
        <section aria-label="Outputs">
          <h3>Outputs</h3>
          <ul className="port-list">
            {ports.outputs.map((port) => (
              <li key={port.name}>
                <strong>{port.name}</strong>{" "}
                <span className="muted">{describeType(port.type)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {step && (
        <section aria-label="Settings">
          <h3>Settings</h3>
          <StepConfig
            projectId={projectId}
            extension={extension}
            config={step.config}
            onChange={(config) =>
              onChange(setConfig(workflow, node.id, config))
            }
          />
        </section>
      )}
      {node.kind.case === "storedOutput" && (
        <StoredOutputPicker
          projectId={projectId}
          value={node.kind.value}
          onChange={(value) =>
            change((n) => ({ ...n, kind: { case: "storedOutput", value } }))
          }
        />
      )}
      {node.kind.case === "inputDataset" && (
        <InputDatasetPicker
          projectId={projectId}
          value={node.kind.value}
          onChange={(value) =>
            change((n) => ({ ...n, kind: { case: "inputDataset", value } }))
          }
        />
      )}
      {node.kind.case === "coupled" && (
        <ConfigForm
          schema={CoupledNodeSchema}
          value={node.kind.value}
          onChange={(value) =>
            change((n) => ({ ...n, kind: { case: "coupled", value } }))
          }
        />
      )}
      {node.kind.case === "fanOut" && (
        <ConfigForm
          schema={FanOutNodeSchema}
          value={node.kind.value}
          onChange={(value) =>
            change((n) => ({ ...n, kind: { case: "fanOut", value } }))
          }
        />
      )}
    </section>
  );
}
