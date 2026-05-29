import React from "react";
import "./hmda-preload-ui.css";

/** ~2025 HMDA filer rows in `lenders-from-hmda.json` — used in preload copy. */
export const HMDA_PRELOADER_LENDER_COUNT = 4754;

/** Canonical legal + AI notice for HMDA intelligence surfaces (Coheus / Teraverde). */
export const HMDA_INTEL_DISCLAIMER_BLOCKS = {
  body:
    "Teraverde uses publicly available HMDA data from CFPB and FFIEC. Data may contain inaccuracies. This platform uses AI (HMTK AI) to generate insights and visualizations. Teraverde reserves the right to update or correct data at any time. If you find any discrepancies, contact ",
  email: "info@teraverde.com",
};

/** Brief site footer (full detail in Terms / separate disclaimers where needed). */
export const HMDA_SITE_FOOTER = {
  line:
    "Source: public HMDA (CFPB/FFIEC). Views may use automation; data may be incomplete or outdated — verify independently. Not legal or financial advice.",
  reportIssueHref: `mailto:info@teraverde.com?subject=${encodeURIComponent("HMDA DataBank — data issue")}`,
  unlistHref:
    "mailto:sales@coheus.com?subject=" + encodeURIComponent("Request to be unlisted from HMDA DataBank"),
};

export function HmdaLegalDisclaimer({ c, compact = false, showFeedbackLinks = true, className = "" }) {
  const { body, email } = HMDA_INTEL_DISCLAIMER_BLOCKS;
  const mailIssues = `mailto:${email}?subject=${encodeURIComponent("HMDA DataBank — data issue")}`;
  const mailSuggest = `mailto:${email}?subject=${encodeURIComponent("HMDA DataBank — product suggestion")}`;
  const glass = className.includes("hmda-lender-modal-disclaimer");
  return (
    <div
      role="note"
      className={className || undefined}
      style={
        glass
          ? undefined
          : {
              marginTop: compact ? 10 : 14,
              padding: compact ? "10px 12px" : "14px 16px",
              borderRadius: 14,
              border: `1px solid ${c.border}`,
              background: c.statBg || c.drillBg,
              fontSize: compact ? 10 : 11,
              lineHeight: 1.55,
              color: c.text3,
            }
      }
    >
      <p style={{ margin: "0 0 8px" }}>
        {body}{" "}
        <a href={`mailto:${email}`} style={{ color: c.accent, fontWeight: 600 }}>
          {email}
        </a>
        .
      </p>
      {showFeedbackLinks && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <a href={mailIssues} style={{ color: c.accent, fontWeight: 600, fontSize: compact ? 10 : 11 }}>
            Report data issue
          </a>
          <span style={{ opacity: 0.35 }}>|</span>
          <a href={mailSuggest} style={{ color: c.accent, fontWeight: 600, fontSize: compact ? 10 : 11 }}>
            Suggest improvement
          </a>
        </div>
      )}
    </div>
  );
}

/** Full-screen glass preloader while primary HMDA JSON hydrates. */
export function HmdaPoweredPreloader({ show, lenderCount = HMDA_PRELOADER_LENDER_COUNT }) {
  if (!show) return null;
  const count = Number(lenderCount) > 0 ? Number(lenderCount) : HMDA_PRELOADER_LENDER_COUNT;
  return (
    <div className="hmda-preload-overlay" aria-busy="true" aria-live="polite">
      <div className="hmda-preload-overlay__card">
        <div className="hmda-preload-orb" aria-hidden>
          <div className="hmda-preload-orb__ring" />
          <div className="hmda-preload-orb__ring hmda-preload-orb__ring--slow" />
          <div className="hmda-preload-orb__core" />
        </div>
        <p className="hmda-preload-overlay__brand">
          Powered by <span>Cohi</span>
        </p>
        <p className="hmda-preload-overlay__copy">
          Please wait — lining up{" "}
          <strong>{count.toLocaleString()}</strong> lenders. Thanks for waiting while we get
          everything parade-ready.
        </p>
        <div className="hmda-preload-overlay__shimmer" aria-hidden />
      </div>
    </div>
  );
}
