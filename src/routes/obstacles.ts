import express from 'express';
import * as obstacleController from '../controllers/obstacleController';
import { authenticate } from '../middleware/auth';

const router = express.Router();

router.get('/status', authenticate, obstacleController.getObstacleStatus);
router.post('/config', authenticate, obstacleController.configObstacleDetection);

export default router;
