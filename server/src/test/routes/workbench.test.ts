import request from "supertest";
import { describe, expect, it } from "vitest";
import { createRoleHarnessApp } from "../appFactory.js";
import { tokenForCanvasOnlyUser, tokenForRole } from "../tokenFactory.js";

const app = createRoleHarnessApp();

describe("Workbench route contracts", () => {
  it("allows canvas_only user to read workbench canvases", async () => {
    const res = await request(app)
      .get("/api/workbench/canvases/__rbac_probe")
      .set("Authorization", `Bearer ${tokenForCanvasOnlyUser()}`);
    expect(res.status).toBe(200);
  });

  it("allows super_admin and platform_admin to update any canvas", async () => {
    const superAdmin = await request(app)
      .post("/api/workbench/canvases/__functional/update-any")
      .set("Authorization", `Bearer ${tokenForRole("super_admin")}`)
      .send({});
    const platformAdmin = await request(app)
      .post("/api/workbench/canvases/__functional/update-any")
      .set("Authorization", `Bearer ${tokenForRole("platform_admin")}`)
      .send({});
    expect(superAdmin.status).toBe(200);
    expect(platformAdmin.status).toBe(200);
  });

  it("denies viewer from update-any contract endpoint", async () => {
    const res = await request(app)
      .post("/api/workbench/canvases/__functional/update-any")
      .set("Authorization", `Bearer ${tokenForRole("viewer")}`)
      .send({});
    expect(res.status).toBe(403);
  });
});
