import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as gpsMappingController from '../controllers/gpsMappingController';

const router = Router();

// 本地端点（不需要认证）
router.get('/status-local', (req, res) => gpsMappingController.getGPSStatusLocal(req, res));
router.get('/saved-maps-local', (req, res) => gpsMappingController.getSavedMapsLocal(req, res));
router.post('/save-local', (req, res) => gpsMappingController.saveGPSMapLocal(req, res));
router.post('/:id/load-local', (req, res) => gpsMappingController.loadGPSMapLocal(req, res));
router.delete('/:id/delete-local', (req, res) => gpsMappingController.deleteGPSMapLocal(req, res));

// 认证端点
router.use(authenticate);

router.get('/status', (req, res) => gpsMappingController.getGPSStatus(req, res));
router.get('/saved-maps', (req, res) => gpsMappingController.getSavedMaps(req, res));
router.post('/save', (req, res) => gpsMappingController.saveGPSMap(req, res));
router.post('/:id/load', (req, res) => gpsMappingController.loadGPSMap(req, res));
router.delete('/:id', (req, res) => gpsMappingController.deleteGPSMap(req, res));

// 路线点管理
router.post('/route-points', (req, res) => gpsMappingController.addRoutePoint(req, res));
router.delete('/route-points/:pointId', (req, res) => gpsMappingController.deleteRoutePoint(req, res));
router.put('/route-points/:pointId', (req, res) => gpsMappingController.updateRoutePoint(req, res));

// 转弯点管理
router.post('/turn-points', (req, res) => gpsMappingController.addTurnPoint(req, res));
router.delete('/turn-points/:pointId', (req, res) => gpsMappingController.deleteTurnPoint(req, res));
router.put('/turn-points/:pointId', (req, res) => gpsMappingController.updateTurnPoint(req, res));

// 梁位置管理
router.post('/beam-positions', (req, res) => gpsMappingController.addBeamPosition(req, res));
router.delete('/beam-positions/:beamId', (req, res) => gpsMappingController.deleteBeamPosition(req, res));
router.put('/beam-positions/:beamId', (req, res) => gpsMappingController.updateBeamPosition(req, res));

// 坐标转换
router.post('/convert-to-map', (req, res) => gpsMappingController.convertGPSToMap(req, res));
router.post('/convert-to-gps', (req, res) => gpsMappingController.convertMapToGPS(req, res));

export default router;
