// Augment Express Request to carry a first-class request correlation ID.
// This is set by server/src/middleware/requestId.ts before any other middleware
// so every handler can access req.id without casting through `any`.
declare namespace Express {
  interface Request {
    id: string;
  }
}
