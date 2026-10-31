import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Any } from "@bufbuild/protobuf/wkt";
import {
  draftQueryOptions,
  patchSummary,
  putDraftIfNewer,
  updateDraft,
} from "../api/entities";
import { DraftConflictError, ValidationError } from "../api/errors";
import { queryKeys } from "../api/queryKeys";
import type { EntityDraft, EntityKind } from "../gen/nebula/core/v1/entity_pb";

/** Local edits not yet accepted by the server. */
export interface PendingEdit {
  name?: string;
  content?: Any;
}

/** A pending edit and the revision it was based on, which its save sends. */
type Held = PendingEdit & { base?: number };

/**
 * New content, or a function of the content the edit applies to. A function
 * suits edits that finish later (after a request): it applies to what the
 * editor holds then, never to an older snapshot saved on a newer base (D148).
 */
export type ContentChange = Any | ((current: Any | undefined) => Any);

export type DraftStatus =
  "loading" | "saved" | "dirty" | "saving" | "conflict" | "error";

/** What an editor's save-status line says per status. */
export const SAVE_STATUS_LABELS: Readonly<Record<DraftStatus, string>> = {
  loading: "Loading…",
  saved: "Saved",
  dirty: "Unsaved changes",
  saving: "Saving…",
  conflict: "Edited elsewhere",
  error: "Not saved",
};

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
  setContent: (content: ContentChange) => void;
  /** Discards local edits ("server") or saves them on top of it ("reapply"). */
  resolveConflict: (choice: "server" | "reapply") => void;
}

/** The save in flight: the edit it sent and its outcome (unset on failure). */
interface InFlight {
  sent: Held;
  done: Promise<EntityDraft | undefined>;
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
  const query = useQuery(draftQueryOptions(projectId, kind, id));
  const draft = query.data;

  const [pending, setPending] = useState<Held>();
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<EntityDraft>();
  const [error, setError] = useState<Error>();
  const inFlight = useRef<InFlight>();

  // Latest values for the unmount flush, which must not resubscribe.
  const latest = useRef({ pending, draft, saving, conflict, error });
  useEffect(() => {
    latest.current = { pending, draft, saving, conflict, error };
  });

  useEffect(() => {
    if (!pending || !draft || saving || conflict || error) return;
    const timer = setTimeout(() => {
      const sent = pending;
      setSaving(true);
      // The revision the edit was based on, not one refetched since: a
      // change saved elsewhere meanwhile must conflict (D148).
      const request = saveDraft(
        queryClient,
        projectId,
        kind,
        id,
        sent,
        draft,
        sent.base ?? draft.revision,
      );
      inFlight.current = { sent, done: request.catch(() => undefined) };
      request
        .then((saved) => {
          // Edits made while this save was in flight go next, on top of it.
          setPending((current) =>
            current === sent
              ? undefined
              : current && { ...current, base: saved.revision },
          );
        })
        .catch((e: unknown) => {
          if (e instanceof DraftConflictError) {
            putDraftIfNewer(
              queryClient,
              queryKeys.draft(projectId, kind, id),
              e.current,
            );
            // The list revision feeds the tessellation fingerprint.
            patchSummary(queryClient, projectId, e.current);
            // "Re-apply" saves the held edit on top of the server's draft.
            setPending(
              (current) => current && { ...current, base: e.current.revision },
            );
            setConflict(e.current);
          } else {
            setError(e instanceof Error ? e : new Error(String(e)));
          }
        })
        .finally(() => setSaving(false));
    }, debounceMs);
    return () => clearTimeout(timer);
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

  // Flush an unsaved edit when the editor closes. Never past an unresolved
  // conflict: its held edit is based on the server's draft, so a save would
  // overwrite the other client's change without the user choosing (D148).
  // Nor an edit the server rejected (422): any later edit clears the error,
  // so it is that very edit, and it would be rejected again.
  useEffect(
    () => () => {
      const { pending: unsaved, draft: base, saving: busy } = latest.current;
      if (!unsaved || !base || latest.current.conflict) return;
      if (latest.current.error instanceof ValidationError) return;
      const running = inFlight.current;
      if (!busy || !running) {
        void saveDraft(
          queryClient,
          projectId,
          kind,
          id,
          unsaved,
          base,
          unsaved.base ?? base.revision,
        ).catch(() => undefined);
        return;
      }
      // Edits made during the save go out after it, on the revision it got.
      if (unsaved === running.sent) return;
      void running.done.then((saved) =>
        saved
          ? saveDraft(
              queryClient,
              projectId,
              kind,
              id,
              unsaved,
              saved,
              saved.revision,
            ).catch(() => undefined)
          : undefined,
      );
    },
    [projectId, kind, id, queryClient],
  );

  // An edit's base is the draft its content derives from: the held edit's
  // base, else the draft the editor holds now.
  const edit = useCallback(
    (change: (current: Held | undefined) => PendingEdit) => {
      setError(undefined);
      setPending((current) => ({
        ...current,
        ...change(current),
        base: current ? current.base : latest.current.draft?.revision,
      }));
    },
    [],
  );
  const setName = useCallback((name: string) => edit(() => ({ name })), [edit]);
  const setContent = useCallback(
    (content: ContentChange) =>
      edit((current) => ({
        content:
          typeof content === "function"
            ? content(current?.content ?? latest.current.draft?.content)
            : content,
      })),
    [edit],
  );

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

/** Saves a held edit onto `onto` (the draft it applies to) and caches it. */
function saveDraft(
  queryClient: QueryClient,
  projectId: string,
  kind: EntityKind,
  id: string,
  held: Held,
  onto: EntityDraft,
  baseRevision: number,
): Promise<EntityDraft> {
  return updateDraft(projectId, kind, id, baseRevision, {
    name: held.name ?? onto.name,
    content: held.content ?? onto.content,
  }).then((saved) => {
    putDraftIfNewer(queryClient, queryKeys.draft(projectId, kind, id), saved);
    patchSummary(queryClient, projectId, saved);
    return saved;
  });
}
