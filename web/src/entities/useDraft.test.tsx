import { create } from "@bufbuild/protobuf";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { queryKeys } from "../api/queryKeys";
import {
  EntityKind,
  ListEntitiesResponseSchema,
  type ListEntitiesResponse,
} from "../gen/nebula/core/v1/entity_pb";
import { server } from "../mocks/node";
import { scenarios } from "../mocks/scenarios";
import { store } from "../mocks/state";
import { renderConnected } from "../test/render";
import { useEntityChannel } from "../ws/channels";
import { ConflictDialog } from "./ConflictDialog";
import { useDraft } from "./useDraft";

const P = "p-baseline";
const K = EntityKind.GEOMETRY;
const ID = "geo-main";

function Editor({
  listen = false,
  debounceMs = 10,
}: {
  listen?: boolean;
  debounceMs?: number;
}) {
  useEntityChannel(listen ? P : undefined);
  const draft = useDraft(P, K, ID, { debounceMs });
  return (
    <>
      <input
        aria-label="Name"
        value={draft.name}
        onChange={(event) => draft.setName(event.target.value)}
      />
      <output aria-label="Status">{draft.status}</output>
      <output aria-label="Revision">{draft.draft?.revision}</output>
      <ConflictDialog
        conflict={draft.conflict}
        onResolve={draft.resolveConflict}
      />
    </>
  );
}

const serverDraft = () => store.entity(P, K, ID)!.draft;
// `hidden`: the modal conflict dialog hides the rest of the page.
const status = () =>
  screen.getByRole("status", { name: "Status", hidden: true });
const name = () =>
  screen.getByRole<HTMLInputElement>("textbox", { name: "Name", hidden: true });

async function loaded() {
  const rendered = renderConnected(<Editor />);
  await waitFor(() => expect(name().value).toBe("Baseline assembly"));
  return rendered;
}

const settle = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

