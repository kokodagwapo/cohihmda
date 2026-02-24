import crypto from "crypto";

export interface Job {
  id: string;
  type: string;
  status: "pending" | "processing" | "complete" | "failed";
  progress: number;
  message?: string;
  userId: string;
  tenantId: string;
  result?: any;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type OnProgressFn = (progress: number, message?: string) => void;

type SendToUserFn = (userId: string, message: object) => void;

const jobs = new Map<string, Job>();
const JOB_TTL_MS = 30 * 60 * 1000;

let _sendToUser: SendToUserFn | null = null;

export function registerSendToUser(fn: SendToUserFn) {
  _sendToUser = fn;
}

function pushToUser(job: Job, payload: object) {
  if (_sendToUser) {
    try {
      _sendToUser(job.userId, payload);
    } catch {
      // WebSocket send failures are non-critical
    }
  }
}

export function createJob(
  type: string,
  userId: string,
  tenantId: string,
): Job {
  const id = crypto.randomUUID();
  const now = new Date();
  const job: Job = {
    id,
    type,
    status: "pending",
    progress: 0,
    userId,
    tenantId,
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(id, job);
  scheduleCleanup(id);
  return job;
}

export function updateProgress(
  jobId: string,
  progress: number,
  message?: string,
): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = "processing";
  job.progress = Math.min(100, Math.max(0, progress));
  job.message = message;
  job.updatedAt = new Date();
  pushToUser(job, {
    type: "job:progress",
    jobId,
    jobType: job.type,
    progress: job.progress,
    message,
  });
}

const WS_PAYLOAD_LIMIT = 256 * 1024; // 256 KB — skip sending data over WS if larger

export function completeJob(jobId: string, result?: any): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = "complete";
  job.progress = 100;
  job.result = result;
  job.updatedAt = new Date();

  let wsData: any = undefined;
  try {
    const serialized = JSON.stringify(result);
    if (serialized.length <= WS_PAYLOAD_LIMIT) {
      wsData = result;
    }
  } catch { /* non-serializable — skip */ }

  pushToUser(job, {
    type: "job:complete",
    jobId,
    jobType: job.type,
    ...(wsData !== undefined ? { data: wsData } : {}),
  });
}

export function failJob(jobId: string, error: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = "failed";
  job.error = error;
  job.updatedAt = new Date();
  pushToUser(job, {
    type: "job:error",
    jobId,
    jobType: job.type,
    error,
  });
}

export function getJob(jobId: string): Job | undefined {
  return jobs.get(jobId);
}

export function makeOnProgress(jobId: string): OnProgressFn {
  return (progress: number, message?: string) =>
    updateProgress(jobId, progress, message);
}

function scheduleCleanup(jobId: string) {
  setTimeout(() => {
    jobs.delete(jobId);
  }, JOB_TTL_MS);
}
