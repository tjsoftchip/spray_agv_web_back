/**
 * GPS建图控制器
 * 按照文档 web-gps-mapping-design.md 实现完整功能
 * 
 * ROS2服务调用:
 * - /gps/fix: 订阅GPS实时数据
 * - /gps_mapping/start_recording: 开始GPS记录
 * - /gps_mapping/stop_recording: 停止GPS记录
 * - /gps_mapping/export_data: 导出数据
 * - /gps_to_map/set_current_as_origin: 设置GPS原点
 */

import { Request, Response } from 'express';
import GPSMap, { Road, Intersection, TurnPath, BeamPosition, GPSPoint, MapPoint } from '../models/GPSMap';
import {
  CoordinateService,
  IntersectionDetector,
  BeamPositionGenerator,
  TurnPathGenerator,
  MapFileGenerator,
  SprayModeDecider
} from '../services/gpsMappingService';
import rosbridgeService from '../services/rosbridgeService';
import fs from 'fs';
import path from 'path';

// 当前建图会话状态
interface MappingSession {
  id: string;
  status: 'idle' | 'origin_calibration' | 'road_recording' | 'beam_annotation' | 'generating' | 'completed';
  currentRoadId: string | null;
  currentRoadType: 'longitudinal' | 'horizontal' | null;
  origin: {
    gps: GPSPoint;
    utm: { zone: number; easting: number; northing: number };
    rotation: number;
  } | null;
  supplyStation: {
    gps: GPSPoint;
    mapXy: MapPoint;
  } | null;
  roads: Road[];
  intersections: Intersection[];
  turnPaths: TurnPath[];
  beamPositions: BeamPosition[];
  recordingStartTime: number | null;
  lastUpdateTime: number;
}

// 全局建图会话（单例模式，一个系统只有一个活跃的建图会话）
let currentSession: MappingSession | null = null;

// 服务实例
let coordinateService: CoordinateService | null = null;
const intersectionDetector = new IntersectionDetector(5.0);
const turnPathGenerator = new TurnPathGenerator(4.5);
let mapFileGenerator: MapFileGenerator | null = null;
const sprayModeDecider = new SprayModeDecider();

// 获取或创建建图会话
function getOrCreateSession(): MappingSession {
  if (!currentSession) {
    currentSession = {
      id: `session_${Date.now()}`,
      status: 'idle',
      currentRoadId: null,
      currentRoadType: null,
      origin: null,
      supplyStation: null,
      roads: [],
      intersections: [],
      turnPaths: [],
      beamPositions: [],
      recordingStartTime: null,
      lastUpdateTime: Date.now()
    };
  }
  return currentSession;
}

// 初始化坐标服务
function initCoordinateService(origin: { latitude: number; longitude: number; rotation: number }) {
  coordinateService = new CoordinateService(origin);
  mapFileGenerator = new MapFileGenerator(coordinateService);
}

// ==================== 原点校准相关 ====================

/**
 * 开始原点校准
 * POST /api/gps-mapping/origin/start
 */
export const startOriginCalibration = async (req: Request, res: Response) => {
  try {
    const session = getOrCreateSession();
    session.status = 'origin_calibration';
    session.lastUpdateTime = Date.now();

    res.json({
      success: true,
      message: '原点校准已开始，请将车辆停放在补给站位置',
      data: {
        sessionId: session.id,
        status: session.status
      }
    });
  } catch (error) {
    console.error('开始原点校准失败:', error);
    res.status(500).json({ success: false, message: '开始原点校准失败' });
  }
};

/**
 * 完成原点校准
 * POST /api/gps-mapping/origin/complete
 * 参数: { latitude, longitude, altitude?, rotation?, arUcoDetected? }
 * 
 * ROS2调用:
 * - 调用 /gps_to_map/set_current_as_origin 服务设置ROS2端原点
 */
