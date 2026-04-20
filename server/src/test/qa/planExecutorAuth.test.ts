import { describe, it, expect } from "vitest";
import { requiresPlatformAdmin } from "../../../scripts/qa/ai/planExecutor.js";

describe("planExecutor platform-admin path routing", () => {
  it.each([
    "/api/admin/global-knowledge/categories",
    "/api/admin/global-knowledge/documents",
    "/api/admin/platform-settings",
    "/api/admin/platform-settings/feature-flags",
    "/api/admin/ai-prompts",
    "/api/admin/ai-prompts/active",
    "/api/admin/release-notes",
    "/api/admin/insight-feedback/summary",
    "/api/admin/tenant-config-transfer/history",
  ])("marks %s as platform-admin-only", (path) => {
    expect(requiresPlatformAdmin(path)).toBe(true);
  });

  it.each([
    "/api/admin/tenants",
    "/api/admin/tenants/abc-123/users",
    "/api/admin/users",
    "/api/workbench/canvases",
    "/api/insights/summary",
    "/api/auth/me",
    "/api/admin",
  ])("keeps %s on the tenant-admin token", (path) => {
    expect(requiresPlatformAdmin(path)).toBe(false);
  });
});
