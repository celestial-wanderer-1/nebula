// @vitest-environment node
import { readFileSync } from "node:fs";
import {
  createFileRegistry,
  fromBinary,
  getExtension,
} from "@bufbuild/protobuf";
import {
  FileDescriptorSetSchema,
  file_google_protobuf_descriptor,
} from "@bufbuild/protobuf/wkt";
import { assert, describe, expect, it } from "vitest";
import {
  EntityKind,
  file_nebula_core_v1_entity,
} from "../gen/nebula/core/v1/entity_pb";
import {
  file_nebula_core_v1_options,
  quantity,
  ui,
} from "../gen/nebula/core/v1/options_pb";

const fixture = fromBinary(
  FileDescriptorSetSchema,
  readFileSync(new URL("../mocks/fixtures/acme-demo.binpb", import.meta.url)),
);
const coreFiles = [
  file_nebula_core_v1_entity,
  file_nebula_core_v1_options,
  file_google_protobuf_descriptor,
];
const pluginFile = fixture.file[0];
assert(pluginFile);
const registry = createFileRegistry(pluginFile, (name) =>
  coreFiles.find((file) => file.proto.name === name),
);

describe("generated plugin descriptor fixture", () => {
  it("excludes imported files and resolves references against core descriptors", () => {
    expect(fixture.file.map((file) => file.name)).toEqual([
      "acme/demo/v1/demo.proto",
    ]);
    const config = registry.getMessage("acme.demo.v1.DemoSolverConfig");
    assert(config);
    const geometry = config.field.geometry;
    assert(geometry?.fieldKind === "message");
    expect(geometry.message.typeName).toBe("nebula.core.v1.EntityRef");
  });

  it("preserves custom options, including zero bounds and an absent upper bound", () => {
    const config = registry.getMessage("acme.demo.v1.DemoSolverConfig");
    assert(config);
    const tolerance = config.field.tolerance?.proto.options;
    assert(tolerance);
    expect(getExtension(tolerance, quantity)).toMatchObject({
      min: 1e-14,
      max: 1e-2,
    });
    expect(getExtension(tolerance, ui).defaultJson).toBe("1e-8");

    const boundary = registry.getMessage("acme.demo.v1.FixedBoundary");
    const radius = boundary?.field.minorRadius?.proto.options;
    assert(radius);
    const bounds = getExtension(radius, quantity);
    expect(bounds.min).toBe(0);
    expect(bounds.max).toBeUndefined();
  });

  it("preserves the target kind of entity references", () => {
    const config = registry.getMessage("acme.demo.v1.DemoSolverConfig");
    const options = config?.field.geometry?.proto.options;
    assert(options);
    expect(getExtension(options, ui).refKind).toBe(EntityKind.GEOMETRY);
  });

  it("retains future core options for the read-only fallback", () => {
    const config = registry.getMessage("acme.demo.v1.DemoSolverConfig");
    assert(config);
    const options = config.field.futureField?.proto.options;
    assert(options);
    expect(options.$unknown?.some((field) => field.no === 50999)).toBe(true);
  });
});
