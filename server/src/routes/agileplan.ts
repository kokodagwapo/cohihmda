import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import {
  getBoards,
  saveBoard,
  getColumns,
  createColumn,
  updateColumn,
  deleteColumn,
  createTask,
  updateTask,
  moveTask,
  deleteTask,
  getActivities,
  logActivity,
} from '../controllers/agileplanController.js';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Board routes
router.get('/boards', getBoards);
router.post('/boards', saveBoard);

// Column routes
router.get('/boards/:boardId/columns', getColumns);
router.post('/columns', createColumn);
router.put('/columns/:id', updateColumn);
router.delete('/columns/:id', deleteColumn);

// Task routes
router.post('/tasks', createTask);
router.put('/tasks/:id', updateTask);
router.put('/tasks/:id/move', moveTask);
router.delete('/tasks/:id', deleteTask);

// Activity routes
router.get('/activities', getActivities);
router.post('/activities', logActivity);

export default router;
