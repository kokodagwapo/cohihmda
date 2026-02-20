import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../../middleware/auth.js';
import { attachTenantContext, getTenantContext } from '../../middleware/tenantContext.js';
import multer from 'multer';
import { logError, logInfo, createLogger } from '../../services/logger.js';
import { importLoansFromCSV, importEmployeesFromCSV, parseCSV } from '../../services/dashboard/importService.js';
import { createImportJob, getImportProgress, completeImportJob } from '../../services/importProgress.js';

const router = Router();

// Configure multer for CSV file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
});

/**
 * POST /api/dashboard/import/loans
 * Import loans from CSV file
 */
router.post('/import/loans', authenticateToken, attachTenantContext, upload.single('file'), async (req: AuthRequest, res) => {
  const logger = createLogger({ userId: req.userId });
  try {
    if (!req.file) {
      logError('CSV upload error: No file in request', undefined, { userId: req.userId });
      return res.status(400).json({ error: 'No file uploaded' });
    }

    logInfo('CSV upload received', {
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimetype: req.file.mimetype,
      hasBuffer: !!req.file.buffer,
    });

    const { tenantId } = getTenantContext(req);

    // Read CSV file buffer
    let csvText: string;
    try {
      csvText = req.file.buffer.toString('utf-8');
      if (!csvText || csvText.trim().length === 0) {
        return res.status(400).json({ error: 'CSV file is empty' });
      }
    } catch (bufferError: any) {
      logError('Error reading file buffer', bufferError, { userId: req.userId });
      return res.status(400).json({ error: 'Failed to read CSV file', details: bufferError.message });
    }

    // Quick parse to get record count for progress tracking
    const { data: parsedData } = parseCSV(csvText);
    const recordCount = parsedData.filter((row: any) => {
      if (!row) return false;
      return Object.values(row).some(val => val !== null && val !== undefined && val !== '');
    }).length;

    // Create import job for progress tracking
    const jobId = createImportJob(req.userId!, tenantId, recordCount);
    logInfo(`Created import job ${jobId} for ${recordCount} records`, { userId: req.userId, tenantId, jobId });

    // Return job ID immediately so client can start polling
    res.json({ 
      jobId,
      message: 'Import started',
      totalRecords: recordCount,
      status: 'processing'
    });

    // Process import in background (don't await)
    importLoansFromCSV(csvText, tenantId, req.userId!, jobId)
      .then(result => {
        logInfo(`Import ${jobId} completed successfully`, { 
          userId: req.userId, 
          tenantId, 
          jobId,
          inserted: result.inserted,
          updated: result.updated,
          errors: result.errors
        });
      })
      .catch(error => {
        logError(`Import ${jobId} failed`, error, { userId: req.userId, tenantId, jobId });
        completeImportJob(jobId, false, error.message);
      });
  } catch (error: any) {
    logError('Error importing loans', error, {
      userId: req.userId,
      hasFile: !!req.file,
      fileName: req.file?.originalname,
      fileSize: req.file?.size,
    });
    
    // Use the actual error message - it's already descriptive
    const errorMessage = error.message || 'Failed to import loans';
    
    res.status(500).json({ 
      error: errorMessage, 
      details: error.message || String(error),
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

/**
 * GET /api/dashboard/import/progress/:jobId
 * Get import progress status
 */
router.get('/import/progress/:jobId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const jobId = req.params.jobId as string;
    logInfo(`📊 Progress requested for job ${jobId}`, { userId: req.userId, jobId });
    const progress = getImportProgress(jobId);

    if (!progress) {
      logInfo(`❌ Import job not found: ${jobId}`, { userId: req.userId, jobId });
      return res.status(404).json({ error: 'Import job not found' });
    }

    // Verify the job belongs to the user
    if (progress.userId !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    logInfo(`✅ Returning progress for ${jobId}`, { 
      jobId,
      phase: progress.phase,
      status: progress.status,
      processed: progress.processedRecords,
      total: progress.totalRecords
    });
    res.json(progress);
  } catch (error: any) {
    logError('Error fetching import progress', error, { userId: req.userId });
    res.status(500).json({ error: 'Failed to fetch import progress' });
  }
});

/**
 * POST /api/dashboard/import/employees
 * Import employees from CSV file
 */
router.post('/import/employees', authenticateToken, attachTenantContext, upload.single('file'), async (req: AuthRequest, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { tenantId } = getTenantContext(req);

    // Read CSV file buffer
    const csvText = req.file.buffer.toString('utf-8');

    // Import employees using service
    const result = await importEmployeesFromCSV(csvText, tenantId, req.userId!);

    res.json(result);
  } catch (error: any) {
    logError('Error importing employees', error, { userId: req.userId });
    res.status(500).json({ error: 'Failed to import employees', details: error.message });
  }
});

export default router;

