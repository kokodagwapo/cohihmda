/**
 * Optional prompt composition metadata (COHI-390 placeholder).
 * Full modular assembly lives in cohiChatService / workbench; this exports a stable hash for audit.
 */
import { createHash } from "crypto";

export function hashPromptModules(modules: string[]): string {
  return createHash("sha256")
    .update(modules.sort().join("|"))
    .digest("hex")
    .slice(0, 12);
}
