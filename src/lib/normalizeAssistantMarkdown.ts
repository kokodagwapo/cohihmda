/**
 * Normalize assistant markdown lists before rendering in chat bubbles.
 */

export function normalizeAssistantMarkdown(text: string): string {
  if (!text?.trim()) return text;

  const lines = text.split("\n");
  const out: string[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^```/.test(trimmed)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    const numbered = trimmed.match(/^(\d+)[.)]\s*(.*)$/);
    if (numbered) {
      out.push(`${numbered[1]}. ${numbered[2]}`);
      continue;
    }

    const numberedDash = trimmed.match(/^(\d+)\s*[-–]\s+(.*)$/);
    if (numberedDash) {
      out.push(`${numberedDash[1]}. ${numberedDash[2]}`);
      continue;
    }

    const bullet = trimmed.match(/^[-•*]\s+(.*)$/);
    if (bullet) {
      out.push(`- ${bullet[1]}`);
      continue;
    }

    const looseBullet = trimmed.match(/^[-•*](\S.*)$/);
    if (looseBullet) {
      out.push(`- ${looseBullet[1]}`);
      continue;
    }

    out.push(line);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}
