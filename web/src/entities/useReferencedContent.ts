import type { Any } from "@bufbuild/protobuf/wkt";
import { useQuery } from "@tanstack/react-query";
import {
  draftQueryOptions,
  useEntityVersion,
  useVersions,
} from "../api/entities";
import type { EntityRef } from "../gen/nebula/core/v1/entity_pb";

/**
 * The content an entity reference resolves to (A§4.2, D107): the current
 * draft, the head version for `latest`, or the pinned version. Editors use
 * it to offer, say, the circuits of the geometry a scenario references.
 */
export function useReferencedContent(
  projectId: string,
  ref: EntityRef | undefined,
): { content: Any | undefined; isPending: boolean; missing: boolean } {
  const state = ref?.id ? ref.state.case : undefined;
  const draft = useQuery({
    ...draftQueryOptions(projectId, ref?.kind ?? 0, ref?.id ?? ""),
    enabled:
      state === "draft" || state === undefined ? Boolean(ref?.id) : false,
  });
  const versions = useVersions(
    projectId,
    ref?.kind ?? 0,
    state === "latest" ? ref?.id : undefined,
  );
  const hash =
    state === "pinned" && ref?.state.case === "pinned"
      ? ref.state.value.versionHash
      : state === "latest"
        ? versions.data?.headHash || undefined
        : undefined;
  const version = useEntityVersion(projectId, ref?.kind ?? 0, ref?.id, hash);
  if (!ref?.id) return { content: undefined, isPending: false, missing: false };
  if (state === "pinned" || state === "latest") {
    return {
      content: version.data?.content,
      isPending: version.isPending && Boolean(hash),
      missing:
        version.isError || (state === "latest" && versions.isSuccess && !hash),
    };
  }
  return {
    content: draft.data?.content,
    isPending: draft.isPending,
    missing: draft.isError,
  };
}
