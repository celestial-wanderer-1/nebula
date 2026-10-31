import { useParams } from "react-router";
import { packAs } from "../../entities/content";
import { EntityListPage } from "../../entities/EntityListPage";
import { newMessage } from "../../forms/defaults";
import { EntityKind } from "../../gen/nebula/core/v1/entity_pb";
import { ScenarioSchema } from "../../gen/nebula/core/v1/scenario_pb";

const editorPath = (projectId: string, id: string) =>
  `/p/${encodeURIComponent(projectId)}/scenarios/${encodeURIComponent(id)}`;

/** The project's scenarios (docs/UI.md 6.4). */
export function ScenarioList() {
  const { projectId = "" } = useParams();
  return (
    <EntityListPage
      projectId={projectId}
      kind={EntityKind.SCENARIO}
      title="Scenarios"
      plural="scenarios"
      editorPath={(id) => editorPath(projectId, id)}
      newContent={() => packAs(ScenarioSchema, newMessage(ScenarioSchema))}
      newDescription="Choose the geometry whose circuits carry its currents next."
    />
  );
}
