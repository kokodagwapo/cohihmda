import { Router } from "express";
import { authenticateToken, AuthRequest } from "../middleware/auth.js";
import { getJob } from "../services/jobManager.js";

const router = Router();

router.get("/:jobId", authenticateToken, (req: AuthRequest, res) => {
  const job = getJob(req.params.jobId as string);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  if (job.userId !== (req as any).userId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const response: Record<string, any> = {
    jobId: job.id,
    type: job.type,
    status: job.status,
    progress: job.progress,
    message: job.message,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };

  if (job.status === "complete") {
    response.data = job.result;
  } else if (job.status === "failed") {
    response.error = job.error;
  }

  res.json(response);
});

export default router;
