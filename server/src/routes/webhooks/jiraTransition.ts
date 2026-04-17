import express from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import { listActionsByStatus, transitionAction, type LedgerRow } from "../../services/aiAgentOrchestrator.js";

const router = express.Router();

const JiraTransitionWebhookSchema = z.object({
  issue: z.object({
    key: z.string().min(1),
  }),
  transition: z
    .object({
      to_status: z
        .object({
          name: z.string().optional(),
        })
        .optional(),
      toStatus: z
        .object({
          name: z.string().optional(),
        })
        .optional(),
      name: z.string().optional(),
    })
    .optional(),
  reviewer: z
    .object({
      accountId: z.string().optional(),
      displayName: z.string().optional(),
    })
    .optional(),
});

function verifyWebhookSignature(req: express.Request, res: express.Response): boolean {
  const secret = process.env.JIRA_WEBHOOK_SECRET;
  const signature = req.get("X-Jira-Webhook-Signature");
  const rawBody: string = (req as any).rawBody ?? JSON.stringify(req.body);

  if (!secret) {
    res.status(503).json({ error: "JIRA_WEBHOOK_SECRET not configured" });
    return false;
  }

  if (!signature) {
    res.status(401).json({ error: "Missing X-Jira-Webhook-Signature header" });
    return false;
  }

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    const actualBuf = Buffer.from(signature, "hex");
    const expectedBuf = Buffer.from(expected, "hex");
    if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
      res.status(401).json({ error: "Invalid webhook signature" });
      return false;
    }
  } catch {
    res.status(401).json({ error: "Invalid webhook signature" });
    return false;
  }

  return true;
}

function resolveTransitionName(payload: z.infer<typeof JiraTransitionWebhookSchema>): string {
  return (
    payload.transition?.to_status?.name ||
    payload.transition?.toStatus?.name ||
    payload.transition?.name ||
    ""
  ).trim();
}

function findMatchingLedgerRows(rows: LedgerRow[], issueKey: string): LedgerRow[] {
  return rows.filter((row) => String(row.metadata?.issueKey ?? "").toUpperCase() === issueKey.toUpperCase());
}

router.post("/", async (req, res) => {
  if (!verifyWebhookSignature(req, res)) {
    return;
  }

  const parsed = JiraTransitionWebhookSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid Jira webhook payload",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const payload = parsed.data;
  const issueKey = payload.issue.key;
  const transitionName = resolveTransitionName(payload).toLowerCase();
  const reviewer = payload.reviewer?.displayName || payload.reviewer?.accountId || "jira-webhook";

  const pendingRows = findMatchingLedgerRows(
    await listActionsByStatus("pending_evidence_review"),
    issueKey,
  );

  if (pendingRows.length === 0) {
    return res.status(202).json({ ok: true, message: `No pending evidence-review actions found for ${issueKey}` });
  }

  let targetStatus: "evidence_approved" | "evidence_rejected" | null = null;
  if (transitionName.includes("approved")) {
    targetStatus = "evidence_approved";
  } else if (transitionName.includes("rejected")) {
    targetStatus = "evidence_rejected";
  }

  if (!targetStatus) {
    return res.status(202).json({
      ok: true,
      message: `Transition '${transitionName || "unknown"}' does not map to an evidence decision`,
    });
  }

  await Promise.all(
    pendingRows.map((row) =>
      transitionAction({
        actionId: row.action_id,
        status: targetStatus,
        approvedBy: reviewer,
        approvalNote: `Jira transition webhook: ${transitionName}`,
        metadata: {
          ...(row.metadata ?? {}),
          issueKey,
          jiraTransition: transitionName,
        },
      }),
    ),
  );

  return res.status(200).json({
    ok: true,
    issueKey,
    updatedActions: pendingRows.map((row) => row.action_id),
    status: targetStatus,
  });
});

export default router;
