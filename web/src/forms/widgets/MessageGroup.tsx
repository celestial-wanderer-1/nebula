import * as Collapsible from "@radix-ui/react-collapsible";
import type { DescField, DescMessage } from "@bufbuild/protobuf";
import { fieldLabel, uiHintOf } from "../../schema/annotations";
import { newMessage } from "../defaults";
import { MessageFields, type MessageValue } from "../MessageFields";

/**
 * A nested message as a collapsible group. An unset message shows its
 * defaults; the first edit sets it.
 */
export function MessageGroup({
  field,
  desc,
  value,
  onChange,
  path,
}: {
  field: DescField;
  desc: DescMessage;
  value: MessageValue | undefined;
  onChange: (value: MessageValue) => void;
  path: string;
}) {
  const help = uiHintOf(field).help;
  return (
    <Collapsible.Root defaultOpen className="group" data-path={path}>
      <Collapsible.Trigger className="group-trigger">
        {fieldLabel(field)}
      </Collapsible.Trigger>
      <Collapsible.Content className="group-content">
        {help && <p className="field-help">{help}</p>}
        <MessageFields
          desc={desc}
          value={value ?? (newMessage(desc) as MessageValue)}
          onChange={onChange}
          path={path}
        />
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
