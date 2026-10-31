import { create } from "@bufbuild/protobuf";
import { useParams } from "react-router";
import { packGeometry } from "../../entities/content";
import { EntityListPage } from "../../entities/EntityListPage";
import { EntityKind } from "../../gen/nebula/core/v1/entity_pb";
import { GeometrySchema } from "../../gen/nebula/core/v1/geometry_pb";
import { defaultSymmetry } from "./issues";

const editorPath = (projectId: string, geometryId: string) =>
  `/p/${encodeURIComponent(projectId)}/geometry/${encodeURIComponent(geometryId)}`;

/**
 * The project's geometries (docs/UI.md Section 6.3). A new geometry starts
 * empty, with the symmetry of the project's concept (D94, D98).
 */
export function GeometryList() {
  const { projectId = "" } = useParams();
  return (
    <EntityListPage
      projectId={projectId}
      kind={EntityKind.GEOMETRY}
      title="Geometry"
      plural="geometries"
      editorPath={(id) => editorPath(projectId, id)}
      newContent={(project) =>
        packGeometry(
          create(GeometrySchema, {
            symmetry: defaultSymmetry(project?.concept?.conceptId),
          }),
        )
      }
      newDescription="Starts empty, with the symmetry of the project’s concept."
    />
  );
}