export const completeOriginCalibration = async (req: Request, res: Response) => {
  try {
    const { latitude, longitude, altitude = 0, rotation = 0, arUcoDetected = false } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: '请提供有效的GPS坐标'
      });
    }

    const session = getOrCreateSession();

    // 初始化坐标服务
    initCoordinateService({ latitude, longitude, rotation });

    // 设置原点
    const utm = coordinateService!.toUTM(latitude, longitude);
    session.origin = {
      gps: { latitude, longitude, altitude },
      utm: { zone: utm.zone, easting: utm.easting, northing: utm.northing },
      rotation
    };

    // 补给站位置（原点即为补给站）
    session.supplyStation = {
      gps: { latitude, longitude, altitude },
      mapXy: { x: 0, y: 0 }
    };

    session.status = 'road_recording';
    session.lastUpdateTime = Date.now();

    // 调用ROS2服务设置GPS原点
    if (rosbridgeService.isConnected()) {
      try {
        await rosbridgeService.callService(
          '/gps_to_map/set_origin',
          'custom_interfaces/srv/SetGPSOrigin',
          {
            latitude,
            longitude,
            altitude,
            rotation
          }
        );
        console.log('[GPS建图] ROS2 GPS原点已设置');
      } catch (rosError) {
        console.warn('[GPS建图] 调用ROS2设置原点服务失败:', rosError);
        // 继续执行，不阻塞流程
      }
    }

    res.json({
      success: true,
      message: '原点校准完成',
      data: {
        origin: session.origin,
        supplyStation: session.supplyStation,
        status: session.status
      }
    });
  } catch (error) {
    console.error('完成原点校准失败:', error);
    res.status(500).json({ success: false, message: '完成原点校准失败' });
  }
};

/**
 * 获取原点信息
 * GET /api/gps-mapping/origin
 */
export const getOrigin = async (req: Request, res: Response) => {
  try {
    const session = getOrCreateSession();

    res.json({
      success: true,
      data: session.origin
    });
  } catch (error) {
    console.error('获取原点信息失败:', error);
    res.status(500).json({ success: false, message: '获取原点信息失败' });
  }
};

// ==================== 道路采集相关 ====================

/**
 * 开始道路采集
 * POST /api/gps-mapping/roads/start
 * 参数: { name, type, params: { preferredWidth, keepoutDistance, channelWidth } }
 */
export const startRoadRecording = async (req: Request, res: Response) => {
  try {
    const session = getOrCreateSession();

    if (!session.origin) {
      return res.status(400).json({
        success: false,
        message: '请先完成原点校准'
      });
    }

    const { name, type, params } = req.body;

    if (!type || !['longitudinal', 'horizontal'].includes(type)) {
      return res.status(400).json({
        success: false,
        message: '请提供有效的道路类型（longitudinal/horizontal）'
      });
    }

    // 创建新道路
    const roadId = `road_${Date.now()}`;
    const newRoad: Road = {
      id: roadId,
      name: name || `${type === 'longitudinal' ? '纵向' : '横向'}通道${session.roads.filter(r => r.type === type).length + 1}`,
      type,
      params: {
        preferredWidth: params?.preferredWidth || 2.0,
        keepoutDistance: params?.keepoutDistance || 2.5,
        channelWidth: params?.channelWidth || 6.0
      },
      points: []
    };

    session.currentRoadId = roadId;
    session.currentRoadType = type;
    session.roads.push(newRoad);
    session.recordingStartTime = Date.now();
    session.lastUpdateTime = Date.now();

    // 调用ROS2服务开始GPS记录
    if (rosbridgeService.isConnected()) {
      try {
        await rosbridgeService.callService(
          '/gps_mapping/start_recording',
          'std_srvs/srv/Trigger',
          {}
        );
        console.log('[GPS建图] ROS2 GPS记录已启动');
      } catch (rosError) {
        console.warn('[GPS建图] 调用ROS2开始记录服务失败:', rosError);
      }
    }

    res.json({
      success: true,
      message: '开始采集道路',
      data: {
        roadId,
        road: newRoad,
        status: session.status
      }
    });
  } catch (error) {
    console.error('开始道路采集失败:', error);
    res.status(500).json({ success: false, message: '开始道路采集失败' });
  }
};

