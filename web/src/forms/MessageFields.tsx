import * as Collapsible from "@radix-ui/react-collapsible";
import type { DescMessage } from "@bufbuild/protobuf";
import { FieldRenderer } from "./FieldRenderer";
import { layoutMessage, type LayoutItem } from "./layout";
import { joinPath } from "./validate";
import { OneofField } from "./widgets/OneofField";

export type MessageValue = Record<string, unknown>;

/** The fields of one message, ordered and grouped by its UI hints. */
export function MessageFields({
  desc,
  value,
  onChange,
  path,
}: {
  desc: DescMessage;
  value: MessageValue;
  onChange: (value: MessageValue) => void;
  path: string;
}) {
  const set = (localName: string, next: unknown) =>
    onChange({ ...value, [localName]: next });

  const renderItem = (item: LayoutItem) =>
    item.kind === "field" ? (
      <FieldRenderer
        key={item.field.localName}
        field={item.field}
        value={value[item.field.localName]}
        onChange={(next) => set(item.field.localName, next)}
        path={joinPath(path, item.field.name)}
      />
    ) : (
      <OneofField
        key={item.oneof.localName}
        oneof={item.oneof}
        fields={item.fields}
        value={value[item.oneof.localName] as OneofValue | undefined}
        onChange={(next) => set(item.oneof.localName, next)}
        path={path}
      />
    );

  return (
    <div className="message-fields">
      {layoutMessage(desc).map((group) =>
        group.name ? (
          <Collapsible.Root key={group.name} defaultOpen className="group">
            <Collapsible.Trigger className="group-trigger">
              {group.name}
            </Collapsible.Trigger>
            <Collapsible.Content className="group-content">
              {group.items.map(renderItem)}
            </Collapsible.Content>
          </Collapsible.Root>
        ) : (
          group.items.map(renderItem)
        ),
      )}
    </div>
  );
}

export interface OneofValue {
  case: string | undefined;
  value?: unknown;
}
