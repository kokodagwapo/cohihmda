export function selectBulletSource(input: {
  generation_method?: string;
  detail_data?: any;
  understory?: string | null;
}): { text: string; sourceLabel: "summary" | "understory" } {
  const dd = input?.detail_data;
  const summary =
    dd &&
    typeof dd === "object" &&
    dd.type === "agent_finding" &&
    typeof dd.summary === "string"
      ? dd.summary.trim()
      : "";

  if (String(input?.generation_method || "") === "agent" && summary) {
    return { text: summary, sourceLabel: "summary" };
  }
  return { text: String(input?.understory || "").trim(), sourceLabel: "understory" };
}
