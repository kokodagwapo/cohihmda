import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock, notifyMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  notifyMock: vi.fn(),
}));

vi.mock("../middleware/auth.js", () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.userId = "11111111-1111-1111-1111-111111111111";
    req.userEmail = "user@example.com";
    req.userRole = "user";
    next();
  },
}));

vi.mock("../middleware/tenantContext.js", () => ({
  attachTenantContext: (_req: any, _res: any, next: any) => next(),
  getTenantContext: () => ({
    tenantPool: { query: queryMock },
    tenantId: "tenant-test",
    tenantInfo: { name: "Tenant Test" },
  }),
}));

vi.mock("../services/feedbackNotificationService.js", () => ({
  notifySuperAdminsOfFeedback: notifyMock,
}));

import feedbackRoutes from "./feedback.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/feedback", feedbackRoutes);
  return app;
}

describe("feedback attachment validations", () => {
  const app = buildApp();

  beforeEach(() => {
    queryMock.mockReset();
    notifyMock.mockReset();
    notifyMock.mockResolvedValue({ recipients: [], sent: [], failed: [] });
  });

  it("rejects more than 5 files", async () => {
    const req = request(app)
      .post("/api/feedback")
      .field("area", "insights")
      .field("description", "Too many files");

    for (let i = 0; i < 6; i += 1) {
      req.attach("files", Buffer.from(`file-${i}`), {
        filename: `sample-${i}.csv`,
        contentType: "text/csv",
      });
    }

    const res = await req;
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Maximum 5 files allowed");
  });

  it("rejects image files larger than 10MB", async () => {
    const bigImage = Buffer.alloc(10 * 1024 * 1024 + 1, 1);
    const res = await request(app)
      .post("/api/feedback")
      .field("area", "insights")
      .field("description", "Big image")
      .attach("files", bigImage, {
        filename: "big-image.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(400);
    expect(String(res.body.error || "")).toContain("File is too large");
  });

  it("returns 429 when tenant active attachment cap is exceeded", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT COUNT(*)::int AS count") && sql.includes("user_feedback_attachments")) {
        return { rows: [{ count: 2500 }] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post("/api/feedback")
      .field("area", "insights")
      .field("description", "Cap exceeded")
      .attach("files", Buffer.from("a,b\n1,2"), {
        filename: "sample.csv",
        contentType: "text/csv",
      });

    expect(res.status).toBe(429);
    expect(String(res.body.error || "")).toContain("maximum");
  });

  it("forbids downloading someone else's attachment", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM user_feedback") && sql.includes("WHERE id = $1")) {
        return { rows: [{ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", user_id: "22222222-2222-2222-2222-222222222222" }] };
      }
      return { rows: [] };
    });

    const res = await request(app).get(
      "/api/feedback/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/attachments/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/download",
    );

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Forbidden");
  });
});
