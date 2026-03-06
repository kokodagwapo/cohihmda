import {
  TEST_CANVAS_ONLY_ID,
  TEST_PLATFORM_ADMIN_ID,
  TEST_SUPPORT_ID,
  TEST_TENANT_ADMIN_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  TEST_USER_STANDARD_ID,
  TEST_VIEWER_ID,
} from "./constants.js";

export type SeedUser = {
  id: string;
  email: string;
  role: string;
  tenantId: string | null;
  accessMode: "full" | "canvas_only";
};

export const SEED_USERS: SeedUser[] = [
  {
    id: TEST_USER_ID,
    email: "super_admin@coheus.test",
    role: "super_admin",
    tenantId: null,
    accessMode: "full",
  },
  {
    id: TEST_PLATFORM_ADMIN_ID,
    email: "platform_admin@coheus.test",
    role: "platform_admin",
    tenantId: null,
    accessMode: "full",
  },
  {
    id: TEST_SUPPORT_ID,
    email: "support@coheus.test",
    role: "support",
    tenantId: null,
    accessMode: "full",
  },
  {
    id: TEST_TENANT_ADMIN_ID,
    email: "tenant_admin@coheus.test",
    role: "tenant_admin",
    tenantId: TEST_TENANT_ID,
    accessMode: "full",
  },
  {
    id: TEST_USER_STANDARD_ID,
    email: "user@coheus.test",
    role: "user",
    tenantId: TEST_TENANT_ID,
    accessMode: "full",
  },
  {
    id: TEST_VIEWER_ID,
    email: "viewer@coheus.test",
    role: "viewer",
    tenantId: TEST_TENANT_ID,
    accessMode: "full",
  },
  {
    id: TEST_CANVAS_ONLY_ID,
    email: "canvas_only@coheus.test",
    role: "viewer",
    tenantId: TEST_TENANT_ID,
    accessMode: "canvas_only",
  },
];
