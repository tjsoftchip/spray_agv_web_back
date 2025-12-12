import { Router } from 'express';
import * as taskQueueController from '../controllers/taskQueueController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', taskQueueController.getTaskQueue);
router.post('/tasks', taskQueueController.addTaskToQueue);
router.delete('/tasks/:taskId', taskQueueController.removeTaskFromQueue);
router.put('/reorder', taskQueueController.reorderQueue);
router.post('/start', taskQueueController.startQueue);
router.post('/pause', taskQueueController.pauseQueue);
router.post('/resume', taskQueueController.resumeQueue);
router.post('/stop', taskQueueController.stopQueue);

export default router;
