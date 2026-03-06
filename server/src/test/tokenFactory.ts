import jwt from "jsonwebtoken";
import { getJwtSecret } from "../middleware/auth.js";
import { ROLE_TO_USER_ID, TEST_TENANT_ID, type AuthRole } from "./constants.js";

type AccessMode = "full" | "canvas_only";

interface JwtTokenPayload {
  userId: string;
  email: string;
  role: string;
  isSuperAdmin: boolean;
  tenantId?: string;
  tenantSlug?: string;
  access_mode?: AccessMode;
}

export function makeToken(overrides: Partial<JwtTokenPayload> = {}): string {
  const role = (overrides.role as AuthRole | undefined) || "user";
  const accessMode: AccessMode = overrides.access_mode || "full";
  const isPlatform = ["super_admin", "platform_admin", "support"].includes(role);

  const payload: JwtTokenPayload = {
    userId: overrides.userId || ROLE_TO_USER_ID.user,
    email: overrides.email || "test-user@coheus.test",
    role,
    isSuperAdmin: role === "super_admin",
    access_mode: accessMode,
    ...(isPlatform ? {} : { tenantId: TEST_TENANT_ID, tenantSlug: "test-tenant" }),
    ...overrides,
  };

  return jwt.sign(payload, getJwtSecret(), { expiresIn: "1h" });
}

export function tokenForRole(role: AuthRole): string {
  return makeToken({
    role,
    userId: ROLE_TO_USER_ID[role],
    email: `${role}@coheus.test`,
    access_mode: "full",
  });
}

export function tokenForCanvasOnlyUser(): string {
  return makeToken({
    role: "viewer",
    userId: ROLE_TO_USER_ID.canvas_only_user,
    email: "canvas-only@coheus.test",
    access_mode: "canvas_only",
    tenantId: TEST_TENANT_ID,
    tenantSlug: "test-tenant",
  });
}
