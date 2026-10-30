import { createRegistry, type DescFile } from "@bufbuild/protobuf";
import {
  file_google_protobuf_any,
  file_google_protobuf_descriptor,
  file_google_protobuf_duration,
  file_google_protobuf_struct,
  file_google_protobuf_timestamp,
  file_google_protobuf_wrappers,
} from "@bufbuild/protobuf/wkt";

// Every generated core file. Core descriptors are compiled into the UI rather
// than fetched (D54), so new files under proto/ are picked up without edits.
const generated = import.meta.glob<Record<string, unknown>>(
  "../gen/**/*_pb.ts",
  { eager: true },
);

function isDescFile(value: unknown): value is DescFile {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "file"
  );
}

export const coreFiles: readonly DescFile[] = [
  file_google_protobuf_any,
  file_google_protobuf_descriptor,
  file_google_protobuf_duration,
  file_google_protobuf_struct,
  file_google_protobuf_timestamp,
  file_google_protobuf_wrappers,
  ...Object.values(generated).flatMap((module) =>
    Object.entries(module)
      .filter(([name, value]) => name.startsWith("file_") && isDescFile(value))
      .map(([, value]) => value as DescFile),
  ),
];

const coreFilesByName = new Map(
  coreFiles.map((file) => [file.proto.name, file]),
);

export function coreFile(name: string): DescFile | undefined {
  return coreFilesByName.get(name);
}

export const coreRegistry = createRegistry(...coreFiles);
