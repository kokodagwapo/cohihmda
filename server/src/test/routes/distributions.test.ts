import request from "supertest";
import { describe, expect, it } from "vitest";
import { createRoleHarnessApp } from "../appFactory.js";
import { tokenForRole } from "../tokenFactory.js";

const app = createRoleHarnessApp();

describe("Distributions route contracts", () => {
  it("allows tenant_admin and platform admins for send-now", async () => {
    const tenantAdmin = await request(app)
      .post("/api/distributions/__functional/send-now")
      .set("Authorization", `Bearer ${tokenForRole("tenant_admin")}`)
      .send({});
    const platformAdmin = await request(app)
      .post("/api/distributions/__functional/send-now")
      .set("Authorization", `Bearer ${tokenForRole("platform_admin")}`)
      .send({});
    expect(tenantAdmin.status).toBe(200);
    expect(platformAdmin.status).toBe(200);
  });

  it("denies support and tenant user for send-now", async () => {
    const support = await request(app)
      .post("/api/distributions/__functional/send-now")
      .set("Authorization", `Bearer ${tokenForRole("support")}`)
      .send({});
    const tenantUser = await request(app)
      .post("/api/distributions/__functional/send-now")
      .set("Authorization", `Bearer ${tokenForRole("user")}`)
      .send({});
    expect(support.status).toBe(403);
    expect(tenantUser.status).toBe(403);
  });
});
