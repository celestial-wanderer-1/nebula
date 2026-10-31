import type { ConceptRef } from "../../gen/nebula/core/v1/project_pb";

/** "nebula.concept.simple_mirror" -> "Simple mirror". */
export function conceptName(concept: ConceptRef | undefined): string {
  if (!concept?.conceptId) return "—";
  const last = concept.conceptId.split(".").pop() ?? concept.conceptId;
  const words = last.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
