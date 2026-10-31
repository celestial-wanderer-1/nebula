import { describe, expect, it } from "vitest";
import { MOCK_TOKEN } from "../token";

// The setup resources' wire contract (docs/UI.md 6.4, 6.5).

function call(
  path: string,
  method = "GET",
  body?: BodyInit,
  type = "application/json",
) {
  return fetch(new URL(path, window.location.origin), {
    method,
    headers: {
      Authorization: `Bearer ${MOCK_TOKEN}`,
      ...(body === undefined ? {} : { "Content-Type": type }),
    },
    body,
  });
}

const json = async (response: Response) =>
  (await response.json()) as Record<string, unknown>;

describe("setup handlers", () => {
  it("serves a version's content with pinned references (A§4.2)", async () => {
    const response = await call(
      "/projects/p-baseline/workflows/wf-chain/versions/sha256:wf-v1",
    );
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body).toMatchObject({
      meta: { hash: "sha256:wf-v1", sourceId: "r-03" },
      content: { "@type": "type.googleapis.com/nebula.core.v1.Workflow" },
    });
    expect(JSON.stringify(body)).toContain('"versionHash":"sha256:geo-v1"');
    expect(
      (await call("/projects/p-baseline/workflows/wf-chain/versions/nope"))
        .status,
    ).toBe(404);
  });

  it("tessellates a geometry version", async () => {
    const version = await json(
      await call(
        "/projects/p-baseline/geometries/geo-main/tessellation?version=sha256:geo-v1",
      ),
    );
    expect((version.components as unknown[]).length).toBe(2);
    expect(
      (
        await call(
          "/projects/p-baseline/geometries/geo-main/tessellation?version=nope",
        )
      ).status,
    ).toBe(404);
  });

  it("lists templates for the project's concept and instantiates one", async () => {
    const listed = await json(
      await call("/projects/p-baseline/workflow-templates"),
    );
    const ids = (listed.templates as { id: string }[]).map((t) => t.id);
    expect(ids).toContain("wft-tokamak");
    expect(ids).not.toContain("wft-mirror");
    const created = await call(
      "/projects/p-baseline/workflows/instantiate",
      "POST",
      JSON.stringify({ templateId: "wft-chain", name: "From template" }),
    );
    expect(created.status).toBe(201);
    expect(await json(created)).toMatchObject({
      name: "From template",
      revision: 1,
      content: { templateId: "wft-chain" },
    });
    expect(
      (
        await call(
          "/projects/p-baseline/workflows/instantiate",
          "POST",
          JSON.stringify({ templateId: "wft-mirror" }),
        )
      ).status,
    ).toBe(422);
  });

  it("validates the workflow draft (A§3.4)", async () => {
    const response = await call(
      "/projects/p-baseline/workflows/wf-chain/validate",
      "POST",
      JSON.stringify({ gpus: 3 }),
    );
    const { issues } = (await json(response)) as {
      issues: { path: string; code: string }[];
    };
    // geo-main's feed circuit is an open lead (D145); 3 GPUs is no rank
    // count of T1 (D116).
    expect(issues.map((i) => `${i.path} ${i.code}`)).toEqual([
      "nodes/field/ports/geometry circuit",
      "nodes/t1 rank_count",
    ]);
  });

  it("ingests HDF5 uploads and refuses other files (D144)", async () => {
    const hdf5 = new Uint8Array([
      0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2,
    ]);
    const created = await call(
      "/projects/p-baseline/inputs?name=shot.h5&sub_contract=Equilibrium.Axisym2D",
      "POST",
      hdf5,
      "application/x-hdf5",
    );
    expect(created.status).toBe(201);
    expect(await json(created)).toMatchObject({
      name: "shot.h5",
      subContract: "Equilibrium.Axisym2D",
      sizeBytes: "10",
    });
    const refused = await call(
      "/projects/p-baseline/inputs?name=x&sub_contract=A",
      "POST",
      new Uint8Array([1, 2, 3]),
      "application/x-hdf5",
    );
    expect(refused.status).toBe(422);
    const listed = await json(await call("/projects/p-baseline/inputs"));
    expect((listed.datasets as unknown[]).length).toBe(2);
  });

  it("lists runs and their committed outputs", async () => {
    const runs = await json(await call("/projects/p-baseline/runs"));
    expect((runs.runs as { id: string }[]).map((r) => r.id)).toEqual([
      "r-12",
      "r-11",
      "r-03",
    ]);
    const outputs = await json(
      await call("/projects/p-baseline/runs/r-11/outputs"),
    );
    expect((outputs.outputs as unknown[]).length).toBe(5);
    expect((await call("/projects/p-baseline/runs/nope/outputs")).status).toBe(
      404,
    );
  });
});
