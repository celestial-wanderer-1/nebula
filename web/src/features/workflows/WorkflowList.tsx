import { useState } from "react";
import { useParams } from "react-router";
import { packAs } from "../../entities/content";
import { EntityListPage } from "../../entities/EntityListPage";
import { EntityKind } from "../../gen/nebula/core/v1/entity_pb";
import { WorkflowSchema } from "../../gen/nebula/core/v1/workflow_pb";
import { emptyWorkflow } from "../../workflow/graph";
import { TemplateDialog } from "./TemplateDialog";

const editorPath = (projectId: string, id: string) =>
  `/p/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(id)}`;

/** The project's workflows (docs/UI.md 6.5): empty or from a template. */
export function WorkflowList() {
  const { projectId = "" } = useParams();
  const [fromTemplate, setFromTemplate] = useState(false);
  return (
    <>
      <EntityListPage
        projectId={projectId}
        kind={EntityKind.WORKFLOW}
        title="Workflows"
        plural="workflows"
        editorPath={(id) => editorPath(projectId, id)}
        newContent={() => packAs(WorkflowSchema, emptyWorkflow())}
        newDescription="Starts empty; add steps from the palette."
        actions={
          <button type="button" onClick={() => setFromTemplate(true)}>
            From template
          </button>
        }
      />
      <TemplateDialog
        projectId={projectId}
        open={fromTemplate}
        onOpenChange={setFromTemplate}
        editorPath={(id) => editorPath(projectId, id)}
      />
    </>
  );
}
