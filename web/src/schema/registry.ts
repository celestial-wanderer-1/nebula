import {
  createFileRegistry,
  createRegistry,
  fromBinary,
  type DescEnum,
  type DescMessage,
  type FileRegistry,
  type Registry,
} from "@bufbuild/protobuf";
import {
  FileDescriptorSetSchema,
  type FileDescriptorProto,
} from "@bufbuild/protobuf/wkt";
import type { PluginInfo } from "../gen/nebula/core/v1/plugin_pb";
import { roleOf } from "./annotations";
import { coreFile, coreRegistry } from "./core";

/**
 * Builds the registry of one plugin version from the FileDescriptorSet that
 * `/plugins` returns. The set holds only the plugin's own files; imports of
 * core files resolve against the compiled-in core descriptors (D54, D133).
 */
export function buildPluginRegistry(descriptorSet: Uint8Array): FileRegistry {
  const set = fromBinary(FileDescriptorSetSchema, descriptorSet);
  const own = new Map<string, FileDescriptorProto>(
    set.file.map((file) => [file.name, file]),
  );
  const resolve = (name: string) => own.get(name) ?? coreFile(name);
  return createFileRegistry(
    ...set.file.map((file) => createFileRegistry(file, resolve)),
  );
}

export interface PluginPool {
  readonly id: string;
  readonly version: string;
  /** Unset when the descriptor set failed to load; see `error`. */
  readonly registry?: FileRegistry;
  readonly error?: string;
}

/**
 * The browser's descriptor registry (docs/UI.md Section 5): the core pool plus
 * one pool per plugin version, each layered over core. Plugin packages carry
 * the plugin ID and major version, so pools do not collide (D133).
 */
export class SchemaRegistry {
  readonly pools: readonly PluginPool[];
  /** Every pool merged, for resolving `google.protobuf.Any` in JSON. */
  readonly typeRegistry: Registry;

  constructor(plugins: readonly PluginInfo[] = []) {
    this.pools = plugins
      .filter((plugin) => plugin.descriptorSet.length > 0)
      .map((plugin) => {
        try {
          return {
            id: plugin.id,
            version: plugin.version,
            registry: buildPluginRegistry(plugin.descriptorSet),
          };
        } catch (error) {
          return {
            id: plugin.id,
            version: plugin.version,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      });
    this.typeRegistry = createRegistry(
      coreRegistry,
      ...this.pools.flatMap((pool) => (pool.registry ? [pool.registry] : [])),
    );
  }

  /**
   * Messages of core and of every plugin that declare a role, such as
   * "plasma_target", for Any fields restricted to it (`ui.any_role`).
   */
  messagesWithRole(role: string): DescMessage[] {
    const found = new Map<string, DescMessage>();
    for (const type of this.typeRegistry) {
      if (type.kind === "message" && roleOf(type) === role) {
        found.set(type.typeName, type);
      }
    }
    return [...found.values()];
  }

  getMessage(typeName: string): DescMessage | undefined {
    return this.typeRegistry.getMessage(typeName);
  }

  getEnum(typeName: string): DescEnum | undefined {
    return this.typeRegistry.getEnum(typeName);
  }
}
