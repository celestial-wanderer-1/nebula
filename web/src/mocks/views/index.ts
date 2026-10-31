import { create, toBinary } from "@bufbuild/protobuf";
import { anyUnpack } from "@bufbuild/protobuf/wkt";
import { EntityKind } from "../../gen/nebula/core/v1/entity_pb";
import { OutputKind } from "../../gen/nebula/core/v1/output_pb";
import { RegionSchema } from "../../gen/nebula/core/v1/region_pb";
import {
  ViewParamsSchema,
  ViewReplySchema,
  type ViewPayload,
  type ViewReply,
  type ViewRequest,
} from "../../gen/nebula/core/v1/view_pb";
import { contentHash } from "../hash";
import type { MockStore } from "../store";
import { buildPayload, ViewError } from "./builders";

// View jobs of the mock (A§3.6): a payload cache keyed by output, PostOp,
// view parameters and engine build (A§4.6); hits reply at once, misses
// after a short "GPU job".

export const VIEW_JOB_MS = 120;

export class ViewService {
  private readonly cache = new Map<string, ViewPayload>();

  constructor(private readonly store: MockStore) {}

  clear(): void {
    this.cache.clear();
  }

  /** The reply to a view request, and how long the job takes. */
  handle(request: ViewRequest): { reply: ViewReply; delayMs: number } {
    const fail = (code: string, message: string) => ({
      reply: create(ViewReplySchema, {
        requestId: request.requestId,
        result: { case: "error", value: { code, message } },
      }),
      delayMs: 0,
    });
    const ref = request.output;
    const run = ref && this.store.engine.run(ref.runId);
    const output = run
      ? this.store
          .runOutputs(run.id)
          .find((o) => o.nodeId === ref?.nodeId && o.name === ref.outputName)
      : undefined;
    if (
      !run ||
      !output ||
      (ref?.contentHash && ref.contentHash !== output.contentHash)
    ) {
      return fail("not_found", "Output not found");
    }
    if (output.kind === OutputKind.FIELD_OPERATOR) {
      return fail("not_viewable", "An operator output has no view");
    }
    const params = request.params ?? create(ViewParamsSchema);
    const key = contentHash(
      output.contentHash,
      request.postOp,
      String(request.viewer),
      toBinary(ViewParamsSchema, params),
      this.store.engineBuild,
    );
    const held = this.cache.get(key);
    if (held) {
      return {
        reply: create(ViewReplySchema, {
          requestId: request.requestId,
          result: { case: "payload", value: held },
          cached: true,
        }),
        delayMs: 0,
      };
    }
    const record =
      output.regionId &&
      this.store.entity(run.projectId, EntityKind.REGION, output.regionId);
    const regionContent =
      record &&
      (record.versionContents?.[record.versions[0]?.hash ?? ""] ??
        record.draft.content);
    const region = regionContent
      ? anyUnpack(regionContent, RegionSchema)
      : undefined;
    let payload: ViewPayload;
    try {
      payload = buildPayload(output, request.viewer, params, region);
    } catch (error) {
      if (error instanceof ViewError)
        return fail("not_viewable", error.message);
      throw error;
    }
    payload.key = key;
    this.cache.set(key, payload);
    return {
      reply: create(ViewReplySchema, {
        requestId: request.requestId,
        result: { case: "payload", value: payload },
      }),
      delayMs: VIEW_JOB_MS,
    };
  }
}
