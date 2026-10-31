import {
  create,
  type DescMessage,
  type Message,
  type Registry,
} from "@bufbuild/protobuf";
import {
  anyPack,
  anyUnpack,
  AnySchema,
  type Any,
} from "@bufbuild/protobuf/wkt";
import { typeNameOf } from "../entities/content";
import {
  EntityRefSchema,
  type EntityRef,
} from "../gen/nebula/core/v1/entity_pb";

type Fields = Record<string, unknown>;

/**
 * Rewrites every EntityRef inside a message, including inside Any values
 * the registry can resolve (step configs of plugins, for example). Used to
 * pin references when versions are minted (A§4.2). Returns a new message;
 * the input is not changed.
 */
export function mapRefs(
  content: Any,
  registry: Registry,
  map: (ref: EntityRef) => EntityRef,
): Any {
  const desc = registry.getMessage(typeNameOf(content));
  const message = desc && anyUnpack(content, desc);
  if (!desc || !message) return content;
  return anyPack(desc, visitMessage(desc, message, registry, map));
}

function visitValue(
  desc: DescMessage,
  value: unknown,
  registry: Registry,
  map: (ref: EntityRef) => EntityRef,
): unknown {
  if (value === undefined || value === null) return value;
  if (desc.typeName === EntityRefSchema.typeName) {
    return map(value as EntityRef);
  }
  if (desc.typeName === AnySchema.typeName) {
    return mapRefs(value as Any, registry, map);
  }
  return visitMessage(desc, value as Message, registry, map);
}

function visitMessage<T extends Message>(
  desc: DescMessage,
  message: T,
  registry: Registry,
  map: (ref: EntityRef) => EntityRef,
): T {
  const out = { ...(message as unknown as Fields) };
  for (const field of desc.fields) {
    const visit = (value: unknown) =>
      field.message ? visitValue(field.message, value, registry, map) : value;
    if (field.oneof) {
      const held = out[field.oneof.localName] as
        { case?: string; value?: unknown } | undefined;
      if (held?.case === field.localName && field.fieldKind === "message") {
        out[field.oneof.localName] = {
          case: held.case,
          value: visit(held.value),
        };
      }
      continue;
    }
    const value = out[field.localName];
    switch (field.fieldKind) {
      case "message":
        out[field.localName] = visit(value);
        break;
      case "list":
        if (field.listKind === "message") {
          out[field.localName] = (value as unknown[]).map(visit);
        }
        break;
      case "map":
        if (field.mapKind === "message") {
          out[field.localName] = Object.fromEntries(
            Object.entries(value as Fields).map(([k, v]) => [k, visit(v)]),
          );
        }
        break;
      default:
        break;
    }
  }
  return out as unknown as T;
}

export function pinnedRef(ref: EntityRef, versionHash: string): EntityRef {
  return create(EntityRefSchema, {
    kind: ref.kind,
    id: ref.id,
    state: { case: "pinned", value: { versionHash } },
  });
}
