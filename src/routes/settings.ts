import { Router } from 'express';
import * as settingsController from '../controllers/settingsController';

const router = Router();

// 获取所有系统配置
router.get('/', settingsController.getAllConfigs);

// 更新单个配置
router.put('/update', settingsController.updateConfig);

// 批量更新配置
router.put('/batch-update', settingsController.updateMultipleConfigs);

// 获取特定配置
router.get('/:key', settingsController.getConfig);

export default router;