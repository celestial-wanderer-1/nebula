import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef } from "react";
import {
  EntityKind,
  type EntityDraft,
  type EntityRef,
  type EntitySummary,
} from "../gen/nebula/core/v1/entity_pb";
import {
  GeometryTessellationSchema,
  type GeometryTessellation,
} from "../gen/nebula/core/v1/geometry_pb";
import { apiBlob, apiJson } from "./client";
import { saveDownload } from "./download";
import { entityPath, useEntities } from "./entities";
import { queryKeys } from "./queryKeys";

const geometryPath = (projectId: string, geometryId: string) =>
  entityPath(projectId, EntityKind.GEOMETRY, geometryId);

/**
 * Meshes of a geometry draft's components, each resolved per reference state
 * (A§3.3). The wire also takes `?component=`; the editor always fetches all.
 */
export function fetchTessellation(
  projectId: string,
  geometryId: string,
  signal?: AbortSignal,
  versionHash?: string,
): Promise<GeometryTessellation> {
  const query = versionHash
    ? `?${new URLSearchParams({ version: versionHash }).toString()}`
    : "";
  return apiJson(
    `${geometryPath(projectId, geometryId)}/tessellation${query}`,
    GeometryTessellationSchema,
    { signal },
  );
}

/**
 * The tessellation of a geometry as a reference resolves it (D107): its
 * draft, its head version (`latest`) or a pinned version. For backdrops,
 * such as region placement; the editor uses useGeometryTessellation.
 */
export function useReferenceTessellation(
  projectId: string,
  ref: EntityRef | undefined,
) {
  const geometries = useEntities(projectId, EntityKind.GEOMETRY);
  const components = useEntities(projectId, EntityKind.COMPONENT);
  const summary = geometries.data?.find((g) => g.id === ref?.id);
  let versionHash: string | undefined;
  let fingerprint: string | undefined;
  if (ref?.state.case === "pinned") {
    versionHash = ref.state.value.versionHash;
    fingerprint = `v:${versionHash}`;
  } else if (ref?.state.case === "latest") {
    versionHash = summary?.headHash || undefined;
    fingerprint = versionHash && `v:${versionHash}`;
  } else if (ref?.id && summary && components.data) {
    // A draft build follows the geometry and component drafts.
    fingerprint = [
      `d:${summary.revision}`,
      ...components.data.map((c) => `${c.id}:${c.revision}:${c.headHash}`),
    ].join("|");
  }
  const geometryId = ref?.id ?? "";
  return useQuery({
    queryKey: queryKeys.tessellation(projectId, geometryId, fingerprint ?? ""),
    queryFn: ({ signal }) =>
      fetchTessellation(projectId, geometryId, signal, versionHash),
    enabled: Boolean(geometryId && fingerprint),
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === geometryId ? previous : undefined,
  });
}

/**
 * Names the inputs a tessellation is built from: the geometry revision and,
 * per reference, what it resolves to (draft revision, pinned hash or head
 * hash). Undefined until the geometry and the component list are loaded.
 */
export function tessellationFingerprint(
  geometry: EntityDraft | undefined,
  refs: readonly EntityRef[],
  components: readonly EntitySummary[] | undefined,
): string | undefined {
  if (!geometry || !components) return undefined;
  const parts = refs.map((ref) => {
    const summary = components.find((component) => component.id === ref.id);
    switch (ref.state.case) {
      case "draft":
        return `${ref.id}:draft:${summary?.revision ?? 0}`;
      case "pinned":
        return `${ref.id}:pinned:${ref.state.value.versionHash}`;
      case "latest":
        return `${ref.id}:latest:${summary?.headHash ?? ""}`;
      default:
        return `${ref.id}:unset`;
    }
  });
  return [`r${geometry.revision}`, ...parts].join("|");
}

/**
 * Merges a tessellation reply into the held one, per component. A draft
 * build never replaces a newer draft build, so an older reply cannot undo
 * a newer mesh (D148); a failed build always lands, so its error shows. An unchanged build keeps the held object, so the viewer does not
 * rebuild its mesh. Components absent from the reply are dropped, and
 * issues always come from the reply.
 */
export function mergeTessellation(
  held: GeometryTessellation | undefined,
  incoming: GeometryTessellation,
): GeometryTessellation {
  if (!held) return incoming;
  return {
    ...incoming,
    components: incoming.components.map((next) => {
      const current = held.components.find(
        (component) => component.componentId === next.componentId,
      );
      if (!current) return next;
      if (
        current.revision === next.revision &&
        current.versionHash === next.versionHash &&
        current.error === next.error &&
        Boolean(current.mesh) === Boolean(next.mesh)
      ) {
        return current;
      }
      const olderDraft =
        !next.error &&
        current.versionHash === "" &&
        next.versionHash === "" &&
        current.revision > next.revision;
      return olderDraft ? current : next;
    }),
  };
}

/**
 * The geometry's tessellation for `fingerprint`. The previous mesh stays on
 * screen until the new reply arrives, and replies merge per component.
 */
export function useGeometryTessellation(
  projectId: string,
  geometryId: string,
  fingerprint: string | undefined,
) {
  const query = useQuery({
    queryKey: queryKeys.tessellation(projectId, geometryId, fingerprint ?? ""),
    queryFn: ({ signal }) => fetchTessellation(projectId, geometryId, signal),
    enabled: fingerprint !== undefined,
    // keepPreviousData, but never across geometries.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[0] === projectId &&
      previousQuery.queryKey[2] === geometryId
        ? previous
        : undefined,
  });

  // The merged result across fingerprints, for this geometry only.
  const held = useRef<{ key: string; value?: GeometryTessellation }>({
    key: "",
  });
  const owner = `${projectId}/${geometryId}`;
  const data = useMemo(() => {
    if (held.current.key !== owner) held.current = { key: owner };
    if (query.data) {
      held.current.value = mergeTessellation(held.current.value, query.data);
    }
    return held.current.value;
  }, [owner, query.data]);

  return { data, isFetching: query.isFetching, error: query.error };
}

/** Downloads the geometry as STEP (D27): the draft, or a version. */
export async function downloadStep(
  projectId: string,
  geometryId: string,
  versionHash?: string,
): Promise<void> {
  const query = versionHash
    ? `?${new URLSearchParams({ version: versionHash }).toString()}`
    : "";
  const file = await apiBlob(
    `${geometryPath(projectId, geometryId)}/step${query}`,
  );
  // The server names the file; this is only a fallback.
  const digest = versionHash?.slice(versionHash.indexOf(":") + 1);
  saveDownload(
    file,
    digest ? `${geometryId}-${digest.slice(0, 10)}.step` : `${geometryId}.step`,
  );
}
