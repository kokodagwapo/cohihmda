/**
 * Load email HTML templates from server/email-templates (or dist/email-templates when built).
 * Resolves path relative to this module so it works regardless of process.cwd().
 * Falls back to null if file is missing (caller can use inline HTML).
 */

import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const cache = new Map<string, string>();

/** Possible template dirs: dist/email-templates (built) or server/email-templates (dev/tsx) */
const TEMPLATE_DIR_CANDIDATES = [
  join(__dirname, "..", "email-templates"),   // dist/email-templates when built
  join(__dirname, "..", "..", "email-templates"), // server/email-templates when run via tsx from src
];

export async function loadEmailTemplate(name: string): Promise<string | null> {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;

  for (const templateDir of TEMPLATE_DIR_CANDIDATES) {
    const templatePath = join(templateDir, name);
    try {
      const content = await readFile(templatePath, "utf-8");
      cache.set(name, content);
      return content;
    } catch {
      continue;
    }
  }
  return null;
}

export function replacePlaceholders(
  template: string,
  placeholders: Record<string, string>,
): string {
  let out = template;
  for (const [key, value] of Object.entries(placeholders)) {
    out = out.replace(new RegExp(`{{${key}}}`, "g"), value);
  }
  return out;
}
