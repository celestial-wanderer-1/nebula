import { useParams } from "react-router";
import { packAs } from "../../entities/content";
import { EntityListPage } from "../../entities/EntityListPage";
import { newMessage } from "../../forms/defaults";
import { ConductorNetworkSchema } from "../../gen/nebula/core/v1/conductor_network_pb";
import { EntityKind } from "../../gen/nebula/core/v1/entity_pb";

const editorPath = (projectId: string, id: string) =>
  `/p/${encodeURIComponent(projectId)}/conductor-networks/${encodeURIComponent(id)}`;

/** The project's conductor networks (docs/UI.md 6.4). */
export function ConductorNetworkList() {
  const { projectId = "" } = useParams();
  return (
    <EntityListPage
      projectId={projectId}
      kind={EntityKind.CONDUCTOR_NETWORK}
      title="Conductor networks"
      plural="conductor networks"
      editorPath={(id) => editorPath(projectId, id)}
      newContent={() =>
        packAs(ConductorNetworkSchema, newMessage(ConductorNetworkSchema))
      }
      newDescription="Built on the circuits of a geometry you choose next."
    />
  );
}
