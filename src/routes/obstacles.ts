import express from 'express';
import * as obstacleController from '../controllers/obstacleController';
import { authenticate } from '../middleware/auth';

const router = express.Router();

// 本地监控端点（不需要认证）
router.get('/status-local', obstacleController.getObstacleStatus);

// 需要认证的端点
router.get('/status', authenticate, obstacleController.getObstacleStatus);
router.post('/config', authenticate, obstacleController.configObstacleDetection);

export default router;
