import { create } from "@bufbuild/protobuf";
import { anyPack, type Any } from "@bufbuild/protobuf/wkt";
import { useId, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { NotFoundError } from "../../api/errors";
import { usePlugins } from "../../api/plugins";
import { useValidateWorkflow } from "../../api/workflows";
import { packAs, unpackAs } from "../../entities/content";
import { DraftEditorHeader } from "../../entities/DraftEditorHeader";
import { useDraft } from "../../entities/useDraft";
import { VersionList } from "../../entities/VersionList";
import { newMessage } from "../../forms/defaults";
import { EntityKind } from "../../gen/nebula/core/v1/entity_pb";
import type { Extension } from "../../gen/nebula/core/v1/plugin_pb";
import { IssueSeverity } from "../../gen/nebula/core/v1/project_pb";
import {
  CoupledNodeSchema,
  NodeSchema,
  WorkflowSchema,
  type PortRef,
  type Workflow,
} from "../../gen/nebula/core/v1/workflow_pb";
import { useSchema } from "../../schema/context";
import { lazyView } from "../../viewers/lazy";
import { KIND_LABELS } from "../../workflow/flow";
import {
  addNode,
  connect,
  disconnect,
  extensionNode,
  insertAdapter,
  moveNode,
  newNodeId,
  removeNode,
} from "../../workflow/graph";
import { indexIssues } from "../../workflow/issues";
import {
  checkConnection,
  extensionIndex,
  stepKindOf,
} from "../../workflow/ports";
import { AdapterOffer } from "./AdapterOffer";
import type { FlowCanvasProps } from "./FlowCanvas";
import { NodeIssues, NodePanel } from "./NodePanel";
import { Palette, type CoreKind } from "./Palette";
import { useSelectedNode, useWorkflowView } from "./store";

const CanvasSlot = lazyView<FlowCanvasProps>(
  () => import("./FlowCanvas").then((module) => module.FlowCanvas),
  {
    loading: "Loading the graph editor…",
    unavailable:
      "Graph view unavailable: the editor could not be loaded. Nodes can still be edited in the side panel.",
    className: "flow-canvas",
  },
);

const NO_ISSUES = indexIssues([]);

/** Where a new top-level node goes: right of the rightmost one. */
function nextPosition(workflow: Workflow) {
  const top = workflow.nodes.filter((n) => !n.parentId);
  if (top.length === 0) return { x: 0, y: 80 };
  return {
    x: Math.max(...top.map((n) => n.layout?.x ?? 0)) + 300,
    y: 80,
  };
}

/**
 * The workflow editor (docs/UI.md 6.5): palette | React Flow canvas | node
 * panel. Ports are typed by sub-contract; a mismatch is blocked or offered
 * an adapter (D55). "Validate" asks the server about the saved draft (D64,
 * D113, D114, D116); its issues show on nodes, ports and edges.
 */
export function WorkflowEditor() {
  const { projectId = "", workflowId = "" } = useParams();
  return (
    <Editor
      key={`${projectId}/${workflowId}`}
      projectId={projectId}
      workflowId={workflowId}
    />
  );
}

function Editor({
  projectId,
  workflowId,
}: {
  projectId: string;
  workflowId: string;
}) {
  const ids = useId();
  const schema = useSchema();
  const draft = useDraft(projectId, EntityKind.WORKFLOW, workflowId);
  const plugins = usePlugins();
  const extensions = useMemo(
    () => extensionIndex(plugins.data ?? []),
    [plugins.data],
  );
  const workflow = useMemo(
    () => unpackAs(WorkflowSchema, draft.content),
    [draft.content],
  );
  const selectedId = useSelectedNode(workflowId);
  const select = useWorkflowView((state) => state.select);
  const validate = useValidateWorkflow(projectId, workflowId);
  const [validated, setValidated] = useState<number>();
  const [offer, setOffer] = useState<{
    from: PortRef;
    to: PortRef;
    message: string;
    adapters: Extension[];
  }>();
  const [notice, setNotice] = useState<string>();
  const [versionsOpen, setVersionsOpen] = useState(false);

  const issueList = validate.data?.issues;
  const issues = useMemo(
    () => (issueList ? indexIssues(issueList) : NO_ISSUES),
    [issueList],
  );

  if (!draft.draft) {
    if (draft.error instanceof NotFoundError) {
      return (
        <section className="placeholder">
          <h1>Workflow not found</h1>
          <p>
            <Link to=".." relative="path">
              Back to workflows
            </Link>
          </p>
        </section>
      );
    }
    return draft.error ? (
      <p className="field-error" role="alert">
        {draft.error.message}
      </p>
    ) : (
      <p className="muted">Loading workflow…</p>
    );
  }

  const update = (next: Workflow) => {
    setNotice(undefined);
    draft.setContent(packAs(WorkflowSchema, next));
  };
  const defaultConfig = (extension: Extension): Any | undefined => {
    const desc = extension.configMessage
      ? schema.getMessage(extension.configMessage)
      : undefined;
    return desc ? anyPack(desc, newMessage(desc)) : undefined;
  };
  const selected = workflow.nodes.find((n) => n.id === selectedId);

  const addExtension = (extension: Extension) => {
    const kind = stepKindOf(extension);
    if (!kind) return;
    const node = extensionNode(
      workflow,
      extension,
      kind,
      defaultConfig(extension),
      nextPosition(workflow),
    );
    update(addNode(workflow, node));
    select(workflowId, node.id);
  };
  const addCore = (kind: CoreKind) => {
    const node = create(NodeSchema, {
      id: newNodeId(
        workflow,
        kind.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`),
      ),
      label: KIND_LABELS[kind],
      layout: nextPosition(workflow),
      kind:
        kind === "coupled"
          ? {
              case: kind,
              value: create(CoupledNodeSchema, {
                convergence: { tolerance: 1e-6, maxIterations: 50 },
              }),
            }
          : { case: kind, value: {} },
    });
    update(addNode(workflow, node));
    select(workflowId, node.id);
  };
  const attempt = (from: PortRef, to: PortRef) => {
    const check = checkConnection(workflow, extensions, from, to);
    if (check.status === "ok") {
      update(connect(workflow, from, to));
    } else if (check.status === "adapter") {
      setOffer({ from, to, message: check.message, adapters: check.adapters });
    } else {
      setNotice(`Not connected: ${check.message}.`);
    }
  };

  const stale = validated !== undefined && draft.draft.revision !== validated;
  const unsaved = draft.status !== "saved";
  const errors =
    issueList?.filter((i) => i.severity !== IssueSeverity.WARNING).length ?? 0;
  const nodeName = (id: string) => {
    const node = workflow.nodes.find((n) => n.id === id);
    return node?.label || id;
  };

  return (
    <section className="editor-page workflow-page">
      <div className="page-header">
        <h1>{draft.name || workflowId}</h1>
        <div className="actions">
          <button
            type="button"
            aria-expanded={versionsOpen}
            aria-controls={`${ids}-versions`}
            onClick={() => setVersionsOpen((open) => !open)}
          >
            Versions
          </button>
          <button
            type="button"
            className="primary"
            disabled={unsaved || validate.isPending}
            aria-describedby={unsaved ? `${ids}-validate-wait` : undefined}
            onClick={() => {
              const revision = draft.draft?.revision;
              validate.mutate(0, { onSuccess: () => setValidated(revision) });
            }}
          >
            Validate
          </button>
        </div>
      </div>
      {unsaved && (
        <p id={`${ids}-validate-wait`} className="muted small">
          Validation checks the saved draft; it waits until your edits are
          saved.
        </p>
      )}
      <DraftEditorHeader draft={draft} label="Workflow name" />
      {versionsOpen && (
        <div id={`${ids}-versions`} className="panel">
          <VersionList
            projectId={projectId}
            kind={EntityKind.WORKFLOW}
            id={workflowId}
            draft={draft.draft}
          />
        </div>
      )}
      {notice && (
        <p className="field-error" role="alert">
          {notice}
        </p>
      )}
      {validate.error && (
        <p className="field-error" role="alert">
          Validation failed: {validate.error.message}
        </p>
      )}
      {issueList && (
        <section className="validation" aria-label="Validation">
          <p role="status" className={errors ? "field-error" : "ok"}>
            {errors === 0
              ? "No issues: the server accepts this workflow."
              : `${errors} ${errors === 1 ? "issue" : "issues"} to fix before a run.`}
            {stale && " (The workflow changed since; validate again.)"}
          </p>
          <NodeIssues issues={issues.general} label="Workflow issues" />
          {issueList.length > issues.general.length && (
            <ul className="issue-nodes">
              {[...issues.nodes.keys(), ...issues.edges.keys()].map((id) => (
                <li key={id}>
                  {workflow.nodes.some((n) => n.id === id) ? (
                    <button
                      type="button"
                      className="link"
                      onClick={() => select(workflowId, id)}
                    >
                      {nodeName(id)}
                    </button>
                  ) : (
                    <span>Edge {id}</span>
                  )}
                  :{" "}
                  {(issues.nodes.get(id) ?? issues.edges.get(id) ?? [])
                    .map((i) => i.message)
                    .join("; ")}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="workflow-editor">
        <Palette
          extensions={[...extensions.values()]}
          onAddExtension={addExtension}
          onAddCore={addCore}
        />
        <section className="workflow-canvas-pane" aria-label="Graph">
          <CanvasSlot
            workflow={workflow}
            extensions={extensions}
            issues={issues}
            selectedId={selectedId}
            onSelect={(id) => select(workflowId, id)}
            onConnect={attempt}
            canConnect={(from, to) =>
              checkConnection(workflow, extensions, from, to).status !==
              "blocked"
            }
            onMove={(id, position) => update(moveNode(workflow, id, position))}
            onDisconnect={(edgeIds) =>
              update(edgeIds.reduce(disconnect, workflow))
            }
          />
        </section>
        <aside className="workflow-side" aria-label="Node">
          {selected ? (
            <NodePanel
              projectId={projectId}
              workflow={workflow}
              node={selected}
              extensions={extensions}
              issues={issues}
              onChange={update}
              onConnect={attempt}
              onRemove={() => {
                update(removeNode(workflow, selected.id));
                select(workflowId, undefined);
              }}
            />
          ) : (
            <NodeList
              workflow={workflow}
              onSelect={(id) => select(workflowId, id)}
            />
          )}
        </aside>
      </div>

      <AdapterOffer
        offer={offer}
        onCancel={() => setOffer(undefined)}
        onInsert={(adapter) => {
          if (!offer) return;
          update(
            insertAdapter(
              workflow,
              offer.from,
              offer.to,
              adapter,
              defaultConfig(adapter),
            ),
          );
          setOffer(undefined);
        }}
      />
    </section>
  );
}

/** The nodes, for selecting one by keyboard. */
function NodeList({
  workflow,
  onSelect,
}: {
  workflow: Workflow;
  onSelect: (id: string) => void;
}) {
  return (
    <section aria-label="Nodes">
      <h2>Nodes</h2>
      {workflow.nodes.length === 0 ? (
        <p className="muted small">
          Empty. Add a step from the palette; a single calculation is a one-node
          graph.
        </p>
      ) : (
        <ul className="node-list">
          {workflow.nodes.map((node) => (
            <li key={node.id}>
              <button
                type="button"
                className="link"
                onClick={() => onSelect(node.id)}
              >
                {node.label || node.id}
              </button>{" "}
              <span className="muted small">
                {KIND_LABELS[node.kind.case ?? "solver"]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
