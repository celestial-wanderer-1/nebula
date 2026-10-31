import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { unpackGeometry } from "../../entities/content";
import { EntityKind } from "../../gen/nebula/core/v1/entity_pb";
import { store } from "../../mocks/state";
import { renderRoute } from "../../test/render";
import { resetGeometryView } from "./store";

vi.mock("./Viewport", () => ({
  Viewport: () => <div data-testid="viewport" />,
}));

beforeEach(() => resetGeometryView());

async function createGeometry(projectId: string, name: string) {
  const { router } = renderRoute(`/p/${projectId}/geometry`);
  await userEvent.click(
    await screen.findByRole("button", { name: "New geometry" }),
  );
  const dialog = await screen.findByRole("dialog", { name: "New geometry" });
  await userEvent.type(
    within(dialog).getByRole("textbox", { name: "Name" }),
    name,
  );
  const submit = within(dialog).getByRole("button", {
    name: "Create geometry",
  });
  await waitFor(() => expect(submit).toBeEnabled());
  await userEvent.click(submit);
  expect(await screen.findByRole("heading", { name })).toBeVisible();
  const created = store
    .entityRecords(projectId, EntityKind.GEOMETRY)
    .find((record) => record.draft.name === name);
  expect(created).toBeDefined();
  expect(router.state.location.pathname).toBe(
    `/p/${projectId}/geometry/${created!.draft.id}`,
  );
  return unpackGeometry(created!.draft.content);
}

describe("GeometryList", () => {
  it("lists the project's geometries with links to the editor", async () => {
    renderRoute("/p/p-baseline/geometry");
    expect(screen.getByRole("heading", { name: "Geometry" })).toBeVisible();
    const link = await screen.findByRole("link", {
      name: "Baseline assembly",
    });
    expect(link).toHaveAttribute("href", "/p/p-baseline/geometry/geo-main");
    const row = link.closest("tr")!;
    expect(row).toHaveTextContent("geo-v2");
    expect(
      screen.getByRole("link", { name: "Alternative assembly" }).closest("tr"),
    ).toHaveTextContent("Never versioned");
  });

  it("creates an axisymmetric geometry in a tokamak project and opens it", async () => {
    const geometry = await createGeometry("p-baseline", "Upgrade assembly");
    expect(geometry.symmetry).toMatchObject({
      axisymmetric: true,
      fieldPeriods: 1,
    });
    expect(geometry.components).toEqual([]);
    expect(
      await screen.findByRole("navigation", { name: "Assembly" }),
    ).toBeVisible();
  });

  it("gives a stellarator geometry five field periods", async () => {
    const geometry = await createGeometry("p-imported", "Coil set B");
    expect(geometry.symmetry).toMatchObject({
      axisymmetric: false,
      fieldPeriods: 5,
    });
  });
});
