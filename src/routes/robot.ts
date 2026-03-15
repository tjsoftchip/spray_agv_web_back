import { Router } from 'express';
import * as robotController from '../controllers/robotController';
import { authenticate } from '../middleware/auth';

const router = Router();

// 本地监控端点（不需要认证）- 用于状态监控页面
router.get('/status-local', robotController.getRobotStatus);
router.get('/battery/status-local', robotController.getBatteryStatus);
router.get('/water/status-local', robotController.getWaterStatus);

// 需要认证的端点
router.use(authenticate);

router.get('/status', robotController.getRobotStatus);
router.get('/battery/status', robotController.getBatteryStatus);
router.get('/water/status', robotController.getWaterStatus);
router.post('/motion/teleop', robotController.controlMotion);
router.post('/motion/stop', robotController.stopMotion);
router.post('/control-spray', robotController.controlSpray);
router.post('/start-navigation', robotController.startNavigation);
router.post('/stop-navigation', robotController.stopNavigation);
router.post('/emergency-stop', robotController.emergencyStop);

export default router;
