import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Any } from "@bufbuild/protobuf/wkt";
import {
  fetchDraft,
  newerDraft,
  putDraftIfNewer,
  updateDraft,
} from "../api/entities";
import { DraftConflictError } from "../api/errors";
import { queryKeys } from "../api/queryKeys";
import type { EntityDraft, EntityKind } from "../gen/nebula/core/v1/entity_pb";

/** Local edits not yet accepted by the server. */
export interface PendingEdit {
  name?: string;
  content?: Any;
}

export type DraftStatus =
  "loading" | "saved" | "dirty" | "saving" | "conflict" | "error";

export interface DraftState {
  /** Latest draft accepted by the server. */
  draft: EntityDraft | undefined;
  /** What the editor shows: the server draft with local edits applied. */
  name: string;
  content: Any | undefined;
  status: DraftStatus;
  /** The server's draft that a save collided with (D148). */
  conflict: EntityDraft | undefined;
  error: Error | undefined;
  setName: (name: string) => void;
  setContent: (content: Any) => void;
  /** Discards local edits ("server") or saves them on top of it ("reapply"). */
  resolveConflict: (choice: "server" | "reapply") => void;
}

/**
 * The draft of an entity with debounced conditional saves (docs/UI.md
 * Section 4.4). At most one save is in flight; edits made meanwhile go out
 * next, based on the revision the server returned. A 409 holds the local
 * edit and exposes the server's draft until the user resolves it.
 */
export function useDraft(
  projectId: string,
  kind: EntityKind,
  id: string,
  { debounceMs = 500 }: { debounceMs?: number } = {},
): DraftState {
  const queryClient = useQueryClient();
  const key = queryKeys.draft(projectId, kind, id);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fetchDraft(projectId, kind, id, signal),
    // A response older than the held draft is dropped (A§3.3, D148).
    structuralSharing: (held, incoming) =>
      newerDraft(held as EntityDraft | undefined, incoming as EntityDraft),
  });
  const draft = query.data;

  const [pending, setPending] = useState<PendingEdit>();
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<EntityDraft>();
  const [error, setError] = useState<Error>();

  // Latest values for the unmount flush, which must not resubscribe.
  const latest = useRef({ pending, draft, saving });
  useEffect(() => {
    latest.current = { pending, draft, saving };
  });

  useEffect(() => {
    if (!pending || !draft || saving || conflict || error) return;
    const timer = setTimeout(() => {
      const sent = pending;
      setSaving(true);
      updateDraft(projectId, kind, id, draft.revision, {
        name: sent.name ?? draft.name,
        content: sent.content ?? draft.content,
      })
        .then((saved) => {
          putDraftIfNewer(queryClient, key, saved);
          // Keep edits made while this save was in flight.
          setPending((current) => (current === sent ? undefined : current));
        })
        .catch((e: unknown) => {
          if (e instanceof DraftConflictError) {
            putDraftIfNewer(queryClient, key, e.current);
            setConflict(e.current);
          } else {
            setError(e instanceof Error ? e : new Error(String(e)));
          }
        })
        .finally(() => setSaving(false));
    }, debounceMs);
    return () => clearTimeout(timer);
    // `key` is derived from the ids below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pending,
    draft,
    saving,
    conflict,
    error,
    debounceMs,
    projectId,
    kind,
    id,
    queryClient,
  ]);

  // Flush an edit still waiting for its debounce when the editor closes.
  useEffect(
    () => () => {
      const { pending: unsaved, draft: base, saving: busy } = latest.current;
      if (unsaved && base && !busy) {
        void updateDraft(projectId, kind, id, base.revision, {
          name: unsaved.name ?? base.name,
          content: unsaved.content ?? base.content,
        })
          .then((saved) =>
            putDraftIfNewer(
              queryClient,
              queryKeys.draft(projectId, kind, id),
              saved,
            ),
          )
          .catch(() => undefined);
      }
    },
    [projectId, kind, id, queryClient],
  );

  const edit = useCallback((change: PendingEdit) => {
    setError(undefined);
    setPending((current) => ({ ...current, ...change }));
  }, []);
  const setName = useCallback((name: string) => edit({ name }), [edit]);
  const setContent = useCallback((content: Any) => edit({ content }), [edit]);

  const resolveConflict = useCallback((choice: "server" | "reapply") => {
    if (choice === "server") setPending(undefined);
    setConflict(undefined);
  }, []);

  let status: DraftStatus;
  if (!draft) status = query.isError ? "error" : "loading";
  else if (conflict) status = "conflict";
  else if (error) status = "error";
  else if (saving) status = "saving";
  else if (pending) status = "dirty";
  else status = "saved";

  return {
    draft,
    name: pending?.name ?? draft?.name ?? "",
    content: pending?.content ?? draft?.content,
    status,
    conflict,
    error: error ?? query.error ?? undefined,
    setName,
    setContent,
    resolveConflict,
  };
}