/**
 * 记录道路点（实时GPS数据上报）
 * POST /api/gps-mapping/roads/:roadId/points
 * 参数: { latitude, longitude, altitude }
 */
export const recordRoadPoint = async (req: Request, res: Response) => {
  try {
    const { roadId } = req.params;
    const { latitude, longitude, altitude = 0 } = req.body;

    const session = getOrCreateSession();
    const road = session.roads.find(r => r.id === roadId);

    if (!road) {
      return res.status(404).json({
        success: false,
        message: '道路不存在'
      });
    }

    if (!session.origin || !coordinateService) {
      return res.status(400).json({
        success: false,
        message: '原点未校准'
      });
    }

    // 转换坐标
    const mapXy = coordinateService.gpsToMap(latitude, longitude);

    const newPoint = {
      seq: road.points.length,
      gps: { latitude, longitude, altitude },
      mapXy
    };

    road.points.push(newPoint);
    session.lastUpdateTime = Date.now();

    res.json({
      success: true,
      data: {
        point: newPoint,
        totalPoints: road.points.length
      }
    });
  } catch (error) {
    console.error('记录道路点失败:', error);
    res.status(500).json({ success: false, message: '记录道路点失败' });
  }
};

/**
 * 结束当前道路采集
 * POST /api/gps-mapping/roads/end
 */
export const endRoadRecording = async (req: Request, res: Response) => {
  try {
    const session = getOrCreateSession();

    if (!session.currentRoadId) {
      return res.status(400).json({
        success: false,
        message: '当前没有正在采集的道路'
      });
    }

    const road = session.roads.find(r => r.id === session.currentRoadId);
    
    if (road && road.points.length < 2) {
      // 点数太少，删除这条道路
      session.roads = session.roads.filter(r => r.id !== session.currentRoadId);
      session.currentRoadId = null;
      session.currentRoadType = null;
      session.status = session.origin ? 'idle' : 'origin_calibration';
      
      return res.json({
        success: false,
        message: '道路点数不足，已删除'
      });
    }

    // 计算道路长度
    let totalLength = 0;
    if (road) {
      for (let i = 1; i < road.points.length; i++) {
        const p1 = road.points[i - 1].mapXy;
        const p2 = road.points[i].mapXy;
        totalLength += Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
      }
    }

    session.currentRoadId = null;
    session.currentRoadType = null;
    session.recordingStartTime = null;
    session.status = 'idle'; // 道路采集完成，状态重置为idle
    session.lastUpdateTime = Date.now();

    // 调用ROS2服务停止GPS记录
    if (rosbridgeService.isConnected()) {
      try {
        await rosbridgeService.callService(
          '/gps_mapping/stop_recording',
          'std_srvs/srv/Trigger',
          {}
        );
        console.log('[GPS建图] ROS2 GPS记录已停止');
      } catch (rosError) {
        console.warn('[GPS建图] 调用ROS2停止记录服务失败:', rosError);
      }
    }

    res.json({
      success: true,
      message: '道路采集完成',
      data: {
        road,
        totalLength,
        totalRoads: session.roads.length
      }
    });
  } catch (error) {
    console.error('结束道路采集失败:', error);
    res.status(500).json({ success: false, message: '结束道路采集失败' });
  }
};

/**
 * 获取所有道路
 * GET /api/gps-mapping/roads
 */
