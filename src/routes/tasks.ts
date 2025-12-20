import { Router } from 'express';
import {
  getTasks,
  getTaskById,
  createTask,
  updateTask,
  updateTaskOrder,
  deleteTask,
  executeTask,
  pauseTask,
  resumeTask,
  stopTask,
} from '../controllers/taskController';
import {
  executeTaskSequence,
  setInitialPositionAndExecute,
} from '../controllers/taskSequenceController';
import { authenticate, authorize } from '../middleware/auth';
import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';

const router = Router();

router.get('/', authenticate, getTasks);
router.get('/:id', authenticate, getTaskById);
router.post('/', authenticate, authorize('admin', 'operator'), createTask);
router.put('/order', authenticate, authorize('admin', 'operator'), updateTaskOrder);
router.put('/:id', authenticate, authorize('admin', 'operator'), updateTask);
router.delete('/:id', authenticate, authorize('admin'), deleteTask);
router.post('/:id/execute', authenticate, authorize('admin', 'operator'), executeTask);
router.post('/:id/pause', authenticate, authorize('admin', 'operator'), pauseTask);
router.post('/:id/resume', authenticate, authorize('admin', 'operator'), resumeTask);
router.post('/:id/stop', authenticate, authorize('admin', 'operator'), stopTask);

// 任务序列执行
router.post('/sequence/execute', authenticate, authorize('admin', 'operator'), executeTaskSequence);
router.post('/set-initial-and-execute', authenticate, authorize('admin', 'operator'), setInitialPositionAndExecute);

// 测试端点：模拟导航目标到达
router.post('/:id/test/goal-reached', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const taskExecutionService = require('../services/taskExecutionService').default;
    await taskExecutionService.onNavigationGoalReached(id);
    res.json({ message: 'Navigation goal reached event triggered' });
  } catch (error: any) {
    console.error('Test goal reached error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// 测试端点：模拟导航失败
router.post('/:id/test/goal-failed', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const taskExecutionService = require('../services/taskExecutionService').default;
    await taskExecutionService.onNavigationGoalFailed(id, reason || 'Test failure');
    res.json({ message: 'Navigation goal failed event triggered' });
  } catch (error: any) {
    console.error('Test goal failed error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
