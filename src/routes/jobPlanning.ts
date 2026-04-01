import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as jobPlanningController from '../controllers/jobPlanningController';

const router = Router();

// 本地端点（不需要认证）
router.get('/beam-positions-local', (req, res) => jobPlanningController.getBeamPositionsLocal(req, res));
router.post('/plan-routes-local', (req, res) => jobPlanningController.planRoutesLocal(req, res));
router.get('/status-local', (req, res) => jobPlanningController.getJobStatusLocal(req, res));
router.post('/preview-local', (req, res) => jobPlanningController.previewRouteLocal(req, res));
router.get('/map-data-local', (req, res) => jobPlanningController.getMapDataLocal(req, res));

// 认证端点
router.use(authenticate);

// 获取所有梁位信息
router.get('/beam-positions', (req, res) => jobPlanningController.getBeamPositions(req, res));

// 获取地图数据（供前端可视化）
router.get('/map-data', (req, res) => jobPlanningController.getMapData(req, res));

// 预览作业路线（不保存）
router.post('/preview', (req, res) => jobPlanningController.previewRoute(req, res));

// 规划作业线路
router.post('/plan-routes', (req, res) => jobPlanningController.planRoutes(req, res));

// 执行喷淋作业
router.post('/execute', (req, res) => jobPlanningController.executeJob(req, res));

// 暂停作业
router.post('/pause', (req, res) => jobPlanningController.pauseJob(req, res));

// 恢复作业
router.post('/resume', (req, res) => jobPlanningController.resumeJob(req, res));

// 停止作业
router.post('/stop', (req, res) => jobPlanningController.stopJob(req, res));

// 获取作业状态
router.get('/status', (req, res) => jobPlanningController.getJobStatus(req, res));

// 获取作业历史
router.get('/history', (req, res) => jobPlanningController.getJobHistory(req, res));

export default router;
