import { useEffect, useState, type ReactNode } from "react";
import { getTypeRegistry } from "../api/registry";
import { getToken } from "../api/token";
import { WsContext } from "./context";
import { WsManager } from "./manager";

export function WsProvider({
  manager,
  children,
}: {
  manager?: WsManager;
  children: ReactNode;
}) {
  const [owned] = useState(
    () => manager ?? new WsManager({ getToken, getRegistry: getTypeRegistry }),
  );
  useEffect(() => () => owned.close(), [owned]);
  return <WsContext.Provider value={owned}>{children}</WsContext.Provider>;
}
