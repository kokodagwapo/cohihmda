import type { Response } from "express";

/**
 * Start a periodic SSE keepalive that sends a comment every 30s.
 * Prevents CloudFront / ALB from killing the connection during
 * long-running LLM calls where no data events are emitted.
 * Returns a cleanup function to stop the heartbeat.
 */
export function startSSEHeartbeat(res: Response): () => void {
  const interval = setInterval(() => {
    try {
      res.write(":heartbeat\n\n");
    } catch {
      clearInterval(interval);
    }
  }, 30_000);
  return () => clearInterval(interval);
}
