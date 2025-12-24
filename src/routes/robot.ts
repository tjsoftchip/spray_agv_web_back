import { Router } from 'express';
import * as robotController from '../controllers/robotController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/status', robotController.getRobotStatus);
router.post('/motion/teleop', robotController.controlMotion);
router.post('/motion/stop', robotController.stopMotion);
router.post('/control-spray', robotController.controlSpray);
router.post('/start-navigation', robotController.startNavigation);
router.post('/stop-navigation', robotController.stopNavigation);
router.post('/emergency-stop', robotController.emergencyStop);

export default router;
