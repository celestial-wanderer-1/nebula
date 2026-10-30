import type { Registry } from "@bufbuild/protobuf";
import { coreRegistry } from "../schema/core";

// Registry used to encode and decode `google.protobuf.Any` in JSON bodies. It
// starts with core types and gains plugin types once `/plugins` has loaded.
let typeRegistry: Registry = coreRegistry;

export function getTypeRegistry(): Registry {
  return typeRegistry;
}

export function setTypeRegistry(registry: Registry): void {
  typeRegistry = registry;
}