export const getRoads = async (req: Request, res: Response) => {
  try {
    const session = getOrCreateSession();

    const roadsWithStats = session.roads.map(road => {
      let length = 0;
      for (let i = 1; i < road.points.length; i++) {
        const p1 = road.points[i - 1].mapXy;
        const p2 = road.points[i].mapXy;
        length += Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
      }
      return {
        ...road,
        pointCount: road.points.length,
        length
      };
    });

    res.json({
      success: true,
      data: roadsWithStats
    });
  } catch (error) {
    console.error('获取道路列表失败:', error);
    res.status(500).json({ success: false, message: '获取道路列表失败' });
  }
};

/**
 * 更新道路参数
 * PUT /api/gps-mapping/roads/:roadId
 */
export const updateRoad = async (req: Request, res: Response) => {
  try {
    const { roadId } = req.params;
    const { name, params } = req.body;

    const session = getOrCreateSession();
    const road = session.roads.find(r => r.id === roadId);

    if (!road) {
      return res.status(404).json({
        success: false,
        message: '道路不存在'
      });
    }

    if (name) road.name = name;
    if (params) {
      road.params = { ...road.params, ...params };
    }

    session.lastUpdateTime = Date.now();

    res.json({
      success: true,
      data: road
    });
  } catch (error) {
    console.error('更新道路失败:', error);
    res.status(500).json({ success: false, message: '更新道路失败' });
  }
};

/**
 * 删除道路
 * DELETE /api/gps-mapping/roads/:roadId
 */
export const deleteRoad = async (req: Request, res: Response) => {
  try {
    const { roadId } = req.params;
    const session = getOrCreateSession();

    const index = session.roads.findIndex(r => r.id === roadId);
    if (index === -1) {
      return res.status(404).json({
        success: false,
        message: '道路不存在'
      });
    }

    session.roads.splice(index, 1);
    session.lastUpdateTime = Date.now();

    res.json({
      success: true,
      message: '道路已删除'
    });
  } catch (error) {
    console.error('删除道路失败:', error);
    res.status(500).json({ success: false, message: '删除道路失败' });
  }
};

// ==================== 交叉点自动识别 ====================

/**
 * 生成交叉点
 * POST /api/gps-mapping/intersections/generate
 * 
 * V2改进：
 * 1. 使用线段相交算法识别交叉点
 * 2. 自动生成转弯路线
 */
export const generateIntersections = async (req: Request, res: Response) => {
  try {
    const session = getOrCreateSession();

    if (session.roads.length < 2) {
      return res.status(400).json({
        success: false,
        message: '至少需要2条道路才能生成交叉点'
      });
    }

    // 检查是否有纵向和横向道路
    const hasLongitudinal = session.roads.some(r => r.type === 'longitudinal');
    const hasHorizontal = session.roads.some(r => r.type === 'horizontal');

    if (!hasLongitudinal || !hasHorizontal) {
      return res.status(400).json({
        success: false,
        message: '需要同时有纵向和横向道路才能生成交叉点'
      });
    }

    // 自动检测交叉点（使用改进的算法）
    session.intersections = intersectionDetector.detectIntersections(session.roads);
    
    // 自动生成转弯路线
    if (session.intersections.length > 0) {
      session.turnPaths = turnPathGenerator.generateTurnPaths(
        session.intersections,
        session.roads
      );
      console.log(`[GPS建图] 已自动生成 ${session.turnPaths.length} 条转弯路线`);
    }
    
    session.lastUpdateTime = Date.now();

    res.json({
      success: true,
      message: `已识别 ${session.intersections.length} 个交叉点，生成 ${session.turnPaths.length} 条转弯路线`,
      data: {
        intersections: session.intersections,
        turnPaths: session.turnPaths
      }
    });
  } catch (error) {
    console.error('生成交叉点失败:', error);
    res.status(500).json({ success: false, message: '生成交叉点失败' });
  }
};

/**
 * 获取所有交叉点
 * GET /api/gps-mapping/intersections
 */
export const getIntersections = async (req: Request, res: Response) => {
  try {
    const session = getOrCreateSession();

    res.json({
      success: true,
      data: session.intersections
    });
  } catch (error) {
    console.error('获取交叉点失败:', error);
    res.status(500).json({ success: false, message: '获取交叉点失败' });
  }
};

