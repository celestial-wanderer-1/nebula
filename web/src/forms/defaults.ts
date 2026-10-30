import {
  create,
  mergeFromJson,
  type DescMessage,
  type JsonValue,
  type MessageShape,
} from "@bufbuild/protobuf";
import { uiHintOf } from "../schema/annotations";

/**
 * A new message with the `ui.default_json` defaults of its fields applied
 * (D87). A default that does not parse is skipped rather than fatal.
 */
export function newMessage<Desc extends DescMessage>(
  desc: Desc,
): MessageShape<Desc> {
  const message = create(desc);
  for (const field of desc.fields) {
    const json = uiHintOf(field).defaultJson;
    if (!json) continue;
    try {
      mergeFromJson(desc, message, {
        [field.jsonName]: JSON.parse(json) as JsonValue,
      });
    } catch (error) {
      console.warn(`Ignored default of ${field.toString()}`, error);
    }
  }
  return message;
}
