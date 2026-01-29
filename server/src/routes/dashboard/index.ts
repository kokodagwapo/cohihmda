import { Router } from 'express';
import analyticsRouter from './analytics.js';
import importRouter from './import.js';
import dataRouter from './data.js';
import templatesRouter from './templates.js';
import insightDetailsRouter from './insightDetails.js';

const router = Router();

// Mount all dashboard sub-routers
router.use('/', analyticsRouter);
router.use('/', importRouter);
router.use('/', dataRouter);
router.use('/', templatesRouter);
router.use('/insights', insightDetailsRouter);

export default router;

