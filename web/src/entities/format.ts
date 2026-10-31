import { timestampDate, type Timestamp } from "@bufbuild/protobuf/wkt";

/** A timestamp as every page shows it; "—" when unset. */
export function formatTime(time: Timestamp | undefined): string {
  if (!time) return "—";
  return timestampDate(time).toLocaleString("en", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
