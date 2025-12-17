import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as mapController from '../controllers/mapController';

const router = Router();

// 添加不需要认证的本地端点
router.get('/mapping-status-local', (req, res) => mapController.getMappingStatusLocal(req, res));
router.post('/start-mapping-local', (req, res) => mapController.startMappingLocal(req, res));
router.post('/stop-mapping-local', (req, res) => mapController.stopMappingLocal(req, res));
router.post('/save-local', (req, res) => mapController.saveMapLocal(req, res));
router.get('/scan-local', (req, res) => mapController.scanLocalMaps(req, res));
router.get('/active-local', (req, res) => mapController.getActiveMap(req, res));
router.delete('/:id/delete-local', (req, res) => mapController.deleteMap(req, res));
router.put('/:id/set-active-local', (req, res) => mapController.setActiveMap(req, res));
router.post('/:id/load-local', (req, res) => mapController.loadMap(req, res));
router.get('/:id/image', (req, res) => mapController.getMapImage(req, res));

router.use(authenticate);

router.get('/', (req, res) => mapController.getMaps(req, res));
router.get('/active', (req, res) => mapController.getActiveMap(req, res));
router.get('/mapping-status', (req, res) => mapController.getMappingStatus(req, res));
router.put('/:id/active', (req, res) => mapController.setActiveMap(req, res));
router.post('/start-mapping', (req, res) => mapController.startMapping(req, res));
router.post('/stop-mapping', (req, res) => mapController.stopMapping(req, res));
router.post('/force-stop-mapping', (req, res) => mapController.forceStopMapping(req, res));
router.post('/save', (req, res) => mapController.saveMap(req, res));
router.post('/:id/load', (req, res) => mapController.loadMap(req, res));
router.delete('/:id', (req, res) => mapController.deleteMap(req, res));

export default router;