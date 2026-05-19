/**
 * SSE stream emission with block.delta support (COHI-388).
 */

import type { Response } from "express";
import { validateUnifiedStreamEvent } from "./unifiedChatSchemas.js";

export function writeSseData(res: Response, payload: unknown) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function makeEmitter(res: Response) {
  return (ev: Record<string, unknown>) => {
    if (!validateUnifiedStreamEvent(ev)) {
      console.warn(
        "[chat/v1 stream] Event failed schema validation:",
        validateUnifiedStreamEvent.errors,
        ev,
      );
      throw new Error("stream_event_schema_invalid");
    }
    writeSseData(res, ev);
  };
}

const DELTA_CHUNK = 120;

function* chunkText(text: string): Generator<string> {
  for (let i = 0; i < text.length; i += DELTA_CHUNK) {
    yield text.slice(i, i + DELTA_CHUNK);
  }
}

export type StreamEmitter = (ev: Record<string, unknown>) => void;

export function createStreamEmitter(res: Response): StreamEmitter {
  return makeEmitter(res);
}

export function emitValidatedStreamWithDeltas(
  res: Response,
  conversationId: string,
  turnId: string,
  blocks: Array<Record<string, unknown>>,
  streamMetadata?: Record<string, unknown>,
  opts?: {
    /** When true, text block skips synthetic chunking (caller already emitted token deltas). */
    skipTextDeltas?: boolean;
    /** Reuse an emitter that already sent turn.started / block.started for index 0. */
    emit?: StreamEmitter;
    skipTurnStarted?: boolean;
    /** Block index that already received block.started (and optional deltas). */
    primedTextBlockIndex?: number;
  },
) {
  const emit = opts?.emit ?? makeEmitter(res);
  if (!opts?.skipTurnStarted) {
    emit({ event: "turn.started", conversationId, turnId });
  }

  blocks.forEach((block, blockIndex) => {
    const rawType = String(block.type || "text");
    const allowedBt = new Set([
      "text",
      "citations",
      "visualization",
      "actions",
      "artifacts",
      "navigation_hints",
      "safety",
    ]);
    const blockType = allowedBt.has(rawType) ? rawType : "text";

    if (opts?.primedTextBlockIndex !== blockIndex) {
      emit({
        event: "block.started",
        conversationId,
        turnId,
        blockIndex,
        blockType,
      });
    }

    if (
      blockType === "text" &&
      typeof block.markdown === "string" &&
      !(opts?.skipTextDeltas && blockIndex === 0)
    ) {
      for (const delta of chunkText(block.markdown)) {
        emit({
          event: "block.delta",
          conversationId,
          turnId,
          blockIndex,
          blockType,
          delta,
        });
      }
    }

    emit({
      event: "block.completed",
      conversationId,
      turnId,
      blockIndex,
      blockType,
      block,
    });
  });

  emit({
    event: "turn.completed",
    conversationId,
    turnId,
    metadata: streamMetadata ?? {},
  });
}
