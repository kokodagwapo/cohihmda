import jwt from "jsonwebtoken";
import { getJwtSecret } from "../middleware/auth.js";
import { ROLE_TO_USER_ID, TEST_TENANT_ID, type AuthRole } from "./constants.js";

type Persona = "tenant_admin" | "tenant_user" | "tenant_canvas_only_user";

interface JwtTokenPayload {
  userId: string;
  email: string;
  role: string;
  isSuperAdmin: boolean;
  tenantId?: string;
  tenantSlug?: string;
  persona?: Persona;
  // AI Control Plane: optional claim that activates the AI identity path.
  sub_type?: string;
}

export function makeToken(overrides: Partial<JwtTokenPayload> = {}): string {
  const role = (overrides.role as AuthRole | undefined) || "user";
  const persona: Persona =
    overrides.persona ||
    (role === "tenant_admin" ? "tenant_admin" : "tenant_user");
  const isPlatform = ["super_admin", "platform_admin", "support"].includes(role);

  const payload: JwtTokenPayload = {
    userId: overrides.userId || ROLE_TO_USER_ID.user,
    email: overrides.email || "test-user@coheus.test",
    role,
    isSuperAdmin: role === "super_admin",
    persona: isPlatform ? undefined : persona,
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
    persona: role === "tenant_admin" ? "tenant_admin" : "tenant_user",
  });
}

export function tokenForCanvasOnlyUser(): string {
  return makeToken({
    role: "user",
    userId: ROLE_TO_USER_ID.canvas_only_user,
    email: "canvas-only@coheus.test",
    persona: "tenant_canvas_only_user",
    tenantId: TEST_TENANT_ID,
    tenantSlug: "test-tenant",
  });
}

/**
 * Mint a JWT that carries sub_type: "ai_agent".
 * This activates req.isAiAgent in authenticateToken and triggers the AI
 * security guard on mutating routes.  The base role is "user" with the
 * tenant_user persona so the underlying RBAC would otherwise allow access —
 * the guard is the only thing that blocks mutations without an approved action.
 */
export function tokenForAiAgent(overrides: Partial<JwtTokenPayload> = {}): string {
  return makeToken({
    role: "user",
    userId: overrides.userId || "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: overrides.email || "ai-agent@coheus.test",
    persona: "tenant_user",
    tenantId: TEST_TENANT_ID,
    tenantSlug: "test-tenant",
    sub_type: "ai_agent",
    ...overrides,
  });
}
