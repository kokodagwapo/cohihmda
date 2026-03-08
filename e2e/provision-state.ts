import { existsSync, readFileSync } from "node:fs";
import { writeFile, rm } from "node:fs/promises";
import path from "node:path";

export type ProvisionedUserPersona = "tenant_user" | "tenant_canvas_only_user";

export type ProvisionedUser = {
  id: string;
  email: string;
  password: string;
  totpSecret: string;
  persona: ProvisionedUserPersona;
};

export type ProvisionedState = {
  tenantId: string;
  tenantSlug: string;
  managedEmailPrefix: string;
  users: {
    tenantUser: ProvisionedUser;
    canvasOnlyUser: ProvisionedUser;
  };
};

export const AUTH_DIR = path.join(process.cwd(), "e2e", ".auth");
export const PROVISIONED_STATE_PATH = path.join(AUTH_DIR, "provisioned-users.json");

export async function writeProvisionedState(state: ProvisionedState): Promise<void> {
  await writeFile(PROVISIONED_STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

export function readProvisionedState(): ProvisionedState | null {
  if (!existsSync(PROVISIONED_STATE_PATH)) {
    return null;
  }

  const raw = readFileSync(PROVISIONED_STATE_PATH, "utf8");
  return JSON.parse(raw) as ProvisionedState;
}

export async function removeProvisionedState(): Promise<void> {
  await rm(PROVISIONED_STATE_PATH, { force: true });
}

