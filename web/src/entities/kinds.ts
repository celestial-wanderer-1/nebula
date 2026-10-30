import { EntityKind } from "../gen/nebula/core/v1/entity_pb";

export const ENTITY_LABELS: Readonly<Record<EntityKind, string>> = {
  [EntityKind.UNSPECIFIED]: "Entity",
  [EntityKind.GEOMETRY]: "Geometry",
  [EntityKind.COMPONENT]: "Component",
  [EntityKind.REGION]: "Region",
  [EntityKind.SCENARIO]: "Scenario",
  [EntityKind.CONDUCTOR_NETWORK]: "Conductor network",
  [EntityKind.WORKFLOW]: "Workflow",
};
