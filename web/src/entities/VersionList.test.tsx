import { create, toJson } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import {
  EntityDraftSchema,
  EntityKind,
  LibrarySourceSchema,
  ListVersionsResponseSchema,
  MintedBy,
} from "../gen/nebula/core/v1/entity_pb";
import { ListLibraryComponentsResponseSchema } from "../gen/nebula/core/v1/library_pb";
import { server } from "../mocks/node";
import { Connected, renderConnected } from "../test/render";
import { LibrarySourceLink } from "./LibrarySourceLink";
import { VersionList } from "./VersionList";

// Responses are stubbed here so these widgets do not depend on mock fixtures.
const P = "p-test";
const ID = "geo-x";
const at = (iso: string) => timestampFromDate(new Date(iso));

function serveVersions(headHash: string, draftRevisions: number[]) {
  const versions = draftRevisions.map((draftRevision, i) => ({
    hash: `sha256:${String(i).repeat(12)}`,
    mintedAt: at(`2026-10-0${i + 1}T10:00:00Z`),
    mintedBy: MintedBy.RUN_SUBMISSION,
    draftRevision,
  }));
  server.use(
    http.get(`/projects/${P}/geometries/${ID}/versions`, () =>
      HttpResponse.json(
        toJson(
          ListVersionsResponseSchema,
          create(ListVersionsResponseSchema, { versions, headHash }),
        ),
      ),
    ),
  );
}

const draft = (revision: number) =>
  create(EntityDraftSchema, { kind: EntityKind.GEOMETRY, id: ID, revision });

const indicator = () => screen.findByRole("status", { name: "Draft state" });

describe("VersionList", () => {
  it("says when the entity was never versioned", async () => {
    serveVersions("", []);
    renderConnected(
      <VersionList
        projectId={P}
        kind={EntityKind.GEOMETRY}
        id={ID}
        draft={draft(3)}
      />,
    );
    expect(await indicator()).toHaveTextContent(
      "Never versioned: the draft is minted at the next run submission",
    );
  });

  it("compares the draft with the head version, newest first", async () => {
    serveVersions("sha256:111111111111", [2, 5]);
    const { rerender, queryClient } = renderConnected(
      <VersionList
        projectId={P}
        kind={EntityKind.GEOMETRY}
        id={ID}
        draft={draft(5)}
        actions={(version) => (
          <button type="button">Export {version.hash.slice(7, 9)}</button>
        )}
      />,
    );
    expect(await indicator()).toHaveTextContent(
      "Draft matches head version 1111111111",
    );
    const items = within(
      screen.getByRole("region", { name: "Versions" }),
    ).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("1111111111");
    expect(items[0]).toHaveTextContent("head");
    expect(items[1]).not.toHaveTextContent("head");
    expect(
      within(items[1]!).getByRole("button", { name: "Export 00" }),
    ).toBeInTheDocument();

    rerender(
      <Connected queryClient={queryClient}>
        <VersionList
          projectId={P}
          kind={EntityKind.GEOMETRY}
          id={ID}
          draft={draft(6)}
        />
      </Connected>,
    );
    expect(await indicator()).toHaveTextContent(
      "Draft changed since head version 1111111111",
    );
  });
});

describe("LibrarySourceLink", () => {
  const source = create(LibrarySourceSchema, {
    entryId: "lib-pf",
    entryName: "Generic PF coil",
    importedAt: at("2026-10-01T10:00:00Z"),
  });
  const serveLibrary = (ids: string[]) =>
    server.use(
      http.get("/library/components", () =>
        HttpResponse.json(
          toJson(
            ListLibraryComponentsResponseSchema,
            create(ListLibraryComponentsResponseSchema, {
              components: ids.map((id) => ({ id, name: id })),
            }),
          ),
        ),
      ),
    );
  const renderLink = () =>
    renderConnected(
      <MemoryRouter>
        <LibrarySourceLink projectId={P} source={source} kind="component" />
      </MemoryRouter>,
    );

  it("links the global library entry", async () => {
    serveLibrary(["lib-pf"]);
    renderLink();
    const link = await screen.findByRole("link", { name: "“Generic PF coil”" });
    expect(link).toHaveAttribute(
      "href",
      `/p/${P}/libraries/global/components/lib-pf`,
    );
    expect(link.parentElement).toHaveTextContent(
      "Imported from library entry “Generic PF coil” on",
    );
  });

  it("says when the entry is gone", async () => {
    serveLibrary([]);
    renderLink();
    expect(
      await screen.findByText(/“Generic PF coil” \(no longer in the library\)/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
