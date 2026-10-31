import { create, fromJson, toJson, type JsonValue } from "@bufbuild/protobuf";
import { anyPack, type Any } from "@bufbuild/protobuf/wkt";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import {
  CircularFilamentSchema,
  ComponentSchema,
  type CircularFilament,
} from "../gen/nebula/core/v1/component_pb";
import {
  EntityDraftSchema,
  EntityKind,
  UpdateDraftRequestSchema,
} from "../gen/nebula/core/v1/entity_pb";
import { ListMaterialsResponseSchema } from "../gen/nebula/core/v1/material_pb";
import { ListPluginsResponseSchema } from "../gen/nebula/core/v1/plugin_pb";
import { server } from "../mocks/node";
import { coreRegistry } from "../schema/core";
import { renderConnected } from "../test/render";
import { ComponentEditor } from "./ComponentEditor";
import { unpackComponent } from "./content";

// Responses are stubbed so the editor does not depend on mock fixtures.
const P = "p-test";
const ID = "cmp-x";
const path = `/projects/${P}/components/${ID}`;

function serve(content: Any) {
  let draft = create(EntityDraftSchema, {
    kind: EntityKind.COMPONENT,
    id: ID,
    name: "PF9",
    revision: 1,
    content,
  });
  const json = () =>
    HttpResponse.json(
      toJson(EntityDraftSchema, draft, { registry: coreRegistry }),
    );
  server.use(
    http.get(path, json),
    http.patch(path, async ({ request }) => {
      const update = fromJson(
        UpdateDraftRequestSchema,
        (await request.json()) as JsonValue,
        { registry: coreRegistry },
      );
      draft = create(EntityDraftSchema, {
        ...draft,
        name: update.name,
        content: update.content,
        revision: draft.revision + 1,
      });
      return json();
    }),
    http.get(`/projects/${P}/materials`, () =>
      HttpResponse.json(
        toJson(
          ListMaterialsResponseSchema,
          create(ListMaterialsResponseSchema, {
            materials: [{ id: "mat-cu", name: "Copper" }],
          }),
        ),
      ),
    ),
    http.get("/plugins", () =>
      HttpResponse.json(
        toJson(ListPluginsResponseSchema, create(ListPluginsResponseSchema)),
      ),
    ),
  );
  return () => unpackComponent(draft.content, coreRegistry);
}

const renderEditor = () =>
  renderConnected(
    <MemoryRouter>
      <ComponentEditor projectId={P} componentId={ID} />
    </MemoryRouter>,
  );

describe("ComponentEditor", () => {
  it("edits the shape and material inside the Component wrapper", async () => {
    const saved = serve(
      anyPack(
        ComponentSchema,
        create(ComponentSchema, {
          shape: anyPack(
            CircularFilamentSchema,
            create(CircularFilamentSchema, { majorRadius: 2, segments: 32 }),
          ),
        }),
      ),
    );
    renderEditor();
    expect(
      await screen.findByRole("textbox", { name: "Name" }),
    ).toHaveDisplayValue("PF9");
    expect(screen.getByText("CircularFilament")).toBeVisible();

    fireEvent.change(screen.getByLabelText(/Major radius/), {
      target: { value: "3.5" },
    });
    const material = await screen.findByRole("option", { name: "Copper" });
    fireEvent.change(screen.getByRole("combobox", { name: "Material" }), {
      target: { value: (material as HTMLOptionElement).value },
    });
    await waitFor(
      () =>
        expect(
          screen.getByRole("status", { name: "Save status" }),
        ).toHaveTextContent("Saved"),
      { timeout: 2000 },
    );
    await waitFor(() => expect(saved().component.materialId).toBe("mat-cu"));
    expect(saved().shape as CircularFilament).toMatchObject({
      majorRadius: 3.5,
      segments: 32,
    });
  });

  it("shows server violations outside the shape form (Section 5)", async () => {
    serve(
      anyPack(
        ComponentSchema,
        create(ComponentSchema, {
          shape: anyPack(
            CircularFilamentSchema,
            create(CircularFilamentSchema, { majorRadius: 2 }),
          ),
        }),
      ),
    );
    server.use(
      http.patch(path, () =>
        HttpResponse.json(
          {
            code: "invalid",
            message: "Invalid component",
            violations: [
              { path: "name", message: "Name is taken" },
              { path: "material_id", message: "Unknown material" },
            ],
          },
          { status: 422 },
        ),
      ),
    );
    renderEditor();
    const name = await screen.findByRole("textbox", { name: "Name" });
    fireEvent.change(name, { target: { value: "PF1" } });
    expect(
      await screen.findByRole("alert", {}, { timeout: 2000 }),
    ).toHaveTextContent("material_id: Unknown material");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription("Name is taken");
    expect(
      screen.getByRole("status", { name: "Save status" }),
    ).toHaveTextContent("Not saved");
  });
});
