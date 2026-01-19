interface ConsentBadgeProps {
  consentAt: string | null;
}

export function ConsentBadge({ consentAt }: ConsentBadgeProps) {
  if (!consentAt) return null;
  
  const ts = new Date(consentAt).toLocaleString();
  
  return (
    <div
      className="mt-2 text-xs inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700"
      title={`Consent captured at ${ts} and logged to transcript/audit trail`}
      aria-label={`Consent captured at ${ts}`}
    >
      <span aria-hidden>✓</span>
      <span>Consent captured</span>
      <span className="opacity-70">• {ts}</span>
    </div>
  );
}
