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
  updateRoadSegment,
  // 机器人位置
  getCurrentRobotPosition,
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
router.post('/:templateId/navigation-points', authenticate, addNavigationPoint);
router.put('/:templateId/navigation-points/:pointId', authenticate, updateNavigationPoint);
router.delete('/:templateId/navigation-points/:pointId', authenticate, deleteNavigationPoint);
router.put('/:templateId/navigation-points/reorder', authenticate, reorderNavigationPoints);

// 路段管理
router.get('/:templateId/road-segments', authenticate, getRoadSegments);
router.post('/:templateId/road-segments/generate', authenticate, generateRoadSegments);
router.put('/:templateId/road-segments/:segmentId', authenticate, updateRoadSegment);

// 机器人位置
router.get('/robot/current-position', authenticate, getCurrentRobotPosition);

export default router;
