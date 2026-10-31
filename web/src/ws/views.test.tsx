import {
  create,
  fromJsonString,
  type DescMessage,
  type MessageShape,
} from "@bufbuild/protobuf";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  OutputRefSchema,
  ViewerKind,
  ViewParamsSchema,
  ViewReplySchema,
  ViewRequestSchema,
  type ViewReply,
} from "../gen/nebula/core/v1/view_pb";
import { WsContext } from "./context";
import type { WsManager } from "./manager";
import { useViewJob, VIEWS_CHANNEL } from "./views";

/** A manager that records frames and lets the test deliver replies. */
function fakeManager() {
  const sent: string[] = [];
  let listener: ((message: ViewReply) => void) | undefined;
  let reconnect: (() => void) | undefined;
  const manager = {
    subscribe<Desc extends DescMessage>(
      path: string,
      _schema: Desc,
      onMessage: (message: MessageShape<Desc>) => void,
      onReconnect?: () => void,
    ) {
      expect(path).toBe(VIEWS_CHANNEL);
      listener = onMessage as unknown as (message: ViewReply) => void;
      reconnect = onReconnect;
      return () => undefined;
    },
    send(_path: string, data: string) {
      sent.push(data);
      return true;
    },
  } as unknown as WsManager;
  const requests = () =>
    sent.map((frame) => fromJsonString(ViewRequestSchema, frame));
  const reply = (requestId: string, title: string, cached = false) =>
    act(() =>
      listener?.(
        create(ViewReplySchema, {
          requestId,
          cached,
          result: { case: "payload", value: { title } },
        }),
      ),
    );
  return {
    manager,
    sent,
    requests,
    reply,
    reconnect: () => act(() => reconnect?.()),
  };
}

const output = create(OutputRefSchema, {
  runId: "r-1",
  nodeId: "t1",
  outputName: "equilibrium",
});

function render(fake: ReturnType<typeof fakeManager>) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <WsContext.Provider value={fake.manager}>{children}</WsContext.Provider>
  );
  return renderHook(
    ({ params }) => useViewJob("p", output, ViewerKind.CONTOUR_2D, params),
    { wrapper, initialProps: { params: create(ViewParamsSchema) } },
  );
}

describe("useViewJob (A§3.6)", () => {
  it("keeps the previous payload while a newer request is pending", () => {
    const fake = fakeManager();
    const { result, rerender } = render(fake);
    expect(result.current.pending).toBe(true);
    const [first] = fake.requests();
    fake.reply(first!.requestId, "levels: default");
    expect(result.current).toMatchObject({
      pending: false,
      payload: { title: "levels: default" },
    });

    rerender({ params: create(ViewParamsSchema, { isovalues: [0.5] }) });
    expect(result.current).toMatchObject({
      pending: true,
      payload: { title: "levels: default" },
    });
    const second = fake.requests()[1]!;
    expect(second.params?.isovalues).toEqual([0.5]);
    fake.reply(second.requestId, "levels: 0.5", true);
    expect(result.current).toMatchObject({
      pending: false,
      cached: true,
      payload: { title: "levels: 0.5" },
    });
  });

  it("drops replies to superseded requests", () => {
    const fake = fakeManager();
    const { result, rerender } = render(fake);
    rerender({ params: create(ViewParamsSchema, { maxPoints: 100 }) });
    const [stale, latest] = fake.requests();
    fake.reply(stale!.requestId, "stale");
    expect(result.current.payload).toBeUndefined();
    expect(result.current.pending).toBe(true);
    fake.reply(latest!.requestId, "latest");
    expect(result.current.payload?.title).toBe("latest");
  });

  it("does not resend an unchanged request, and resends a pending one after a reconnect", () => {
    const fake = fakeManager();
    const { rerender } = render(fake);
    rerender({ params: create(ViewParamsSchema) });
    expect(fake.sent).toHaveLength(1);
    fake.reconnect();
    expect(fake.sent).toHaveLength(2);
    expect(fake.sent[1]).toBe(fake.sent[0]);
    fake.reply(fake.requests()[0]!.requestId, "done");
    fake.reconnect();
    expect(fake.sent).toHaveLength(2);
  });
});
