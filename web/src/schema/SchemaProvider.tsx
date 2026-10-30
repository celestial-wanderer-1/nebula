import type { ReactNode } from "react";
import { SchemaContext } from "./context";
import type { SchemaRegistry } from "./registry";

export function SchemaProvider({
  registry,
  children,
}: {
  registry: SchemaRegistry;
  children: ReactNode;
}) {
  return (
    <SchemaContext.Provider value={registry}>{children}</SchemaContext.Provider>
  );
}
