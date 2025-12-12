import { Router } from 'express';
import {
  getTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from '../controllers/templateController';
import { authenticate, authorize } from '../middleware/auth';
import { cacheMiddleware, clearCacheMiddleware } from '../middleware/cache';

const router = Router();

router.get('/', authenticate, cacheMiddleware(30000), getTemplates);
router.get('/:id', authenticate, cacheMiddleware(30000), getTemplateById);
router.post('/', authenticate, authorize('admin', 'operator'), clearCacheMiddleware('cache:/api/templates'), createTemplate);
router.put('/:id', authenticate, authorize('admin', 'operator'), clearCacheMiddleware('cache:/api/templates'), updateTemplate);
router.delete('/:id', authenticate, authorize('admin'), clearCacheMiddleware('cache:/api/templates'), deleteTemplate);

export default router;