/**
 * 获取所有转弯路线
 * GET /api/gps-mapping/turn-paths
 */
export const getTurnPaths = async (req: Request, res: Response) => {
  try {
    const session = getOrCreateSession();

    res.json({
      success: true,
      data: session.turnPaths,
      count: session.turnPaths.length
    });
  } catch (error) {
    console.error('获取转弯路线失败:', error);
    res.status(500).json({ success: false, message: '获取转弯路线失败' });
  }
};

// ==================== 梁位自动识别与标注 ====================

/**
 * 自动识别梁位
 * POST /api/gps-mapping/beam-positions/generate
 */
export const generateBeamPositions = async (req: Request, res: Response) => {
  try {
    const session = getOrCreateSession();

    if (session.intersections.length < 4) {
      return res.status(400).json({
        success: false,
        message: '至少需要4个交叉点才能识别梁位'
      });
    }

    if (!coordinateService) {
      return res.status(400).json({
        success: false,
        message: '坐标服务未初始化'
      });
    }

    // 自动生成梁位
    const beamPositionGenerator = new BeamPositionGenerator(coordinateService);
    session.beamPositions = beamPositionGenerator.generateBeamPositions(
      session.intersections,
      session.roads
    );

    session.status = 'beam_annotation';
    session.lastUpdateTime = Date.now();

    res.json({
      success: true,
      message: `已识别 ${session.beamPositions.length} 个梁位`,
      data: session.beamPositions
    });
  } catch (error) {
    console.error('生成梁位失败:', error);
    res.status(500).json({ success: false, message: '生成梁位失败' });
  }
};

/**
 * 获取所有梁位
 * GET /api/gps-mapping/beam-positions
 */
export const getBeamPositions = async (req: Request, res: Response) => {
  try {
    const session = getOrCreateSession();

    res.json({
      success: true,
      data: session.beamPositions
    });
  } catch (error) {
    console.error('获取梁位失败:', error);
    res.status(500).json({ success: false, message: '获取梁位失败' });
  }
};

/**
 * 更新梁位（修改编号等）
 * PUT /api/gps-mapping/beam-positions/:beamId
 */
export const updateBeamPosition = async (req: Request, res: Response) => {
  try {
    const { beamId } = req.params;
    const { name, row, col } = req.body;

    const session = getOrCreateSession();
    const beam = session.beamPositions.find(b => b.id === beamId);

    if (!beam) {
      return res.status(404).json({
        success: false,
        message: '梁位不存在'
      });
    }

    if (name) beam.name = name;
    if (row) beam.row = row;
    if (col) beam.col = col;

    session.lastUpdateTime = Date.now();

    res.json({
      success: true,
      data: beam
    });
  } catch (error) {
    console.error('更新梁位失败:', error);
    res.status(500).json({ success: false, message: '更新梁位失败' });
  }
};

/**
 * 删除梁位
 * DELETE /api/gps-mapping/beam-positions/:beamId
 */
export const deleteBeamPosition = async (req: Request, res: Response) => {
  try {
    const { beamId } = req.params;
    const session = getOrCreateSession();

    const index = session.beamPositions.findIndex(b => b.id === beamId);
    if (index === -1) {
      return res.status(404).json({
        success: false,
        message: '梁位不存在'
      });
    }

    session.beamPositions.splice(index, 1);
    session.lastUpdateTime = Date.now();

    res.json({
      success: true,
      message: '梁位已删除'
    });
  } catch (error) {
    console.error('删除梁位失败:', error);
    res.status(500).json({ success: false, message: '删除梁位失败' });
  }
};

// ==================== 地图文件生成 ====================

/**
 * 生成所有地图文件
 * POST /api/gps-mapping/generate-files
 */
