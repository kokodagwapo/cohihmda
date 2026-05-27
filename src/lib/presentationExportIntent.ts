/**
 * Presentation / slide-deck export intent — fast prefilter (client + server mirror).
 * Prefilter alone never triggers export; pair with LLM classifier on server.
 */

const PHRASES = ["slide show", "slide deck", "power point"] as const;

const SINGLE_TOKENS = [
  "slideshow",
  "slides",
  "slide",
  "deck",
  "keynote",
  "ppt",
  "pptx",
  "powerpoint",
  "presentation",
  "report",
] as const;

export function normalizePresentationExportText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fast hint that the user may want a slide deck export. */
export function presentationExportPrefilter(message: string): boolean {
  const normalized = normalizePresentationExportText(message);
  if (!normalized) return false;

  for (const phrase of PHRASES) {
    if (normalized.includes(phrase)) return true;
  }

  for (const token of SINGLE_TOKENS) {
    const re = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (re.test(normalized)) return true;
  }

  if (/\bpower\s*point\b/.test(normalized)) return true;

  return false;
}

export type PresentationExportMode = "create" | "convert";

export type PresentationExportAction =
  | "export_viz"
  | "export_research_report"
  | "open_workbench_editor"
  | "none";

export type PresentationExportMetadata = {
  prefilterHit: boolean;
  wantsPresentationExport: boolean;
  mode: PresentationExportMode;
  action: PresentationExportAction;
  confidence: number;
};
