import { Router } from 'express';
import {
  getTasks,
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
  executeTask,
  pauseTask,
  resumeTask,
  stopTask,
} from '../controllers/taskController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.get('/', authenticate, getTasks);
router.get('/:id', authenticate, getTaskById);
router.post('/', authenticate, authorize('admin', 'operator'), createTask);
router.put('/:id', authenticate, authorize('admin', 'operator'), updateTask);
router.delete('/:id', authenticate, authorize('admin'), deleteTask);
router.post('/:id/execute', authenticate, authorize('admin', 'operator'), executeTask);
router.post('/:id/pause', authenticate, authorize('admin', 'operator'), pauseTask);
router.post('/:id/resume', authenticate, authorize('admin', 'operator'), resumeTask);
router.post('/:id/stop', authenticate, authorize('admin', 'operator'), stopTask);

export default router;