export const generateMapFiles = async (req: Request, res: Response) => {
  try {
    const session = getOrCreateSession();

    if (!session.origin || !coordinateService || !mapFileGenerator) {
      return res.status(400).json({
        success: false,
        message: '原点未校准'
      });
    }

    if (session.roads.length === 0) {
      return res.status(400).json({
        success: false,
        message: '没有道路数据'
      });
    }

    // 生成转弯路径
    session.turnPaths = turnPathGenerator.generateTurnPaths(
      session.intersections,
      session.roads
    );

    session.status = 'generating';

    // 生成PGM地图
    const pgmResult = mapFileGenerator.generatePGMMap(
      session.roads,
      session.intersections,
      session.beamPositions,
      0.05 // 5cm分辨率
    );

    // 生成YAML配置
    const yamlConfig = mapFileGenerator.generateYAMLConfig(
      'beam_field_map.pgm',
      0.05,
      pgmResult.origin
    );

    // 生成gps_routes.json
    const gpsRoutesJSON = mapFileGenerator.generateGPSRoutesJSON(
      session.origin,
      session.roads,
      session.intersections,
      session.turnPaths
    );

    // 生成beam_positions.json
    const beamPositionsJSON = mapFileGenerator.generateBeamPositionsJSON(
      session.beamPositions
    );

    // 保存文件
    const mapsDir = path.join(process.cwd(), 'maps', 'beam_field');
    if (!fs.existsSync(mapsDir)) {
      fs.mkdirSync(mapsDir, { recursive: true });
    }

    fs.writeFileSync(path.join(mapsDir, 'beam_field_map.pgm'), pgmResult.pgm);
    fs.writeFileSync(path.join(mapsDir, 'beam_field_map.yaml'), yamlConfig);
    fs.writeFileSync(
      path.join(mapsDir, 'gps_routes.json'),
      JSON.stringify(gpsRoutesJSON, null, 2)
    );
    fs.writeFileSync(
      path.join(mapsDir, 'beam_positions.json'),
      JSON.stringify(beamPositionsJSON, null, 2)
    );

    // 保存GPS原点配置
    const gpsOriginConfig = {
      origin: {
        map_origin: { x: 0, y: 0, theta: session.origin.rotation },
        gps_origin: {
          latitude: session.origin.gps.latitude,
          longitude: session.origin.gps.longitude,
          altitude: session.origin.gps.altitude
        },
        utm_zone: session.origin.utm.zone
      }
    };
    fs.writeFileSync(
      path.join(mapsDir, 'gps_origin.yaml'),
      `# GPS原点配置\norigin:\n  map_origin:\n    x: 0.0\n    y: 0.0\n    theta: ${session.origin.rotation}\n  gps_origin:\n    latitude: ${session.origin.gps.latitude}\n    longitude: ${session.origin.gps.longitude}\n    altitude: ${session.origin.gps.altitude}\n  utm_zone: ${session.origin.utm.zone}\n`
    );

    session.status = 'completed';
    session.lastUpdateTime = Date.now();

    res.json({
      success: true,
      message: '地图文件生成完成',
      data: {
        files: [
          { name: 'beam_field_map.pgm', size: pgmResult.pgm.length },
          { name: 'beam_field_map.yaml', size: yamlConfig.length },
          { name: 'gps_routes.json', roads: session.roads.length, intersections: session.intersections.length },
          { name: 'beam_positions.json', beamPositions: session.beamPositions.length },
          { name: 'gps_origin.yaml' }
        ],
        mapInfo: {
          width: pgmResult.width,
          height: pgmResult.height,
          resolution: 0.05,
          origin: pgmResult.origin
        }
      }
    });
  } catch (error) {
    console.error('生成地图文件失败:', error);
    res.status(500).json({ success: false, message: '生成地图文件失败' });
  }
};

/**
 * 获取建图状态
 * GET /api/gps-mapping/status
 */
