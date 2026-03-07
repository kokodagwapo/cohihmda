export type AuthRole =
  | "super_admin"
  | "platform_admin"
  | "support"
  | "tenant_admin"
  | "user"
  | "viewer";

export type RoleKey = AuthRole | "canvas_only_user" | "unauthenticated";

export const TEST_TENANT_ID = "c70d1403-77a4-4785-9828-555d05d490b1";
export const TEST_USER_ID = "11111111-1111-4111-8111-111111111111";
export const TEST_PLATFORM_ADMIN_ID = "22222222-2222-4222-8222-222222222222";
export const TEST_SUPPORT_ID = "33333333-3333-4333-8333-333333333333";
export const TEST_TENANT_ADMIN_ID = "44444444-4444-4444-8444-444444444444";
export const TEST_USER_STANDARD_ID = "55555555-5555-4555-8555-555555555555";
export const TEST_VIEWER_ID = "66666666-6666-4666-8666-666666666666";
export const TEST_CANVAS_ONLY_ID = "77777777-7777-4777-8777-777777777777";

export const ROLE_TO_USER_ID: Record<AuthRole | "canvas_only_user", string> = {
  super_admin: TEST_USER_ID,
  platform_admin: TEST_PLATFORM_ADMIN_ID,
  support: TEST_SUPPORT_ID,
  tenant_admin: TEST_TENANT_ADMIN_ID,
  user: TEST_USER_STANDARD_ID,
  viewer: TEST_VIEWER_ID,
  canvas_only_user: TEST_CANVAS_ONLY_ID,
};
