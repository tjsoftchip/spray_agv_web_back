import { Router } from 'express';
import * as mapController from '../controllers/mapController';
import { authenticate } from '../middleware/auth';

const router = Router();

// 添加不需要认证的本地状态检查端点
router.get('/mapping-status-local', mapController.getMappingStatusLocal);
router.post('/start-mapping-local', mapController.startMappingLocal);
router.post('/stop-mapping-local', mapController.stopMappingLocal);
router.post('/save-local', mapController.saveMapLocal);

router.use(authenticate);

router.get('/', mapController.getMaps);
router.get('/active', mapController.getActiveMap);
router.get('/mapping-status', mapController.getMappingStatus);
router.put('/:id/active', mapController.setActiveMap);
router.post('/start-mapping', mapController.startMapping);
router.post('/stop-mapping', mapController.stopMapping);
router.post('/save', mapController.saveMap);
router.post('/:id/load', mapController.loadMap);
router.delete('/:id', mapController.deleteMap);

export default router;
