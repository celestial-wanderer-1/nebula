import { create, toJsonString } from "@bufbuild/protobuf";
import { ws } from "msw";
import { describe, expect, it, vi } from "vitest";
import {
  QueueEventSchema,
  type QueueEvent,
} from "../gen/nebula/core/v1/queue_pb";
import { server } from "../mocks/node";
import { WS_CLOSE_UNAUTHORIZED, WsManager } from "./manager";

function manager(token = "mock-token") {
  const timers: { callback: () => void; ms: number }[] = [];
  const instance = new WsManager({
    getToken: () => token,
    random: () => 0,
    setTimer: (callback, ms) => {
      timers.push({ callback, ms });
      return timers.length;
    },
    clearTimer: () => undefined,
  });
  return { instance, timers };
}

const summaryFrame = (running: number) =>
  toJsonString(
    QueueEventSchema,
    create(QueueEventSchema, {
      event: { case: "summary", value: { running } },
    }),
  );

describe("WsManager", () => {
  it("sends the token subprotocol and decodes frames", async () => {
    const { instance } = manager();
    const received: QueueEvent[] = [];
    const off = instance.subscribe("/ws/queue", QueueEventSchema, (event) =>
      received.push(event),
    );
    // The queue channel opens with the counts, then the queue itself.
    await vi.waitFor(() => expect(received).toHaveLength(2));
    expect(received.map((e) => e.event.case)).toEqual(["summary", "entries"]);
    off();
  });

  it("does not retry a rejected token", async () => {
    const { instance, timers } = manager("wrong");
    const closed = vi.fn();
    const link = ws.link(/\/ws\/queue$/);
    server.use(
      link.addEventListener("connection", ({ client }) => {
        client.addEventListener("close", closed);
      }),
    );
    const off = instance.subscribe("/ws/queue", QueueEventSchema, () => {});
    await vi.waitFor(() => expect(instance.isOpen("/ws/queue")).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(timers).toHaveLength(0);
    off();
    expect(WS_CLOSE_UNAUTHORIZED).toBe(4401);
  });

  it("reconnects with backoff and asks subscribers to refetch", async () => {
    const { instance, timers } = manager();
    let connections = 0;
    const link = ws.link(/\/ws\/flaky$/);
    server.use(
      link.addEventListener("connection", ({ client }) => {
        connections += 1;
        client.send(summaryFrame(connections));
        if (connections === 1) {
          setTimeout(() => client.close(1011, "server restart"), 20);
        }
      }),
    );
    const onReconnect = vi.fn();
    const frames: number[] = [];
    const off = instance.subscribe(
      "/ws/flaky",
      QueueEventSchema,
      (event) =>
        event.event.case === "summary" &&
        frames.push(event.event.value.running),
      onReconnect,
    );

    await vi.waitFor(() => expect(timers).toHaveLength(1));
    // First retry waits between half and all of the 500 ms base.
    expect(timers[0]?.ms).toBe(250);
    expect(onReconnect).not.toHaveBeenCalled();

    timers[0]?.callback();
    await vi.waitFor(() => expect(onReconnect).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(frames).toEqual([1, 2]));
    off();
  });

  it("grows the backoff exponentially up to the cap", async () => {
    const { instance, timers } = manager();
    const link = ws.link(/\/ws\/down$/);
    server.use(
      link.addEventListener("connection", ({ client }) =>
        queueMicrotask(() => client.close(1011, "down")),
      ),
    );
    const off = instance.subscribe("/ws/down", QueueEventSchema, () => {});
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await vi.waitFor(() => expect(timers).toHaveLength(attempt + 1));
      timers[attempt]?.callback();
    }
    expect(timers.map((t) => t.ms)).toEqual([
      250, 500, 1000, 2000, 4000, 8000, 15000, 15000,
    ]);
    off();
  });

  it("shares one connection per channel and closes it with the last subscriber", async () => {
    const { instance } = manager();
    let connections = 0;
    const closed = vi.fn();
    const link = ws.link(/\/ws\/shared$/);
    server.use(
      link.addEventListener("connection", ({ client }) => {
        connections += 1;
        client.addEventListener("close", closed);
      }),
    );
    const a = instance.subscribe("/ws/shared", QueueEventSchema, () => {});
    const b = instance.subscribe("/ws/shared", QueueEventSchema, () => {});
    await vi.waitFor(() => expect(instance.isOpen("/ws/shared")).toBe(true));
    expect(connections).toBe(1);

    a();
    expect(instance.isOpen("/ws/shared")).toBe(true);
    b();
    await vi.waitFor(() => expect(closed).toHaveBeenCalled());
    expect(instance.isOpen("/ws/shared")).toBe(false);
  });

  it("drops malformed frames and keeps going", async () => {
    const { instance } = manager();
    const link = ws.link(/\/ws\/noisy$/);
    server.use(
      link.addEventListener("connection", ({ client }) => {
        client.send("{not json");
        client.send(summaryFrame(7));
      }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const frames: QueueEvent[] = [];
    const off = instance.subscribe("/ws/noisy", QueueEventSchema, (event) =>
      frames.push(event),
    );
    await vi.waitFor(() => expect(frames).toHaveLength(1));
    expect(warn).toHaveBeenCalled();
    off();
  });
});
