import { createContext, useContext, useEffect, useRef } from "react";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import type { WsManager } from "./manager";

export const WsContext = createContext<WsManager | null>(null);

export function useWsManager(): WsManager {
  const manager = useContext(WsContext);
  if (!manager) {
    throw new Error("useWsManager requires a WsProvider");
  }
  return manager;
}

/**
 * Keeps a channel subscribed while the calling component is mounted. The
 * latest callbacks are used without resubscribing on every render.
 */
export function useChannel<Desc extends DescMessage>(
  path: string | undefined,
  schema: Desc,
  onMessage: (message: MessageShape<Desc>) => void,
  onReconnect?: () => void,
): void {
  const manager = useWsManager();
  const callbacks = useRef({ onMessage, onReconnect });
  useEffect(() => {
    callbacks.current = { onMessage, onReconnect };
  });
  useEffect(() => {
    if (!path) return;
    return manager.subscribe(
      path,
      schema,
      (message) => callbacks.current.onMessage(message),
      () => callbacks.current.onReconnect?.(),
    );
  }, [manager, path, schema]);
}
