import { useParams } from "react-router";
import { packAs } from "../../entities/content";
import { EntityListPage } from "../../entities/EntityListPage";
import { newMessage } from "../../forms/defaults";
import { EntityKind } from "../../gen/nebula/core/v1/entity_pb";
import { RegionSchema } from "../../gen/nebula/core/v1/region_pb";

const editorPath = (projectId: string, id: string) =>
  `/p/${encodeURIComponent(projectId)}/regions/${encodeURIComponent(id)}`;

/** The project's regions (docs/UI.md 6.4). */
export function RegionList() {
  const { projectId = "" } = useParams();
  return (
    <EntityListPage
      projectId={projectId}
      kind={EntityKind.REGION}
      title="Regions"
      plural="regions"
      editorPath={(id) => editorPath(projectId, id)}
      newContent={() => packAs(RegionSchema, newMessage(RegionSchema))}
      newDescription="Choose its type and the geometry to place it over next."
    />
  );
}
