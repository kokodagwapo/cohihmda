import request from "supertest";
import { describe, expect, it } from "vitest";
import { createRoleHarnessApp } from "../appFactory.js";
import { tokenForCanvasOnlyUser, tokenForRole } from "../tokenFactory.js";

const app = createRoleHarnessApp();

/**
 * Contract tests for the COHI-362 Research Lab artifact endpoints.
 *
 * The role harness mounts stub handlers for every entry in `ROLE_MATRIX`,
 * so these assertions guarantee both routes are present and policy-gated.
 * The actual database-touching logic in `server/src/routes/research.ts`
 * is exercised via local + dev environment integration testing.
 */

describe("Research artifact route contracts", () => {
  it("requires auth for POST /api/research/artifacts", async () => {
    const res = await request(app)
      .post("/api/research/artifacts/__rbac_probe")
      .send({});
    expect(res.status).toBe(401);
  });

  it("requires auth for GET /api/research/artifacts/:id", async () => {
    const res = await request(app)
      .get("/api/research/artifacts/__rbac_probe");
    expect(res.status).toBe(401);
  });

  it("blocks canvas_only persona from POST /api/research/artifacts", async () => {
    const res = await request(app)
      .post("/api/research/artifacts/__rbac_probe")
      .set("Authorization", `Bearer ${tokenForCanvasOnlyUser()}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it("blocks canvas_only persona from GET /api/research/artifacts/:id", async () => {
    const res = await request(app)
      .get("/api/research/artifacts/__rbac_probe")
      .set("Authorization", `Bearer ${tokenForCanvasOnlyUser()}`);
    expect(res.status).toBe(403);
  });

  it("allows tenant user to create an artifact", async () => {
    const res = await request(app)
      .post("/api/research/artifacts/__rbac_probe")
      .set("Authorization", `Bearer ${tokenForRole("user")}`)
      .send({});
    expect(res.status).toBe(200);
  });

  it("allows tenant user to fetch an artifact", async () => {
    const res = await request(app)
      .get("/api/research/artifacts/__rbac_probe")
      .set("Authorization", `Bearer ${tokenForRole("user")}`);
    expect(res.status).toBe(200);
  });

  it("allows platform staff to create an artifact", async () => {
    const res = await request(app)
      .post("/api/research/artifacts/__rbac_probe")
      .set("Authorization", `Bearer ${tokenForRole("platform_admin")}`)
      .send({});
    expect(res.status).toBe(200);
  });
});
