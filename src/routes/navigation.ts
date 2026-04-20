import express from 'express';
import * as navigationController from '../controllers/navigationController';
import { authenticate } from '../middleware/auth';

const router = express.Router();

router.post('/start', authenticate, navigationController.startNavigation);
router.post('/pause', authenticate, navigationController.pauseNavigation);
router.post('/resume', authenticate, navigationController.resumeNavigation);
router.post('/stop', authenticate, navigationController.stopNavigation);
router.get('/status/:taskId', authenticate, navigationController.getNavigationStatus);
router.post('/goto-point', authenticate, navigationController.gotoPoint);
router.post('/set-initial-pose', authenticate, navigationController.setInitialPose);
router.get('/robot-position', navigationController.getRobotPosition);

export default router;
