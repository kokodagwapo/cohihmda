import request from "supertest";
import { describe, expect, it } from "vitest";
import { createRoleHarnessApp } from "../appFactory.js";
import { tokenForRole } from "../tokenFactory.js";

const app = createRoleHarnessApp();

describe("Admin route contracts", () => {
  it("allows platform staff endpoint for support", async () => {
    const res = await request(app)
      .get("/api/admin/__functional/platform-report")
      .set("Authorization", `Bearer ${tokenForRole("support")}`);
    expect(res.status).toBe(200);
  });

  it("denies non-platform users on platform-only endpoints", async () => {
    const tenantAdmin = await request(app)
      .get("/api/admin/__functional/platform-report")
      .set("Authorization", `Bearer ${tokenForRole("tenant_admin")}`);
    const user = await request(app)
      .get("/api/admin/__functional/platform-report")
      .set("Authorization", `Bearer ${tokenForRole("user")}`);
    expect(tenantAdmin.status).toBe(403);
    expect(user.status).toBe(403);
  });

  it("enforces platform_admin role for release note publish", async () => {
    const superAdmin = await request(app)
      .post("/api/admin/release-notes/__functional/publish")
      .set("Authorization", `Bearer ${tokenForRole("super_admin")}`)
      .send({});
    const platformAdmin = await request(app)
      .post("/api/admin/release-notes/__functional/publish")
      .set("Authorization", `Bearer ${tokenForRole("platform_admin")}`)
      .send({});
    const support = await request(app)
      .post("/api/admin/release-notes/__functional/publish")
      .set("Authorization", `Bearer ${tokenForRole("support")}`)
      .send({});
    expect(superAdmin.status).toBe(200);
    expect(platformAdmin.status).toBe(200);
    expect(support.status).toBe(403);
  });
});
