import { fromJson, type JsonValue } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { EntityDraftSchema } from "../../gen/nebula/core/v1/entity_pb";
import { GeometryTessellationSchema } from "../../gen/nebula/core/v1/geometry_pb";
import { mockSchema } from "../fixtures";
import { MOCK_TOKEN } from "../token";
import { worldPositions } from "../tessellate";
import { unwrapComponent } from "../../entities/content";

// The wire contract as a client sees it: protobuf JSON over the MSW server.

function call(path: string, method = "GET", body?: unknown) {
  return fetch(new URL(path, window.location.origin), {
    method,
    headers: {
      Authorization: `Bearer ${MOCK_TOKEN}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const json = async (response: Response) =>
  (await response.json()) as Record<string, unknown> & JsonValue;

describe("mock REST handlers", () => {
  it("creates and deletes components, refusing one a geometry uses", async () => {
    const created = await call("/projects/p-baseline/components", "POST", {
      name: "Coil",
      content: {
        "@type": "type.googleapis.com/nebula.core.v1.Component",
        shape: {
          "@type": "type.googleapis.com/nebula.core.v1.CircularFilament",
          majorRadius: 2,
        },
      },
    });
    expect(created.status).toBe(201);
    const draft = fromJson(EntityDraftSchema, await json(created), {
      registry: mockSchema.typeRegistry,
    });
    expect(draft.revision).toBe(1);

    const listed = await json(await call("/projects/p-baseline/components"));
    expect(JSON.stringify(listed)).toContain(draft.id);

    expect(
      (await call(`/projects/p-baseline/components/${draft.id}`, "DELETE"))
        .status,
    ).toBe(204);
    const refused = await call(
      "/projects/p-baseline/components/cmp-pf1",
      "DELETE",
    );
    expect(refused.status).toBe(409);
    expect(await json(refused)).toMatchObject({
      code: "in_use",
      message: 'Referenced by geometry "Baseline assembly"',
    });
  });

  it("serves material CRUD with last-write-wins updates", async () => {
    const created = await json(
      await call("/projects/p-baseline/materials", "POST", {
        name: "Tungsten",
        properties: { density: 19300 },
      }),
    );
    const path = `/projects/p-baseline/materials/${String(created.id)}`;
    const updated = await call(path, "PUT", {
      name: "Tungsten (W)",
      properties: { density: 19250 },
    });
    expect(await json(updated)).toMatchObject({
      name: "Tungsten (W)",
      properties: { density: 19250 },
    });
    expect(await json(await call(path))).toMatchObject({
      name: "Tungsten (W)",
    });
    expect((await call(path, "DELETE")).status).toBe(204);
    expect((await call(path)).status).toBe(404);
    expect(
      (await call("/projects/p-baseline/materials/m-ss316", "DELETE")).status,
    ).toBe(409);
  });

  it("requires a material name on create and update", async () => {
    const nameRequired = {
      code: "invalid",
      violations: [{ path: "name", message: "A name is required" }],
    };
    const blank = await call("/projects/p-baseline/materials", "POST", {
      name: "   ",
    });
    expect(blank.status).toBe(422);
    expect(await json(blank)).toMatchObject(nameRequired);

    const path = "/projects/p-baseline/materials/m-copper";
    const emptied = await call(path, "PUT", { name: "", properties: {} });
    expect(emptied.status).toBe(422);
    expect(await json(emptied)).toMatchObject(nameRequired);
    expect(await json(await call(path))).toMatchObject({ name: "Copper" });

    const trimmed = await call("/projects/p-baseline/materials", "POST", {
      name: "  Tungsten ",
    });
    expect(await json(trimmed)).toMatchObject({ name: "Tungsten" });
  });

  it("imports a library component without duplicating its held material", async () => {
    const before = (
      (await json(await call("/projects/p-baseline/materials")))
        .materials as unknown[]
    ).length;
    const imported = await call(
      "/projects/p-baseline/components/import",
      "POST",
      { entryId: "lib-cmp-vessel" },
    );
    expect(imported.status).toBe(201);
    const draft = fromJson(EntityDraftSchema, await json(imported), {
      registry: mockSchema.typeRegistry,
    });
    expect(unwrapComponent(draft.content)).toMatchObject({
      materialId: "m-ss316",
      source: { entryId: "lib-cmp-vessel" },
    });
    const after = (
      (await json(await call("/projects/p-baseline/materials")))
        .materials as unknown[]
    ).length;
    expect(after).toBe(before);

    const material = await call(
      "/projects/p-baseline/materials/import",
      "POST",
      { entryId: "lib-mat-nb3sn" },
    );
    expect(material.status).toBe(201);
    expect(await json(material)).toMatchObject({
      name: "Nb3Sn",
      source: { entryId: "lib-mat-nb3sn", entryName: "Nb3Sn" },
    });
  });

  it("serves the global library and adds project items to it", async () => {
    const list = await json(await call("/library/components"));
    expect(JSON.stringify(list)).toContain("lib-cmp-pf-coil");
    expect(
      await json(await call("/library/materials/lib-mat-copper")),
    ).toMatchObject({ name: "Copper" });
    const added = await call("/library/materials", "POST", {
      projectId: "p-baseline",
      itemId: "m-copper",
      description: "Ours",
    });
    expect(added.status).toBe(201);
    expect(await json(added)).toMatchObject({
      name: "Copper",
      description: "Ours",
    });
  });

  it("returns tessellations with base64 mesh bytes, filtered by component", async () => {
    const response = await call(
      "/projects/p-baseline/geometries/geo-main/tessellation?component=cmp-pf2",
    );
    const tessellation = fromJson(
      GeometryTessellationSchema,
      await json(response),
      { registry: mockSchema.typeRegistry },
    );
    expect(tessellation.components).toHaveLength(1);
    const [pf2] = tessellation.components;
    expect(pf2).toMatchObject({
      componentId: "cmp-pf2",
      versionHash: "sha256:pf2-v1",
    });
    const [x, y] = worldPositions(pf2!.mesh!)[0]!;
    expect(Math.hypot(x!, y!)).toBeCloseTo(8.2, 4);
    // Issues cover the whole geometry even when filtered.
    expect(tessellation.issues.map((issue) => issue.path)).toEqual([
      "circuits/ckt-feed",
    ]);
  });

  it("downloads STEP as an attachment, per version", async () => {
    const draft = await call("/projects/p-baseline/geometries/geo-main/step");
    expect(draft.headers.get("Content-Type")).toBe("application/step");
    expect(draft.headers.get("Content-Disposition")).toBe(
      'attachment; filename="Baseline-assembly.step"',
    );
    expect(await draft.text()).toMatch(/^ISO-10303-21;/);
    const version = await call(
      "/projects/p-baseline/geometries/geo-main/step?version=sha256:geo-v2",
    );
    expect(version.headers.get("Content-Disposition")).toBe(
      'attachment; filename="Baseline-assembly-geo-v2.step"',
    );
    expect(
      (
        await call(
          "/projects/p-baseline/geometries/geo-main/step?version=sha256:nope",
        )
      ).status,
    ).toBe(404);
  });
});
