import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../../middleware/auth.js';
import { z } from 'zod';
import {
  generateUnifiedTemplate,
  generateBusinessOverviewTemplate,
  generateTopTieringTemplate,
  generateLeaderboardTemplate,
  generateCombinedTemplate,
} from '../../services/csvTemplateService.js';

const router = Router();

/**
 * GET /api/dashboard/csv/template
 * Download CSV template for a specific section
 */
router.get('/csv/template', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { type = 'unified' } = z.object({
      type: z.enum(['unified', 'business-overview', 'top-tiering', 'leaderboard', 'combined']).optional(),
    }).parse(req.query);

    let csvContent: string;
    let filename: string;

    switch (type) {
      case 'business-overview':
        csvContent = generateBusinessOverviewTemplate();
        filename = 'business-overview-template.csv';
        break;
      case 'top-tiering':
        csvContent = generateTopTieringTemplate();
        filename = 'top-tiering-template.csv';
        break;
      case 'leaderboard':
        csvContent = generateLeaderboardTemplate();
        filename = 'leaderboard-template.csv';
        break;
      case 'combined':
        csvContent = generateCombinedTemplate();
        filename = 'combined-dashboard-template.csv';
        break;
      case 'unified':
      default:
        csvContent = generateUnifiedTemplate();
        filename = 'unified-loan-template.csv';
        break;
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    console.error('Error generating CSV template:', error);
    res.status(500).json({ error: 'Failed to generate CSV template' });
  }
});

export default router;

