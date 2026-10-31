import type { Any } from "@bufbuild/protobuf/wkt";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  draftQueryOptions,
  entityVersionQueryOptions,
  useEntities,
  useEntityVersion,
} from "../../api/entities";
import { unpackAs, unpackGeometry } from "../../entities/content";
import { EntityKind, type EntityRef } from "../../gen/nebula/core/v1/entity_pb";
import { WorkflowSchema } from "../../gen/nebula/core/v1/workflow_pb";
import { useSchema } from "../../schema/context";
import {
  designVariables,
  type DesignVariable,
} from "../../workflow/designVariables";
import { stepOf } from "../../workflow/ports";

const refKey = (ref: EntityRef) =>
  `${ref.kind}/${ref.id}/${ref.state.case === "pinned" ? ref.state.value.versionHash : ref.state.case}`;

/** The content of each reference, a pinned version or the draft. */
function useContents(projectId: string, refs: readonly EntityRef[]) {
  const results = useQueries({
    queries: refs.map((ref) =>
      ref.state.case === "pinned"
        ? {
            ...entityVersionQueryOptions(
              projectId,
              ref.kind,
              ref.id,
              ref.state.value.versionHash,
            ),
            select: (version: { content?: Any }) => version.content,
          }
        : {
            ...draftQueryOptions(projectId, ref.kind, ref.id),
            select: (draft: { content?: Any }) => draft.content,
          },
    ),
  });
  const contents = new Map<string, Any | undefined>();
  refs.forEach((ref, i) =>
    contents.set(refKey(ref), results[i]?.data as Any | undefined),
  );
  return { contents, pending: results.some((r) => r.isPending) };
}

/**
 * The design variables of a workflow version (D81): its step configs and
 * the scenarios and component shapes its steps are bound to.
 */
export function useDesignVariables(
  projectId: string,
  workflowId: string | undefined,
  versionHash: string | undefined,
): { variables: DesignVariable[]; pending: boolean } {
  const schema = useSchema();
  const version = useEntityVersion(
    projectId,
    EntityKind.WORKFLOW,
    workflowId,
    versionHash,
  );
  const workflow = useMemo(
    () =>
      version.data?.content
        ? unpackAs(WorkflowSchema, version.data.content)
        : undefined,
    [version.data?.content],
  );
  const bound = useMemo(
    () =>
      (workflow?.nodes ?? []).flatMap((node) =>
        (stepOf(node)?.bindings ?? [])
          .filter((b) => b.port === "scenario" || b.port === "geometry")
          .flatMap((b) => (b.ref ? [b.ref] : [])),
      ),
    [workflow],
  );
  const first = useContents(projectId, bound);
  const components = useMemo(
    () =>
      bound
        .filter((ref) => ref.kind === EntityKind.GEOMETRY)
        .flatMap(
          (ref) => unpackGeometry(first.contents.get(refKey(ref))).components,
        ),
    [bound, first.contents],
  );
  const second = useContents(projectId, components);
  const summaries = useEntities(projectId, EntityKind.COMPONENT);
  const variables = useMemo(() => {
    if (!workflow) return [];
    const resolve = (ref: EntityRef) =>
      first.contents.get(refKey(ref)) ?? second.contents.get(refKey(ref));
    // Components and circuits by name, where known.
    const names = new Map<string, string>(
      (summaries.data ?? []).map((c) => [c.id, c.name]),
    );
    for (const ref of bound) {
      if (ref.kind !== EntityKind.GEOMETRY) continue;
      for (const circuit of unpackGeometry(first.contents.get(refKey(ref)))
        .circuits) {
        names.set(circuit.id, circuit.name || circuit.id);
      }
    }
    return designVariables(workflow, resolve, schema.typeRegistry, names);
  }, [
    workflow,
    first.contents,
    second.contents,
    schema,
    summaries.data,
    bound,
  ]);
  return {
    variables,
    pending: version.isPending || first.pending || second.pending,
  };
}
