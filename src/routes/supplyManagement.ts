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

// 任务管理 (仅保留有对应ROS2服务的操作)
router.post('/task/pause', supplyManagementController.pauseTask);
router.post('/task/resume', supplyManagementController.resumeTask);
router.post('/task/stop', supplyManagementController.stopTask);
router.get('/task/path', supplyManagementController.getTaskPath);

// 手动控制
router.post('/control/manual', supplyManagementController.manualControl);

// 系统监控
router.get('/system/metrics', supplyManagementController.getSystemMetrics);
router.get('/system/nodes', supplyManagementController.getNodeStatus);

// 水位监控
router.get('/water/status', supplyManagementController.getWaterLevelStatus);
router.get('/water/history', supplyManagementController.getWaterLevelHistory);

// 补水站继电器控制
router.get('/watering/relay/status', supplyManagementController.getRelayStatus);
router.post('/watering/relay/start', supplyManagementController.startWateringRelay);
router.post('/watering/relay/stop', supplyManagementController.stopWateringRelay);
router.get('/watering/relay/wifi', supplyManagementController.getRelayWifiInfo);

// 充电桩Modbus控制
router.get('/charging/status', supplyManagementController.getChargingStatus);
router.post('/charging/start', supplyManagementController.startCharging);
router.post('/charging/stop', supplyManagementController.stopCharging);

export default router;
