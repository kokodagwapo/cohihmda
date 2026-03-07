import request from "supertest";
import { describe, expect, it } from "vitest";
import { createRoleHarnessApp } from "../appFactory.js";
import { tokenForCanvasOnlyUser, tokenForRole } from "../tokenFactory.js";

const app = createRoleHarnessApp();

describe("Release Notes route contracts", () => {
  it("allows authenticated full-access users to read published release notes", async () => {
    const user = await request(app)
      .get("/api/release-notes/__rbac_probe")
      .set("Authorization", `Bearer ${tokenForRole("user")}`);
    expect(user.status).toBe(200);
  });

  it("blocks canvas_only users from release notes API when route is not allowlisted", async () => {
    const canvasOnly = await request(app)
      .get("/api/release-notes/__rbac_probe")
      .set("Authorization", `Bearer ${tokenForCanvasOnlyUser()}`);
    expect(canvasOnly.status).toBe(403);
  });

  it("enforces auth for published release notes endpoint", async () => {
    const unauthenticated = await request(app).get("/api/release-notes/__rbac_probe");
    expect(unauthenticated.status).toBe(401);
  });
});
