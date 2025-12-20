import { Router } from 'express';
import * as supplyManagementController from '../controllers/supplyManagementController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// GPU监控
router.get('/gpu/metrics', supplyManagementController.getGPUMetrics);

// 补给管理状态
router.get('/supply/status', supplyManagementController.getSupplyStatus);

// 补给流程控制
router.post('/supply/start', supplyManagementController.startSupply);
router.post('/supply/pause', supplyManagementController.pauseSupply);
router.post('/supply/resume', supplyManagementController.resumeSupply);
router.post('/supply/stop', supplyManagementController.stopSupply);

// 任务管理
router.post('/task/create', supplyManagementController.createTask);
router.post('/task/start', supplyManagementController.startTask);
router.post('/task/pause', supplyManagementController.pauseTask);
router.post('/task/resume', supplyManagementController.resumeTask);
router.post('/task/save', supplyManagementController.saveTask);
router.post('/task/load', supplyManagementController.loadTask);
router.post('/task/stop', supplyManagementController.stopTask);
router.get('/task/path', supplyManagementController.getTaskPath);

// 手动控制
router.post('/control/manual', supplyManagementController.manualControl);

// 系统监控
router.get('/system/metrics', supplyManagementController.getSystemMetrics);
router.get('/system/nodes', supplyManagementController.getNodeStatus);

export default router;