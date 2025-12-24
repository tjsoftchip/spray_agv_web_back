import { Router } from 'express';
import {
  getTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  // 导航点管理
  getNavigationPoints,
  addNavigationPoint,
  updateNavigationPoint,
  deleteNavigationPoint,
  reorderNavigationPoints,
  // 路段管理
  getRoadSegments,
  generateRoadSegments,
  addRoadSegment,
  updateRoadSegment,
  deleteRoadSegment,
  // 机器人位置
  getCurrentRobotPosition,
  // 初始位置设置
  setInitialPose,
  getInitialPoseStatus,
  // 路径预览和验证
  generatePathPreview,
  validateNavigation,
} from '../controllers/templateController';
import { authenticate, authorize } from '../middleware/auth';
import { cacheMiddleware, clearCacheMiddleware } from '../middleware/cache';

const router = Router();

// 模板基础管理
router.get('/', authenticate, cacheMiddleware(30000), getTemplates);
router.get('/:id', authenticate, cacheMiddleware(30000), getTemplateById);
router.post('/', authenticate, authorize('admin', 'operator'), clearCacheMiddleware('cache:/api/templates'), createTemplate);
router.put('/:id', authenticate, authorize('admin', 'operator'), clearCacheMiddleware('cache:/api/templates'), updateTemplate);
router.delete('/:id', authenticate, authorize('admin'), clearCacheMiddleware('cache:/api/templates'), deleteTemplate);

// 导航点管理
router.get('/:templateId/navigation-points', authenticate, getNavigationPoints);
router.post('/:templateId/navigation-points', authenticate, clearCacheMiddleware('cache:/api/templates'), addNavigationPoint);
router.put('/:templateId/navigation-points/:pointId', authenticate, clearCacheMiddleware('cache:/api/templates'), updateNavigationPoint);
router.delete('/:templateId/navigation-points/:pointId', authenticate, clearCacheMiddleware('cache:/api/templates'), deleteNavigationPoint);
router.put('/:templateId/navigation-points/reorder', authenticate, clearCacheMiddleware('cache:/api/templates'), reorderNavigationPoints);

// 路段管理
router.get('/:templateId/road-segments', authenticate, getRoadSegments);
router.post('/:templateId/road-segments/generate', authenticate, clearCacheMiddleware('cache:/api/templates'), generateRoadSegments);
router.post('/:templateId/road-segments', authenticate, clearCacheMiddleware('cache:/api/templates'), addRoadSegment);
router.put('/:templateId/road-segments/:segmentId', authenticate, clearCacheMiddleware('cache:/api/templates'), updateRoadSegment);
router.delete('/:templateId/road-segments/:segmentId', authenticate, clearCacheMiddleware('cache:/api/templates'), deleteRoadSegment);

// 机器人位置
router.get('/robot/current-position', authenticate, getCurrentRobotPosition);

// 初始位置设置
router.post('/initial-pose', authenticate, authorize('admin', 'operator'), setInitialPose);
router.get('/initial-pose/status', getInitialPoseStatus);

// 路径预览和验证
router.post('/:id/generate-path-preview', authenticate, generatePathPreview);
router.post('/:id/validate-navigation', authenticate, validateNavigation);

export default router;
