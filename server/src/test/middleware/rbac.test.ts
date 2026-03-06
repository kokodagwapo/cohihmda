import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import {
  isCanvasOnlyRequestAllowed,
  requireFullAccess,
  requirePlatformStaff,
  requireRole,
} from "../../middleware/rbac.js";

function mockRes() {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

describe("isCanvasOnlyRequestAllowed", () => {
  it("allows read on whitelisted paths", () => {
    expect(isCanvasOnlyRequestAllowed("/api/workbench/canvases", "GET")).toBe(true);
    expect(isCanvasOnlyRequestAllowed("/api/loans", "POST")).toBe(true);
  });

  it("blocks explicit mutation endpoint", () => {
    expect(isCanvasOnlyRequestAllowed("/api/loans/email-card", "POST")).toBe(false);
  });

  it("blocks non-whitelisted paths", () => {
    expect(isCanvasOnlyRequestAllowed("/api/admin/release-notes", "GET")).toBe(false);
  });
});

describe("requireRole", () => {
  it("returns 401 without user", async () => {
    const middleware = requireRole("tenant_admin");
    const req = { userId: undefined } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();
    await middleware(req as any, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 for role mismatch", async () => {
    const middleware = requireRole("tenant_admin");
    const req = {
      userId: "u1",
      userRole: "user",
      tenantId: "t1",
      path: "/x",
      get: vi.fn().mockReturnValue("vitest"),
    } as any;
    const res = mockRes();
    const next = vi.fn();
    await middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next for allowed role", async () => {
    const middleware = requireRole("tenant_admin");
    const req = { userId: "u1", userRole: "tenant_admin", tenantId: "t1", path: "/x" } as any;
    const res = mockRes();
    const next = vi.fn();
    await middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("requirePlatformStaff", () => {
  it("denies tenant admin", async () => {
    const middleware = requirePlatformStaff();
    const req = {
      userId: "u1",
      userRole: "tenant_admin",
      path: "/x",
      get: vi.fn().mockReturnValue("vitest"),
    } as any;
    const res = mockRes();
    const next = vi.fn();
    await middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows support", async () => {
    const middleware = requirePlatformStaff();
    const req = { userId: "u1", userRole: "support", path: "/x" } as any;
    const res = mockRes();
    const next = vi.fn();
    await middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("requireFullAccess", () => {
  it("blocks canvas_only user on disallowed path", async () => {
    const middleware = requireFullAccess();
    const req = {
      userId: "u1",
      userAccessMode: "canvas_only",
      originalUrl: "/api/admin/release-notes",
      method: "GET",
    } as any;
    const res = mockRes();
    const next = vi.fn();
    await middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("allows canvas_only user on allowed path", async () => {
    const middleware = requireFullAccess();
    const req = {
      userId: "u1",
      userAccessMode: "canvas_only",
      originalUrl: "/api/workbench/canvases",
      method: "GET",
    } as any;
    const res = mockRes();
    const next = vi.fn();
    await middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
