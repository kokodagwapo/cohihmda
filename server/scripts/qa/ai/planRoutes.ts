/**
 * Pure app-route helpers for the AC validator. Kept free of Playwright and
 * Node.js `fs` imports so the backend's predeploy Vitest suite can unit-test
 * them without pulling in `@playwright/test` (an E2E-only devDependency that
 * is not installed in the `server/` workspace).
 */

/**
 * Build the app-relative URL that opens an individual workbench canvas in the
 * editor. The editor route is `/my-dashboard/:canvasId`; `/workbench/:canvasId`
 * does NOT exist (the `/workbench/*` tree only serves hub sub-pages). Getting
 * this wrong silently makes every canvas-scoped Playwright locator fail
 * because React Router falls through to a catch-all and the canvas toolbar
 * (with `data-testid="workbench-canvas-title-input"` et al.) never mounts.
 *
 * See `src/App.tsx` for the authoritative route table.
 */
export function buildSeededCanvasUrl(canvasId: string): string {
  const trimmed = canvasId.trim();
  if (!trimmed) {
    throw new Error("buildSeededCanvasUrl: canvasId is required");
  }
  return `/my-dashboard/${trimmed}`;
}
