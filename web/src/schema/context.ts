import { createContext, useContext } from "react";
import type { SchemaRegistry } from "./registry";

export const SchemaContext = createContext<SchemaRegistry | null>(null);

export function useSchema(): SchemaRegistry {
  const registry = useContext(SchemaContext);
  if (!registry) {
    throw new Error("useSchema requires a SchemaProvider");
  }
  return registry;
}
