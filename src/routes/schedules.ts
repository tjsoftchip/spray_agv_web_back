import { Router } from 'express';
import * as scheduleController from '../controllers/scheduleController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', scheduleController.getSchedules);
router.get('/:id', scheduleController.getSchedule);
router.post('/', scheduleController.createSchedule);
router.put('/:id', scheduleController.updateSchedule);
router.delete('/:id', scheduleController.deleteSchedule);
router.put('/:id/enable', scheduleController.enableSchedule);
router.put('/:id/disable', scheduleController.disableSchedule);

export default router;