describe("useDraft", () => {
  it("saves edits after the debounce with the base revision", async () => {
    await loaded();
    fireEvent.change(name(), { target: { value: "Renamed" } });
    expect(status()).toHaveTextContent("dirty");
    await waitFor(() => expect(status()).toHaveTextContent("saved"));
    expect(serverDraft()).toMatchObject({ name: "Renamed", revision: 8 });
    expect(screen.getByRole("status", { name: "Revision" })).toHaveTextContent(
      "8",
    );
  });

  it("queues edits made during a save and sends them on the new revision", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const revisions: (string | null)[] = [];
    server.use(
      http.patch(`/projects/${P}/geometries/${ID}`, async ({ request }) => {
        revisions.push(request.headers.get("If-Match"));
        if (revisions.length === 1) await held;
        // Fall through to the mock store's handler.
        return undefined;
      }),
    );
    await loaded();
    fireEvent.change(name(), { target: { value: "First" } });
    await waitFor(() => expect(status()).toHaveTextContent("saving"));
    fireEvent.change(name(), { target: { value: "Second" } });
    release();
    await waitFor(() => expect(serverDraft().name).toBe("Second"));
    await waitFor(() => expect(status()).toHaveTextContent("saved"));
    expect(revisions).toEqual(['"7"', '"8"']);
  });

  it("on 409, keeping the server version discards the local edit", async () => {
    await loaded();
    scenarios.concurrentEdit(P, K, ID);
    fireEvent.change(name(), { target: { value: "Mine" } });
    expect(
      await screen.findByRole("dialog", { name: "Edited elsewhere" }),
    ).toBeVisible();
    expect(status()).toHaveTextContent("conflict");

    await userEvent.click(
      screen.getByRole("button", { name: "Keep server version" }),
    );
    await waitFor(() =>
      expect(name().value).toBe("Baseline assembly (edited elsewhere)"),
    );
    expect(status()).toHaveTextContent("saved");
    expect(serverDraft().revision).toBe(8);
  });

  it("on 409, re-applying saves the local edit on top of the server draft", async () => {
    await loaded();
    scenarios.concurrentEdit(P, K, ID);
    fireEvent.change(name(), { target: { value: "Mine" } });
    await userEvent.click(
      await screen.findByRole("button", { name: "Re-apply my change" }),
    );
    await waitFor(() =>
      expect(serverDraft()).toMatchObject({ name: "Mine", revision: 9 }),
    );
    await waitFor(() => expect(status()).toHaveTextContent("saved"));
  });

  it("on 409, puts the server's revision into the entity list", async () => {
    const { queryClient } = await loaded();
    const listKey = queryKeys.entities(P, K);
    queryClient.setQueryData(
      listKey,
      create(ListEntitiesResponseSchema, {
        entities: [{ kind: K, id: ID, name: "Baseline assembly", revision: 7 }],
      }),
    );
    scenarios.concurrentEdit(P, K, ID);
    fireEvent.change(name(), { target: { value: "Mine" } });
    await screen.findByRole("dialog", { name: "Edited elsewhere" });
    // The tessellation fingerprint reads list revisions.
    expect(
      queryClient.getQueryData<ListEntitiesResponse>(listKey)?.entities[0],
    ).toMatchObject({ revision: 8 });
  });

  it("flushes a debounced edit when the editor closes", async () => {
    const { unmount } = renderConnected(<Editor debounceMs={10_000} />);
    await waitFor(() => expect(name().value).toBe("Baseline assembly"));
    fireEvent.change(name(), { target: { value: "Closing" } });
    unmount();
    await waitFor(() =>
      expect(serverDraft()).toMatchObject({ name: "Closing", revision: 8 }),
    );
  });

  it("sends an edit made during a save after it when the editor closes", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const revisions: (string | null)[] = [];
    server.use(
      http.patch(`/projects/${P}/geometries/${ID}`, async ({ request }) => {
        revisions.push(request.headers.get("If-Match"));
        if (revisions.length === 1) await held;
        return undefined;
      }),
    );
    const { unmount } = await loaded();
    fireEvent.change(name(), { target: { value: "First" } });
    await waitFor(() => expect(status()).toHaveTextContent("saving"));
    fireEvent.change(name(), { target: { value: "Second" } });
    unmount();
    release();
    await waitFor(() =>
      expect(serverDraft()).toMatchObject({ name: "Second", revision: 9 }),
    );
    expect(revisions).toEqual(['"7"', '"8"']);
  });

  it("never flushes past an unresolved conflict when the editor closes", async () => {
    const { unmount } = await loaded();
    scenarios.concurrentEdit(P, K, ID);
    fireEvent.change(name(), { target: { value: "Mine" } });
    await screen.findByRole("dialog", { name: "Edited elsewhere" });
    unmount();
    await settle();
    expect(serverDraft()).toMatchObject({
      name: "Baseline assembly (edited elsewhere)",
      revision: 8,
    });
  });

  it("never resends a rejected edit when the editor closes", async () => {
    let patches = 0;
    server.use(
      http.patch(`/projects/${P}/geometries/${ID}`, () => {
        patches++;
        return HttpResponse.json(
          {
            code: "invalid",
            message: "Invalid geometry",
            violations: [{ path: "name", message: "Name is too long" }],
          },
          { status: 422 },
        );
      }),
    );
    const { unmount } = await loaded();
    fireEvent.change(name(), { target: { value: "Rejected" } });
    await waitFor(() => expect(status()).toHaveTextContent("error"));
    unmount();
    await settle();
    expect(patches).toBe(1);
  });

  it("conflicts when another client's edit arrives before the debounced save", async () => {
    renderConnected(<Editor listen debounceMs={300} />);
    await waitFor(() => expect(name().value).toBe("Baseline assembly"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    fireEvent.change(name(), { target: { value: "Mine" } });
    scenarios.concurrentEdit(P, K, ID);
    // The refetched draft lands while the edit still waits...
    await waitFor(() =>
      expect(
        screen.getByRole("status", { name: "Revision", hidden: true }),
      ).toHaveTextContent("8"),
    );
    expect(status()).toHaveTextContent("dirty");
    // ...but the save is based on revision 7, so it must not overwrite it.
    expect(
      await screen.findByRole("dialog", { name: "Edited elsewhere" }),
    ).toBeVisible();
    expect(serverDraft()).toMatchObject({
      name: "Baseline assembly (edited elsewhere)",
      revision: 8,
    });
  });

  it("follows edits by another client arriving on the entity channel", async () => {
    renderConnected(<Editor listen />);
    await waitFor(() => expect(name().value).toBe("Baseline assembly"));
    // Let the channel connect before the other client edits.
    await new Promise((resolve) => setTimeout(resolve, 50));
    scenarios.concurrentEdit(P, K, ID);
    await waitFor(() =>
      expect(name().value).toBe("Baseline assembly (edited elsewhere)"),
    );
  });
});
