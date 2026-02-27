import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
const client = new SESClient({ region: "us-east-2" });

async function send(label, h) {
  const cmd = new SendEmailCommand({
    Source: "noreply@coheus1.com",
    Destination: { ToAddresses: ["mpetrovic@teraverde.com"] },
    Message: {
      Subject: { Data: `Brief - ${label}`, Charset: "UTF-8" },
      Body: {
        Html: { Data: h, Charset: "UTF-8" },
        Text: { Data: `Test: ${label}`, Charset: "UTF-8" },
      },
    },
    ConfigurationSetName: "my-first-configuration-set",
  });
  const r = await client.send(cmd);
  console.log(`[${label}] len=${h.length} MessageId=${r.MessageId}`);
}

const heads = [
  { t: "Mortgage Applications Increase in Latest MBA Weekly Survey", s: "MBA", d: "Feb 25", sum: "Purchase apps rose 2.1% and refis climbed 4.3% as rates held near lows.", l: "https://newslink.mba.org/mba-newslinks/2026/february//mortgage-applications-increase-in-latest-mba-weekly-survey" },
  { t: "Fed Discount Rate Meeting Minutes, January 2026", s: "Federal Reserve", d: "Feb 24", sum: "Officials noted inflation progress but signaled patience on rate cuts.", l: "https://www.federalreserve.gov/newsevents/pressreleases/monetary20260224a.htm" },
  { t: "CFPB and DOJ Withdraw Fair Lending Joint Statement", s: "CFPB", d: "Feb 24", sum: "Agencies withdrew guidance on credit for noncitizen borrowers.", l: "https://www.consumerfinance.gov/about-us/newsroom/consumer-financial-protection-bureau-and-the-department-of-justice-withdraw-joint-statement-on-fair-lending" },
  { t: "Home Price Growth Ends 2025 at 1.3%, Weakest Since 2011", s: "MBA", d: "Feb 24", sum: "Slower appreciation reflects inventory and affordability pressures.", l: "https://newslink.mba.org/mba-newslinks/2026/february//annual-home-price-growth-ends-2025-at-1-3-weakest-since-2011" },
  { t: "Mortgage Rates Match Multi-Year Low For 2nd Week", s: "MND", d: "Feb 24", sum: "30-year fixed averaged 6.12%, lowest since Sep 2024.", l: "https://www.mortgagenewsdaily.com/markets/mortgage-rates-02242026" },
  { t: "Consent Order Issued for BSA/AML Deficiencies", s: "Federal Reserve", d: "Feb 24", sum: "Board acted against a state member bank.", l: "https://www.federalreserve.gov/newsevents/pressreleases/enforcement20260224a.htm" },
];

// Enhanced market section with 4 rate types + trend arrows
const marketRates = `<div class="mk">
<div class="mh">Market Rate Snapshot <span class="ms">Optimal Blue OBMMI</span></div>
<table class="mt"><tr>
<td class="mc"><div class="mn">Conforming</div><div class="mv">6.850%</div><div class="md g">\u25BC 0.012</div></td>
<td class="mc"><div class="mn">Jumbo</div><div class="mv">6.723%</div><div class="md r">\u25B2 0.008</div></td>
<td class="mc"><div class="mn">FHA</div><div class="mv">6.376%</div><div class="md g">\u25BC 0.019</div></td>
<td class="mc"><div class="mn">VA</div><div class="mv">6.201%</div><div class="md g">\u25BC 0.005</div></td>
</tr></table></div>`;

function build(items, mkt, withDigest) {
  const hl = items.map(h =>
    `<div class="h"><div class="ht"><a href="${h.l}">${h.t}</a></div><div class="sm">${h.sum}</div><div class="hm">${h.s} &bull; ${h.d}</div></div>`
  ).join("\n");
  const digest = withDigest ? `<div class="dw"><h2 class="dh">Your Cohi Digest</h2>
<div class="di"><a href="https://cohi.coheus1.com/insights?utm_source=daily_brief&utm_medium=email">View Insights</a></div>
<div class="di"><a href="https://cohi.coheus1.com/research?utm_source=daily_brief&utm_medium=email">View Research</a></div>
</div>` : "";
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
body{margin:0;padding:24px;background:#f5f7fb;font-family:sans-serif;color:#0f172a}
.w{max-width:640px;margin:0 auto}.c{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:24px}
.mk{border:1px solid #dbe7f3;border-radius:10px;background:#f3f9fc;padding:10px 12px;margin:16px 0}
.mh{font-size:13px;font-weight:600;color:#1e293b;margin-bottom:8px}.ms{font-weight:400;color:#94a3b8;font-size:11px}
.mt{width:100%;border-collapse:collapse}.mc{text-align:center;padding:4px 6px;width:25%}
.mn{font-size:11px;color:#64748b}.mv{font-size:16px;font-weight:600;color:#0f172a}
.md{font-size:10px}.g{color:#16a34a}.r{color:#dc2626}
.h{border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px;margin-bottom:8px;background:#f8fafc}
.ht{font-size:14px;font-weight:500;margin-bottom:2px}.ht a{color:#0f172a;text-decoration:none}
.sm{font-size:12px;color:#475569;line-height:1.4;margin-bottom:4px}.hm{font-size:11px;color:#94a3b8}
.dw{border-top:1px solid #e2e8f0;padding-top:14px;margin-top:14px}.dh{font-size:18px;font-weight:500;margin:0 0 10px}
.di{margin-bottom:8px}.di a{color:#2563eb;text-decoration:none;font-size:14px}
</style></head><body><div class="w"><div class="c">
<h1 style="font-size:24px;font-weight:300;margin:0;">Cohi Daily Morning Brief</h1>
<p style="font-size:13px;color:#64748b;margin-top:4px;">Feb 25, 2026</p>
${mkt}
<div style="border-top:1px solid #e2e8f0;padding-top:14px;">
<h2 style="font-size:18px;font-weight:500;margin:0 0 10px;">Top Headlines</h2>
${hl}</div>${digest}
<p style="margin-top:12px;font-size:11px;color:#64748b;">Subscribed to Cohi Daily Brief.</p>
</div></div></body></html>`;
}

// A: 6 headlines + enhanced rates + digest (full combo)
await send("6hl+rates+digest", build(heads, marketRates, true));

// B: 5 headlines + enhanced rates + digest (in case A is too big)
await send("5hl+rates+digest", build(heads.slice(0, 5), marketRates, true));

console.log("\nDone. Check which arrive.");
