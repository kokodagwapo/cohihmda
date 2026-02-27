/**
 * PII/NPI safety net for outbound email content.
 * Scans HTML and text for sensitive patterns before send.
 * Does not block send; logs warning and can redact if needed.
 */

const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g;
const PHONE_PATTERN = /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g;
/** Simple SSN-like without dashes (9 consecutive digits in plausible contexts) */
const SSN_UNFORMATTED = /\b\d{9}\b/g;

export interface SanitizeResult {
  safe: boolean;
  redactedHtml?: string;
  redactedText?: string;
  warnings: string[];
}

/**
 * Scan content for PII patterns. Returns warnings and optionally redacted copy.
 * Call before sending; if warnings.length > 0, consider not sending or redacting.
 */
export function sanitizeEmailContent(html: string, text?: string): SanitizeResult {
  const warnings: string[] = [];

  const check = (content: string, label: string): string => {
    let out = content;
    if (SSN_PATTERN.test(content)) {
      warnings.push(`Possible SSN (formatted) in ${label}`);
      out = content.replace(SSN_PATTERN, "***-**-****");
    }
    if (SSN_UNFORMATTED.test(content) && content.length < 500) {
      warnings.push(`Possible 9-digit identifier in ${label}`);
      out = out.replace(SSN_UNFORMATTED, "*********");
    }
    if (PHONE_PATTERN.test(content) && !out.includes("800") && !out.includes("888")) {
      warnings.push(`Possible phone number in ${label}`);
      out = out.replace(PHONE_PATTERN, "***-***-****");
    }
    return out;
  };

  const redactedHtml = check(html, "HTML");
  const redactedText = text ? check(text, "text") : undefined;

  if (warnings.length > 0) {
    console.warn("[EmailContentSanitizer] PII patterns detected:", warnings);
  }

  return {
    safe: warnings.length === 0,
    redactedHtml: warnings.length > 0 ? redactedHtml : undefined,
    redactedText: redactedText && warnings.length > 0 ? redactedText : undefined,
    warnings,
  };
}

/**
 * Assert content is safe for sending (no PII). Throws if PII detected.
 * Use for daily brief / market emails where we never expect PII.
 */
export function assertNoPii(html: string, text?: string): void {
  const result = sanitizeEmailContent(html, text);
  if (!result.safe) {
    throw new Error(
      `Email content may contain PII: ${result.warnings.join("; ")}. Refusing to send.`
    );
  }
}
