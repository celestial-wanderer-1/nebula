import { useState, type InputHTMLAttributes } from "react";
import {
  formatNumber,
  parseNumber,
  type NumericKind,
  type NumericValue,
} from "../values";

/**
 * A number input that keeps the user's text while it does not parse yet
 * ("1e-", "-"), and reports values only once they parse. `validate` adds a
 * rule of the caller's; a value it rejects is held back like unparsed text.
 */
export function NumberInput({
  value,
  kind,
  onChange,
  onParseError,
  validate,
  ...rest
}: {
  value: NumericValue;
  kind: NumericKind;
  onChange: (value: NumericValue) => void;
  onParseError?: (error: string | undefined) => void;
  validate?: (value: NumericValue) => string | undefined;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [text, setText] = useState(formatNumber(value));
  const [shown, setShown] = useState(value);
  // Follow external changes unless the text already denotes the new value.
  if (shown !== value) {
    setShown(value);
    const parsed = parseNumber(text, kind);
    if (!parsed.ok || parsed.value !== value) setText(formatNumber(value));
  }
  return (
    <input
      {...rest}
      type="text"
      inputMode={kind.integer ? "numeric" : "decimal"}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        const parsed = parseNumber(event.target.value, kind);
        const error = parsed.ok ? validate?.(parsed.value) : parsed.error;
        onParseError?.(error);
        if (parsed.ok && !error) {
          setShown(parsed.value);
          onChange(parsed.value);
        }
      }}
    />
  );
}