export const getMappingStatus = async (req: Request, res: Response) => {
  try {
    const session = getOrCreateSession();

    res.json({
      success: true,
      data: {
        sessionId: session.id,
        status: session.status,
        hasOrigin: !!session.origin,
        roadCount: session.roads.length,
        intersectionCount: session.intersections.length,
        beamPositionCount: session.beamPositions.length,
        currentRoadId: session.currentRoadId,
        lastUpdateTime: session.lastUpdateTime
      }
    });
  } catch (error) {
    console.error('获取建图状态失败:', error);
    res.status(500).json({ success: false, message: '获取建图状态失败' });
  }
};

/**
 * 重置建图会话
 * POST /api/gps-mapping/reset
 */
export const resetMapping = async (req: Request, res: Response) => {
  try {
    currentSession = null;
    coordinateService = null;
    mapFileGenerator = null;

    res.json({
      success: true,
      message: '建图会话已重置'
    });
  } catch (error) {
    console.error('重置建图失败:', error);
    res.status(500).json({ success: false, message: '重置建图失败' });
  }
};

// ==================== 数据库持久化 ====================

/**
 * 保存建图数据到数据库
 * POST /api/gps-mapping/save
 */
export const saveMappingToDatabase = async (req: Request, res: Response) => {
  try {
    const { name, description } = req.body;
    const session = getOrCreateSession();

    if (!session.origin) {
      return res.status(400).json({
        success: false,
        message: '没有可保存的建图数据'
      });
    }

    const gpsMap = await GPSMap.create({
      name: name || `GPS地图 ${new Date().toLocaleDateString()}`,
      description: description || '',
      origin: session.origin,
      supplyStation: session.supplyStation || undefined,
      roads: session.roads,
      intersections: session.intersections,
      turnPaths: session.turnPaths,
      beamPositions: session.beamPositions,
      status: session.status === 'completed' ? 'completed' : 'draft'
    });

    res.json({
      success: true,
      message: '建图数据已保存',
      data: {
        id: gpsMap.id,
        name: gpsMap.name,
        status: gpsMap.status
      }
    });
  } catch (error) {
    console.error('保存建图数据失败:', error);
    res.status(500).json({ success: false, message: '保存建图数据失败' });
  }
};

/**
 * 从数据库加载建图数据
 * GET /api/gps-mapping/load/:id
 */
export const loadMappingFromDatabase = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const gpsMap = await GPSMap.findByPk(id);

    if (!gpsMap) {
      return res.status(404).json({
        success: false,
        message: '地图不存在'
      });
    }

    // 加载到当前会话
    currentSession = {
      id: `session_loaded_${Date.now()}`,
      status: gpsMap.status as any,
      currentRoadId: null,
      currentRoadType: null,
      origin: gpsMap.origin,
      supplyStation: gpsMap.supplyStation || null,
      roads: gpsMap.roads,
      intersections: gpsMap.intersections,
      turnPaths: gpsMap.turnPaths,
      beamPositions: gpsMap.beamPositions,
      recordingStartTime: null,
      lastUpdateTime: Date.now()
    };

    // 初始化坐标服务
    if (gpsMap.origin) {
      initCoordinateService({
        latitude: gpsMap.origin.gps.latitude,
        longitude: gpsMap.origin.gps.longitude,
        rotation: gpsMap.origin.rotation
      });
    }

    res.json({
      success: true,
      message: '地图已加载',
      data: gpsMap
    });
  } catch (error) {
    console.error('加载建图数据失败:', error);
    res.status(500).json({ success: false, message: '加载建图数据失败' });
  }
};

/**
 * 获取已保存的地图列表
 * GET /api/gps-mapping/maps
 */
export const getSavedMaps = async (req: Request, res: Response) => {
  try {
    const maps = await GPSMap.findAll({
      attributes: ['id', 'name', 'description', 'status', 'createdAt', 'updatedAt'],
      order: [['updatedAt', 'DESC']]
    });

    res.json({
      success: true,
      data: maps
    });
  } catch (error) {
    console.error('获取地图列表失败:', error);
    res.status(500).json({ success: false, message: '获取地图列表失败' });
  }
};

