import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as gpsMappingController from '../controllers/gpsMappingController';

const router = Router();

// ==================== 本地端点（不需要认证） ====================

// 原点校准
router.post('/origin/start-local', gpsMappingController.startOriginCalibration);
router.post('/origin/complete-local', gpsMappingController.completeOriginCalibration);
router.get('/origin-local', gpsMappingController.getOrigin);

// 道路采集
router.post('/roads/start-local', gpsMappingController.startRoadRecording);
router.post('/roads/end-local', gpsMappingController.endRoadRecording);
router.get('/roads-local', gpsMappingController.getRoads);

// 交叉点与圆弧
router.post('/intersections/generate-local', gpsMappingController.generateIntersections);
router.get('/intersections-local', gpsMappingController.getIntersections);
router.get('/turn-arcs-local', gpsMappingController.getTurnArcs);

// 梁位
router.post('/beam-positions/generate-local', gpsMappingController.generateBeamPositions);
router.get('/beam-positions-local', gpsMappingController.getBeamPositions);

// 地图文件生成
router.post('/generate-files-local', gpsMappingController.generateMapFiles);
router.get('/generation-status-local', gpsMappingController.getGenerationStatus);

// 建图状态
router.get('/status-local', gpsMappingController.getMappingStatus);
router.post('/reset-local', gpsMappingController.resetMapping);

// 数据库持久化
router.post('/save-local', gpsMappingController.saveMappingToDatabase);
router.get('/maps-local', gpsMappingController.getSavedMaps);

// 坐标转换（本地端点，无需认证）
router.post('/convert/gps-to-map-local', gpsMappingController.convertGPSToMap);
router.post('/convert/map-to-gps-local', gpsMappingController.convertMapToGPS);

// GPS状态
router.get('/gps-status-local', gpsMappingController.getGPSStatus);

// ==================== 认证端点 ====================

// 原点校准
router.post('/origin/start', authenticate, gpsMappingController.startOriginCalibration);
router.post('/origin/complete', authenticate, gpsMappingController.completeOriginCalibration);
router.get('/origin', authenticate, gpsMappingController.getOrigin);

// 道路采集
router.post('/roads/start', authenticate, gpsMappingController.startRoadRecording);
router.post('/roads/:roadId/points', authenticate, gpsMappingController.recordRoadPoint);
router.post('/roads/end', authenticate, gpsMappingController.endRoadRecording);
router.get('/roads', authenticate, gpsMappingController.getRoads);
router.put('/roads/:roadId', authenticate, gpsMappingController.updateRoad);
router.delete('/roads/:roadId', authenticate, gpsMappingController.deleteRoad);

// 交叉点与圆弧生成
router.post('/intersections/generate', authenticate, gpsMappingController.generateIntersections);
router.get('/intersections', authenticate, gpsMappingController.getIntersections);
router.get('/turn-arcs', authenticate, gpsMappingController.getTurnArcs);

// 梁位
router.post('/beam-positions/generate', authenticate, gpsMappingController.generateBeamPositions);
router.get('/beam-positions', authenticate, gpsMappingController.getBeamPositions);
router.put('/beam-positions/:beamId', authenticate, gpsMappingController.updateBeamPosition);
router.delete('/beam-positions/:beamId', authenticate, gpsMappingController.deleteBeamPosition);

// 地图文件生成
router.post('/generate-files', authenticate, gpsMappingController.generateMapFiles);
router.get('/generation-status', authenticate, gpsMappingController.getGenerationStatus);

// 建图状态
router.get('/status', authenticate, gpsMappingController.getMappingStatus);
router.post('/reset', authenticate, gpsMappingController.resetMapping);

// 数据库持久化
router.post('/save', authenticate, gpsMappingController.saveMappingToDatabase);
router.get('/load/:id', authenticate, gpsMappingController.loadMappingFromDatabase);
router.get('/maps', authenticate, gpsMappingController.getSavedMaps);
router.delete('/maps/:id', authenticate, gpsMappingController.deleteSavedMap);

// 坐标转换
router.post('/convert/gps-to-map', authenticate, gpsMappingController.convertGPSToMap);
router.post('/convert/map-to-gps', authenticate, gpsMappingController.convertMapToGPS);

// GPS状态
router.get('/gps-status', authenticate, gpsMappingController.getGPSStatus);

// 导出原始数据
router.get('/export-raw', authenticate, gpsMappingController.exportRawGPSData);

// 调试用：获取会话信息
router.get('/debug', authenticate, gpsMappingController.getSessionDebug);

export default router;
