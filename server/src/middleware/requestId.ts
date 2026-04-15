import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

/**
 * Request ID middleware.
 *
 * Generates a UUID v4 correlation ID for every incoming request, attaches it
 * to req.id, and echoes it back in the X-Request-Id response header so callers
 * (and downstream log consumers) can correlate request/response/log lines by a
 * single stable key.
 *
 * If the inbound request already carries an X-Request-Id header (e.g. from a
 * trusted gateway or test harness), that value is reused rather than replaced.
 *
 * Placement: register this at the very top of the middleware stack in
 * server/src/index.ts, before Morgan, so access-log lines and all downstream
 * app/control-plane logs share the same ID.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const existing = req.headers['x-request-id'];
  const id = (typeof existing === 'string' && existing.length > 0) ? existing : randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}