/**
 * 删除已保存的地图
 * DELETE /api/gps-mapping/maps/:id
 */
export const deleteSavedMap = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await GPSMap.destroy({ where: { id } });

    if (result === 0) {
      return res.status(404).json({
        success: false,
        message: '地图不存在'
      });
    }

    res.json({
      success: true,
      message: '地图已删除'
    });
  } catch (error) {
    console.error('删除地图失败:', error);
    res.status(500).json({ success: false, message: '删除地图失败' });
  }
};

// ==================== 兼容旧API ====================

export const getGPSStatus = async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      quality: 0,
      satellites: 0,
      hdop: 99,
      latitude: 0,
      longitude: 0,
      altitude: 0,
      isFixed: false,
      lastUpdate: new Date()
    }
  });
};

export const getGPSStatusLocal = getGPSStatus;
export const getSavedMapsLocal = getSavedMaps;
export const saveGPSMapLocal = saveMappingToDatabase;
export const loadGPSMapLocal = loadMappingFromDatabase;
export const deleteGPSMapLocal = deleteSavedMap;
export const saveGPSMap = saveMappingToDatabase;
export const loadGPSMap = loadMappingFromDatabase;
export const deleteGPSMap = deleteSavedMap;

// 路线点管理（兼容旧API，重定向到新API）
export const addRoutePoint = async (req: Request, res: Response) => {
  const session = getOrCreateSession();
  if (session.currentRoadId) {
    req.params.roadId = session.currentRoadId;
    return recordRoadPoint(req, res);
  }
  res.status(400).json({ success: false, message: '没有正在采集的道路' });
};

export const deleteRoutePoint = async (req: Request, res: Response) => {
  res.status(501).json({ success: false, message: '请使用新的道路管理API' });
};

export const updateRoutePoint = async (req: Request, res: Response) => {
  res.status(501).json({ success: false, message: '请使用新的道路管理API' });
};

// 转弯点管理（已废弃，由系统自动生成）
export const addTurnPoint = async (req: Request, res: Response) => {
  res.status(501).json({ success: false, message: '转弯点由系统自动生成，无需手动添加' });
};

export const deleteTurnPoint = async (req: Request, res: Response) => {
  res.status(501).json({ success: false, message: '转弯点由系统自动生成，无需手动删除' });
};

export const updateTurnPoint = async (req: Request, res: Response) => {
  res.status(501).json({ success: false, message: '转弯点由系统自动生成，无需手动更新' });
};

// 梁位置管理（兼容旧API）
export const addBeamPosition = async (req: Request, res: Response) => {
  res.status(501).json({ success: false, message: '梁位由系统自动识别，请使用 generateBeamPositions API' });
};

// 坐标转换
export const convertGPSToMap = async (req: Request, res: Response) => {
  try {
    const { latitude, longitude } = req.body;
    const session = getOrCreateSession();

    if (!coordinateService) {
      return res.status(400).json({
        success: false,
        message: '原点未校准'
      });
    }

    const mapPoint = coordinateService.gpsToMap(latitude, longitude);

    res.json({
      success: true,
      data: mapPoint
    });
  } catch (error) {
    console.error('坐标转换失败:', error);
    res.status(500).json({ success: false, message: '坐标转换失败' });
  }
};

export const convertMapToGPS = async (req: Request, res: Response) => {
  try {
    const { x, y } = req.body;

    if (!coordinateService) {
      return res.status(400).json({
        success: false,
        message: '原点未校准'
      });
    }

    const gpsPoint = coordinateService.mapToGPS(x, y);

    res.json({
      success: true,
      data: gpsPoint
    });
  } catch (error) {
    console.error('坐标转换失败:', error);
    res.status(500).json({ success: false, message: '坐标转换失败' });
  }
};