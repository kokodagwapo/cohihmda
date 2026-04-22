import { buildSummaryBulletPresentation } from "@/lib/understoryBullets";

interface FindingSummaryContentProps {
  summary: string;
  preferredBullets?: string[];
  paragraphClassName?: string;
  listClassName?: string;
}

export function FindingSummaryContent({
  summary,
  preferredBullets,
  paragraphClassName = "text-sm text-muted-foreground leading-relaxed",
  listClassName = "list-disc pl-5 space-y-1 text-sm text-muted-foreground leading-relaxed",
}: FindingSummaryContentProps) {
  const presentation = buildSummaryBulletPresentation(summary, { preferredBullets });
  if (presentation.bullets.length === 0) return null;

  if (presentation.renderMode === "paragraph") {
    return <p className={paragraphClassName}>{presentation.bullets[0]}</p>;
  }

  return (
    <ul className={listClassName}>
      {presentation.bullets.map((bullet, idx) => (
        <li key={`${idx}-${bullet.slice(0, 24)}`}>{bullet}</li>
      ))}
    </ul>
  );
}
