/**
 * Session replay recording via rrweb. Chunks events and POSTs to /api/analytics/replay.
 * Sampling controlled by VITE_REPLAY_SAMPLE_RATE (0-1); dev defaults to 1.
 */

import { api } from "@/lib/api";
import { getSessionIdPublic, getIdentity } from "./analyticsService";

const CHUNK_INTERVAL_MS = 10000; // 10 seconds
const REPLAY_SAMPLE_RATE =
  typeof import.meta.env.VITE_REPLAY_SAMPLE_RATE !== "undefined"
    ? Number(import.meta.env.VITE_REPLAY_SAMPLE_RATE)
    : import.meta.env.DEV
      ? 1
      : 0.2;

let stopRecording: (() => void) | null = null;
let chunkTimer: ReturnType<typeof setInterval> | null = null;
let chunkIndex = 0;
let eventBuffer: unknown[] = [];

function shouldSample(): boolean {
  if (REPLAY_SAMPLE_RATE >= 1) return true;
  if (REPLAY_SAMPLE_RATE <= 0) return false;
  return Math.random() < REPLAY_SAMPLE_RATE;
}

async function sendReplayChunk(): Promise<void> {
  if (eventBuffer.length === 0) return;
  const identity = getIdentity();
  if (!identity) return;
  const sessionId = getSessionIdPublic();
  const payload = {
    sessionId,
    chunkIndex,
    eventsData: eventBuffer,
  };
  eventBuffer = [];
  chunkIndex += 1;
  try {
    const res = await api.fetchWithAuth("/api/analytics/replay", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.warn("[Replay] chunk upload failed", res.status);
  } catch (err) {
    console.warn("[Replay] chunk upload error", err);
  }
}

export async function startSessionReplay(): Promise<void> {
  if (!shouldSample()) return;
  const identity = getIdentity();
  if (!identity) return;
  try {
    const rrweb = await import("rrweb");
    const handler = (event: unknown) => {
      eventBuffer.push(event);
    };
    stopRecording = rrweb.record({
      emit: handler,
      maskAllText: true,
      blockClass: "rr-block",
      maskTextSelector: "*",
      maskInputOptions: {
        password: true,
      },
      ignoreClass: "rr-ignore",
      inlineStylesheet: true,
      recordCrossOriginIframes: false,
    });
    chunkIndex = 0;
    eventBuffer = [];
    chunkTimer = setInterval(() => {
      sendReplayChunk();
    }, CHUNK_INTERVAL_MS);
  } catch (err) {
    console.warn("[Replay] start failed", err);
  }
}

export function stopSessionReplay(): void {
  if (chunkTimer) {
    clearInterval(chunkTimer);
    chunkTimer = null;
  }
  if (eventBuffer.length > 0) {
    sendReplayChunk();
  }
  eventBuffer = [];
  if (stopRecording) {
    stopRecording();
    stopRecording = null;
  }
}
