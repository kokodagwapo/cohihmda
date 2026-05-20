/** Prefer full name; fall back to a readable label from email (not raw email). */
export function formatUserDisplayName(
  fullName?: string | null,
  email?: string | null,
): string {
  const name = fullName?.trim();
  if (name) return name;
  const addr = email?.trim();
  if (!addr) return "Unknown user";
  const local = addr.split("@")[0] ?? addr;
  const words = local
    .replace(/[._+-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return addr;
  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
