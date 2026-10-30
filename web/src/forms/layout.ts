import type { DescField, DescMessage, DescOneof } from "@bufbuild/protobuf";
import { uiHintOf } from "../schema/annotations";

export type LayoutItem =
  | { kind: "field"; field: DescField }
  | { kind: "oneof"; oneof: DescOneof; fields: DescField[] };

export interface LayoutGroup {
  /** The `ui.group` name; empty for fields without a group. */
  name: string;
  items: LayoutItem[];
}

interface Sortable {
  item: LayoutItem;
  order: number;
  number: number;
  group: string;
}

/**
 * Arranges a message's fields for a generated form (docs/UI.md Section 5):
 * hidden fields are dropped, the rest ordered by `ui.order` then field number
 * and gathered by `ui.group`. Ungrouped fields come first; groups follow in
 * the order of their first field. A oneof stays together and takes the
 * group and order of its first visible member.
 */
export function layoutMessage(desc: DescMessage): LayoutGroup[] {
  const sortable: Sortable[] = [];
  for (const member of desc.members) {
    if (member.kind === "field") {
      const hint = uiHintOf(member);
      if (hint.hidden) continue;
      sortable.push({
        item: { kind: "field", field: member },
        order: hint.order,
        number: member.number,
        group: hint.group,
      });
    } else {
      const fields = member.fields.filter((field) => !uiHintOf(field).hidden);
      const first = fields[0];
      if (!first) continue;
      const hint = uiHintOf(first);
      sortable.push({
        item: { kind: "oneof", oneof: member, fields },
        order: Math.min(...fields.map((field) => uiHintOf(field).order)),
        number: first.number,
        group: hint.group,
      });
    }
  }
  sortable.sort((a, b) => a.order - b.order || a.number - b.number);

  const groups: LayoutGroup[] = [{ name: "", items: [] }];
  for (const { item, group } of sortable) {
    let target = groups.find((g) => g.name === group);
    if (!target) {
      target = { name: group, items: [] };
      groups.push(target);
    }
    target.items.push(item);
  }
  return groups.filter((group) => group.items.length > 0);
}
