import request from "supertest";
import { describe, expect, it } from "vitest";
import { createRoleHarnessApp } from "./appFactory.js";
import { ROLE_MATRIX } from "./roleMatrix.js";
import { tokenForCanvasOnlyUser, tokenForRole } from "./tokenFactory.js";
import type { RoleKey } from "./constants.js";

const app = createRoleHarnessApp();

function authHeaderForRole(role: RoleKey): string | null {
  if (role === "unauthenticated") return null;
  if (role === "canvas_only_user") return `Bearer ${tokenForCanvasOnlyUser()}`;
  return `Bearer ${tokenForRole(role)}`;
}

async function callRoute(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  role: RoleKey,
) {
  const auth = authHeaderForRole(role);
  const req = request(app)[method.toLowerCase() as "get" | "post" | "put" | "delete"](path);
  if (auth) req.set("Authorization", auth);
  return req.send({});
}

describe("Role Access Matrix", () => {
  for (const route of ROLE_MATRIX) {
    describe(`${route.method} ${route.routeGroup}`, () => {
      const roles = Object.keys(route.expect) as RoleKey[];
      for (const role of roles) {
        it(`${role} => ${route.expect[role]}`, async () => {
          const response = await callRoute(route.method, route.path, role);
          expect(response.status).toBe(route.expect[role]);
        });
      }
    });
  }
});
