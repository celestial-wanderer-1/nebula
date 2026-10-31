import {
  fromJsonString,
  type DescMessage,
  type MessageShape,
  type Registry,
} from "@bufbuild/protobuf";

/** Subprotocol naming the wire format; the server echoes it. */
export const WS_PROTOCOL = "nebula.v1";
/** Prefix of the subprotocol that carries the token (D137). */
export const WS_TOKEN_PREFIX = "nebula.token.";
/** Close code the server uses for a missing or rejected token. */
export const WS_CLOSE_UNAUTHORIZED = 4401;

export interface WsManagerOptions {
  getToken: () => string | undefined;
  getRegistry?: () => Registry | undefined;
  /** Base and cap of the reconnect backoff, in milliseconds. */
  backoffMs?: { base: number; max: number };
  random?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  origin?: () => string;
}

interface Subscriber {
  onMessage: (data: string) => void;
  onReconnect?: () => void;
}

interface Channel {
  readonly path: string;
  readonly subscribers: Set<Subscriber>;
  socket?: WebSocket;
  /** Consecutive failed attempts since the last successful open. */
  attempt: number;
  /** Set once the channel has been open, so later opens are reconnects. */
  wasOpen: boolean;
  timer?: unknown;
  /** Frames sent while connecting, flushed on open. */
  outbox: string[];
}

/**
 * One connection per channel path (docs/UI.md Section 4.3). Channels open when
 * the first subscriber arrives and close with the last one. Dropped
 * connections reconnect with exponential backoff; because missed events are
 * not replayed, subscribers get `onReconnect` to refetch what they cache.
 */
export class WsManager {
  private readonly channels = new Map<string, Channel>();
  private readonly options: Required<Omit<WsManagerOptions, "getRegistry">> &
    Pick<WsManagerOptions, "getRegistry">;

  constructor(options: WsManagerOptions) {
    this.options = {
      backoffMs: { base: 500, max: 30_000 },
      random: Math.random,
      setTimer: (callback, ms) => setTimeout(callback, ms),
      clearTimer: (handle) =>
        clearTimeout(handle as ReturnType<typeof setTimeout>),
      origin: () => window.location.origin,
      ...options,
    };
  }

  /**
   * Subscribes to a channel whose frames are protobuf JSON of `schema`.
   * Frames that do not decode are dropped. Returns the unsubscribe function.
   */
  subscribe<Desc extends DescMessage>(
    path: string,
    schema: Desc,
    listener: (message: MessageShape<Desc>) => void,
    onReconnect?: () => void,
  ): () => void {
    const subscriber: Subscriber = {
      onMessage: (data) => {
        let message: MessageShape<Desc>;
        try {
          message = fromJsonString(schema, data, {
            ignoreUnknownFields: true,
            registry: this.options.getRegistry?.(),
          });
        } catch (error) {
          console.warn(`Dropped malformed frame on ${path}`, error);
          return;
        }
        listener(message);
      },
      onReconnect,
    };
    let channel = this.channels.get(path);
    if (!channel) {
      channel = {
        path,
        subscribers: new Set(),
        attempt: 0,
        wasOpen: false,
        outbox: [],
      };
      this.channels.set(path, channel);
      this.connect(channel);
    }
    channel.subscribers.add(subscriber);

    return () => {
      const current = this.channels.get(path);
      if (!current) return;
      current.subscribers.delete(subscriber);
      if (current.subscribers.size === 0) {
        this.closeChannel(current);
      }
    };
  }

  /**
   * Sends a frame on a subscribed channel, such as a view request (docs/UI.md
   * Section 4.3). Frames sent while connecting go out once it opens; a
   * channel nobody subscribes to has no connection, so it returns false.
   */
  send(path: string, data: string): boolean {
    const channel = this.channels.get(path);
    if (!channel) return false;
    if (channel.socket?.readyState === WebSocket.OPEN) {
      channel.socket.send(data);
    } else {
      channel.outbox.push(data);
    }
    return true;
  }

  /** Whether a channel currently has an open connection. */
  isOpen(path: string): boolean {
    return this.channels.get(path)?.socket?.readyState === WebSocket.OPEN;
  }

  /** Closes every channel, for example when the app unmounts. */
  close(): void {
    for (const channel of [...this.channels.values()]) {
      this.closeChannel(channel);
    }
  }

  private url(path: string): string {
    const url = new URL(path, this.options.origin());
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  }

  private connect(channel: Channel): void {
    channel.timer = undefined;
    const token = this.options.getToken();
    const protocols = token
      ? [WS_PROTOCOL, `${WS_TOKEN_PREFIX}${token}`]
      : [WS_PROTOCOL];
    const socket = new WebSocket(this.url(channel.path), protocols);
    channel.socket = socket;

    socket.addEventListener("open", () => {
      const reconnected = channel.wasOpen || channel.attempt > 0;
      channel.attempt = 0;
      channel.wasOpen = true;
      for (const frame of channel.outbox.splice(0)) socket.send(frame);
      if (reconnected) {
        for (const subscriber of channel.subscribers) {
          subscriber.onReconnect?.();
        }
      }
    });
    socket.addEventListener("message", (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      for (const subscriber of channel.subscribers) {
        subscriber.onMessage(event.data);
      }
    });
    socket.addEventListener("close", (event: CloseEvent) => {
      if (channel.socket !== socket) return;
      channel.socket = undefined;
      // A rejected token does not heal by retrying; the user reopens the URL.
      if (event.code === WS_CLOSE_UNAUTHORIZED) {
        console.warn(`Token rejected on ${channel.path}`);
        return;
      }
      if (this.channels.get(channel.path) === channel) {
        this.scheduleReconnect(channel);
      }
    });
  }

  private scheduleReconnect(channel: Channel): void {
    const { base, max } = this.options.backoffMs;
    const ceiling = Math.min(max, base * 2 ** channel.attempt);
    // Jitter in [ceiling/2, ceiling) keeps clients from reconnecting in step.
    const delay = ceiling / 2 + (ceiling / 2) * this.options.random();
    channel.attempt += 1;
    channel.timer = this.options.setTimer(() => this.connect(channel), delay);
  }

  private closeChannel(channel: Channel): void {
    this.channels.delete(channel.path);
    if (channel.timer !== undefined) {
      this.options.clearTimer(channel.timer);
      channel.timer = undefined;
    }
    const socket = channel.socket;
    channel.socket = undefined;
    if (
      socket &&
      (socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING)
    ) {
      socket.close(1000, "unsubscribed");
    }
  }
}
