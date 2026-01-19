/**
 * Import Progress Tracker
 * Tracks progress of CSV imports in memory for real-time updates
 */

export interface ImportProgress {
  jobId: string;
  userId: string;
  tenantId: string;
  status: 'processing' | 'completed' | 'failed';
  phase: 'parsing' | 'transforming' | 'checking' | 'inserting' | 'updating' | 'finalizing' | 'done';
  totalRecords: number;
  processedRecords: number;
  insertedRecords: number;
  updatedRecords: number;
  skippedRecords: number;
  errorRecords: number;
  currentBatch?: number;
  totalBatches?: number;
  message?: string;
  startTime: number;
  estimatedTimeRemaining?: number;
  error?: string;
}

// In-memory store for import progress
// For production with multiple servers, consider Redis
const progressStore = new Map<string, ImportProgress>();

// Cleanup old progress entries after 1 hour
const PROGRESS_TTL = 60 * 60 * 1000; // 1 hour

setInterval(() => {
  const now = Date.now();
  for (const [jobId, progress] of progressStore.entries()) {
    if (now - progress.startTime > PROGRESS_TTL) {
      progressStore.delete(jobId);
    }
  }
}, 5 * 60 * 1000); // Check every 5 minutes

export function createImportJob(userId: string, tenantId: string, totalRecords: number): string {
  const jobId = `import-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  const progress: ImportProgress = {
    jobId,
    userId,
    tenantId,
    status: 'processing',
    phase: 'parsing',
    totalRecords,
    processedRecords: 0,
    insertedRecords: 0,
    updatedRecords: 0,
    skippedRecords: 0,
    errorRecords: 0,
    startTime: Date.now(),
  };
  
  progressStore.set(jobId, progress);
  return jobId;
}

export function updateImportProgress(jobId: string, updates: Partial<ImportProgress>): void {
  const progress = progressStore.get(jobId);
  if (!progress) {
    console.log(`⚠️  Attempted to update progress for non-existent job: ${jobId}`);
    return;
  }
  
  Object.assign(progress, updates);
  
  // Calculate estimated time remaining
  if (progress.processedRecords > 0 && progress.totalRecords > 0) {
    const elapsed = Date.now() - progress.startTime;
    const recordsRemaining = progress.totalRecords - progress.processedRecords;
    const recordsPerMs = progress.processedRecords / elapsed;
    progress.estimatedTimeRemaining = recordsRemaining / recordsPerMs;
  }
  
  progressStore.set(jobId, progress);
  console.log(`📊 Progress updated for ${jobId}:`, {
    phase: progress.phase,
    processed: progress.processedRecords,
    total: progress.totalRecords,
    inserted: progress.insertedRecords,
    updated: progress.updatedRecords,
  });
}

export function completeImportJob(jobId: string, success: boolean, error?: string): void {
  const progress = progressStore.get(jobId);
  if (!progress) return;
  
  progress.status = success ? 'completed' : 'failed';
  progress.phase = 'done';
  if (error) progress.error = error;
  
  progressStore.set(jobId, progress);
}

export function getImportProgress(jobId: string): ImportProgress | null {
  return progressStore.get(jobId) || null;
}

export function getUserImportJobs(userId: string): ImportProgress[] {
  const jobs: ImportProgress[] = [];
  for (const progress of progressStore.values()) {
    if (progress.userId === userId) {
      jobs.push(progress);
    }
  }
  return jobs.sort((a, b) => b.startTime - a.startTime);
}
