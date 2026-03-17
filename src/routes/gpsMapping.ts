import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as gpsMappingController from '../controllers/gpsMappingController';

const router = Router();

// ==================== 公开端点（需要认证） ====================

// 原点校准
router.post('/origin/start', authenticate, (req, res) => gpsMappingController.startOriginCalibration(req, res));
router.post('/origin/complete', authenticate, (req, res) => gpsMappingController.completeOriginCalibration(req, res));
router.get('/origin', authenticate, (req, res) => gpsMappingController.getOrigin(req, res));

// 道路采集
router.post('/roads/start', authenticate, (req, res) => gpsMappingController.startRoadRecording(req, res));
router.post('/roads/:roadId/points', authenticate, (req, res) => gpsMappingController.recordRoadPoint(req, res));
router.post('/roads/end', authenticate, (req, res) => gpsMappingController.endRoadRecording(req, res));
router.get('/roads', authenticate, (req, res) => gpsMappingController.getRoads(req, res));
router.put('/roads/:roadId', authenticate, (req, res) => gpsMappingController.updateRoad(req, res));
router.delete('/roads/:roadId', authenticate, (req, res) => gpsMappingController.deleteRoad(req, res));

// 交叉点自动识别
router.post('/intersections/generate', authenticate, (req, res) => gpsMappingController.generateIntersections(req, res));
router.get('/intersections', authenticate, (req, res) => gpsMappingController.getIntersections(req, res));

// 转弯路线（新增）
router.get('/turn-paths', authenticate, (req, res) => gpsMappingController.getTurnPaths(req, res));

// 梁位自动识别与标注
router.post('/beam-positions/generate', authenticate, (req, res) => gpsMappingController.generateBeamPositions(req, res));
router.get('/beam-positions', authenticate, (req, res) => gpsMappingController.getBeamPositions(req, res));
router.put('/beam-positions/:beamId', authenticate, (req, res) => gpsMappingController.updateBeamPosition(req, res));
router.delete('/beam-positions/:beamId', authenticate, (req, res) => gpsMappingController.deleteBeamPosition(req, res));

// 地图文件生成
router.post('/generate-files', authenticate, (req, res) => gpsMappingController.generateMapFiles(req, res));

// 建图状态
router.get('/status', authenticate, (req, res) => gpsMappingController.getMappingStatus(req, res));
router.post('/reset', authenticate, (req, res) => gpsMappingController.resetMapping(req, res));

// 数据库持久化
router.post('/save', authenticate, (req, res) => gpsMappingController.saveMappingToDatabase(req, res));
router.get('/load/:id', authenticate, (req, res) => gpsMappingController.loadMappingFromDatabase(req, res));
router.get('/maps', authenticate, (req, res) => gpsMappingController.getSavedMaps(req, res));
router.delete('/maps/:id', authenticate, (req, res) => gpsMappingController.deleteSavedMap(req, res));

// 坐标转换
router.post('/convert/gps-to-map', authenticate, (req, res) => gpsMappingController.convertGPSToMap(req, res));
router.post('/convert/map-to-gps', authenticate, (req, res) => gpsMappingController.convertMapToGPS(req, res));

// GPS状态（兼容旧API）
router.get('/gps-status', authenticate, (req, res) => gpsMappingController.getGPSStatus(req, res));

// ==================== 兼容旧API ====================

// 本地端点（不需要认证）
router.get('/status-local', (req, res) => gpsMappingController.getGPSStatusLocal(req, res));
router.get('/saved-maps-local', (req, res) => gpsMappingController.getSavedMapsLocal(req, res));
router.post('/save-local', (req, res) => gpsMappingController.saveGPSMapLocal(req, res));
router.get('/:id/load-local', (req, res) => gpsMappingController.loadGPSMapLocal(req, res));
router.delete('/:id/delete-local', (req, res) => gpsMappingController.deleteGPSMapLocal(req, res));

// 路线点管理（兼容旧API）
router.post('/route-points', authenticate, (req, res) => gpsMappingController.addRoutePoint(req, res));
router.delete('/route-points/:pointId', authenticate, (req, res) => gpsMappingController.deleteRoutePoint(req, res));
router.put('/route-points/:pointId', authenticate, (req, res) => gpsMappingController.updateRoutePoint(req, res));

// 转弯点管理（已废弃）
router.post('/turn-points', authenticate, (req, res) => gpsMappingController.addTurnPoint(req, res));
router.delete('/turn-points/:pointId', authenticate, (req, res) => gpsMappingController.deleteTurnPoint(req, res));
router.put('/turn-points/:pointId', authenticate, (req, res) => gpsMappingController.updateTurnPoint(req, res));

// 梁位置管理（兼容旧API）
router.post('/beam-positions', authenticate, (req, res) => gpsMappingController.addBeamPosition(req, res));

// 坐标转换（兼容旧API）
router.post('/convert-to-map', authenticate, (req, res) => gpsMappingController.convertGPSToMap(req, res));
router.post('/convert-to-gps', authenticate, (req, res) => gpsMappingController.convertMapToGPS(req, res));

export default router;