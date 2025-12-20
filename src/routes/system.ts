import { Router } from 'express';
import * as systemController from '../controllers/systemController';

const router = Router();

// 获取系统状态
router.get('/status', systemController.getSystemStatus);

// 获取当前模式
router.get('/mode', systemController.getCurrentModeApi);

// 切换系统模式
router.post('/switch-mode', systemController.switchMode);

// 重启系统层
router.post('/restart-layer', systemController.restartLayer);

// 获取系统日志
router.get('/logs', systemController.getSystemLogs);

// 获取节点列表
router.get('/nodes', systemController.getNodeList);

// 获取话题列表
router.get('/topics', systemController.getTopicList);

export default router;