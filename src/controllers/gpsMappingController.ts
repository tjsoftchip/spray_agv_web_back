/**
 * GPS建图控制器
 * 使用原生TypeScript实现GPS道路数据处理与圆弧生成
 * 完全按照Python gps_arc_generator.py逻辑重写
 */

import { Request, Response } from 'express';
import GPSMap, { Road, Intersection, TurnArc, TurnArcPoint, BeamPosition, GPSPoint, MapPoint } from '../models/GPSMap';
import {
  CoordinateService,
  IntersectionProcessor,
  MapFileGenerator,
  GPSRoadProcessor,
  TurnArcGenerator,
  BeamPositionProcessor,
  FittedLine,
  GPSOrigin
} from '../services/gpsMappingService';
import rosbridgeService from '../services/rosbridgeService';
import fs from 'fs';
import path from 'path';

// ============================================================
// 建图会话状态
// ============================================================

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
  turnArcs: TurnArc[];
  beamPositions: BeamPosition[];
  angles: { longitudinal: number; horizontal: number } | null;
  recordingStartTime: number | null;
  lastUpdateTime: number;
}

let currentSession: MappingSession | null = null;
let coordinateService: CoordinateService | null = null;
let mapFileGenerator: MapFileGenerator | null = null;

const intersectionProcessor = new IntersectionProcessor();
const beamPositionProcessor = new BeamPositionProcessor();
let roadProcessor: GPSRoadProcessor | null = null;
let arcGenerator: TurnArcGenerator | null = null;

// ============================================================
// 会话管理
// ============================================================

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
      turnArcs: [],
      beamPositions: [],
      angles: null,
      recordingStartTime: null,
      lastUpdateTime: Date.now()
    };
  }
  return currentSession;
}

function initServices(origin: { latitude: number; longitude: number; rotation: number }, utm?: { zone: number; easting: number; northing: number }) {
  const gpsOrigin: GPSOrigin = {
    gps: { lat: origin.latitude, lon: origin.longitude },
    utm: utm || { zone: 50, easting: 0, northing: 0 },
    rotation: origin.rotation
  };
  coordinateService = new CoordinateService(gpsOrigin);
  mapFileGenerator = new MapFileGenerator(coordinateService);
  roadProcessor = new GPSRoadProcessor(coordinateService);
  arcGenerator = new TurnArcGenerator(coordinateService);
}

// ============================================================
// 原点校准
// ============================================================

export const startOriginCalibration = async (req: Request, res: Response) => {
  try {
    const session = getOrCreateSession();
    session.status = 'origin_calibration';
    session.lastUpdateTime = Date.now();
    res.json({ success: true, message: '原点校准已开始', data: { sessionId: session.id, status: session.status } });
  } catch (error) {
    console.error('开始原点校准失败:', error);
    res.status(500).json({ success: false, message: '开始原点校准失败' });
  }
};

export const completeOriginCalibration = async (req: Request, res: Response) => {
  try {
    const { latitude, longitude, altitude = 0, rotation = 0 } = req.body;
    if (!latitude || !longitude) {
      return res.status(400).json({ success: false, message: '请提供有效的GPS坐标' });
    }

    const session = getOrCreateSession();
    initServices({ latitude, longitude, rotation });
    const utm = coordinateService!.toUTM(latitude, longitude);
    coordinateService!.setUTMOrigin(utm);

    session.origin = {
      gps: { latitude, longitude, altitude },
      utm: { zone: utm.zone, easting: utm.easting, northing: utm.northing },
      rotation
    };
    session.supplyStation = { gps: { latitude, longitude, altitude }, mapXy: { x: 0, y: 0 } };
    session.status = 'road_recording';
    session.lastUpdateTime = Date.now();

    if (rosbridgeService.isConnected()) {
      try {
        await rosbridgeService.callService('/gps_to_map/set_current_as_origin', 'std_srvs/srv/Trigger', {});
      } catch (e) { console.warn('[GPS建图] ROS2设置原点失败:', e); }
    }

    res.json({ success: true, message: '原点校准完成', data: { origin: session.origin, supplyStation: session.supplyStation, status: session.status } });
  } catch (error) {
    console.error('完成原点校准失败:', error);
    res.status(500).json({ success: false, message: '完成原点校准失败' });
  }
};

export const getOrigin = async (req: Request, res: Response) => {
  try {
    res.json({ success: true, data: getOrCreateSession().origin });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取原点信息失败' });
  }
};

// ============================================================
// 道路采集
// ============================================================

export const startRoadRecording = async (req: Request, res: Response) => {
  try {
    const session = getOrCreateSession();
    if (!session.origin) {
      return res.status(400).json({ success: false, message: '请先完成原点校准' });
    }

    const { name, type, params } = req.body;
    if (!type || !['longitudinal', 'horizontal'].includes(type)) {
      return res.status(400).json({ success: false, message: '请提供有效的道路类型' });
    }

    const roadId = `road_${Date.now()}`;
    const newRoad: Road = {
      id: roadId,
      name: name || `${type === 'longitudinal' ? '纵向' : '横向'}通道${session.roads.filter(r => r.type === type).length + 1}`,
      type,
      params: {
        preferredWidth: params?.preferredWidth || 1.4,
        highCostWidth: params?.highCostWidth || 0.3
      },
      points: []
    };

    session.currentRoadId = roadId;
    session.currentRoadType = type;
    session.roads.push(newRoad);
    session.recordingStartTime = Date.now();
    session.lastUpdateTime = Date.now();

    if (rosbridgeService.isConnected()) {
      try {
        await rosbridgeService.callService('/gps_mapping/start_recording', 'std_srvs/srv/Trigger', {});
      } catch (e) { console.warn('[GPS建图] ROS2开始记录失败:', e); }
    }

    res.json({ success: true, message: '开始采集道路', data: { roadId, road: newRoad, status: session.status } });
  } catch (error) {
    console.error('开始道路采集失败:', error);
    res.status(500).json({ success: false, message: '开始道路采集失败' });
  }
};

export const recordRoadPoint = async (req: Request, res: Response) => {
  try {
    const { roadId } = req.params;
    const latitude = parseFloat(req.body.latitude);
    const longitude = parseFloat(req.body.longitude);
    const altitude = parseFloat(req.body.altitude) || 0;

    if (isNaN(latitude) || isNaN(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return res.json({ success: true, data: { skipped: true, reason: '无效的GPS坐标' } });
    }

    const session = getOrCreateSession();
    const road = session.roads.find(r => r.id === roadId);
    if (!road) return res.status(404).json({ success: false, message: '道路不存在' });
    if (!session.origin || !coordinateService) return res.status(400).json({ success: false, message: '原点未校准' });

    const mapXy = coordinateService.gpsToMap(latitude, longitude);
    const newPoint = { seq: road.points.length, gps: { latitude, longitude, altitude }, mapXy };
    road.points.push(newPoint);
    session.lastUpdateTime = Date.now();

    res.json({ success: true, data: { point: newPoint, totalPoints: road.points.length } });
  } catch (error) {
    console.error('记录道路点失败:', error);
    res.status(500).json({ success: false, message: '记录道路点失败' });
  }
};

export const endRoadRecording = async (req: Request, res: Response) => {
  try {
    const session = getOrCreateSession();
    if (!session.currentRoadId) {
      return res.json({ success: true, message: '没有正在采集的道路' });
    }

    const road = session.roads.find(r => r.id === session.currentRoadId);
    if (road && road.points.length < 2) {
      session.roads = session.roads.filter(r => r.id !== session.currentRoadId);
      session.currentRoadId = null;
      session.currentRoadType = null;
      return res.json({ success: false, message: '道路点数不足，已删除' });
    }

    let totalLength = 0;
    if (road) {
      for (let i = 1; i < road.points.length; i++) {
        const p1 = road.points[i - 1].mapXy, p2 = road.points[i].mapXy;
        totalLength += Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
      }
    }

    session.currentRoadId = null;
    session.currentRoadType = null;
    session.recordingStartTime = null;
    session.status = 'idle';
    session.lastUpdateTime = Date.now();

    if (rosbridgeService.isConnected()) {
      try {
        await rosbridgeService.callService('/gps_mapping/stop_recording', 'std_srvs/srv/Trigger', {});
      } catch (e) { console.warn('[GPS建图] ROS2停止记录失败:', e); }
    }

    res.json({ success: true, message: '道路采集完成', data: { road, totalLength, totalRoads: session.roads.length } });
  } catch (error) {
    console.error('结束道路采集失败:', error);
    res.status(500).json({ success: false, message: '结束道路采集失败' });
  }
};

export const getRoads = async (req: Request, res: Response) => {
  try {
    const session = getOrCreateSession();
    const roadsWithStats = session.roads.map(road => {
      let length = 0;
      for (let i = 1; i < road.points.length; i++) {
        const p1 = road.points[i - 1].mapXy, p2 = road.points[i].mapXy;
        length += Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
      }
      return { ...road, pointCount: road.points.length, length };
    });
    res.json({ success: true, data: roadsWithStats });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取道路列表失败' });
  }
};

export const updateRoad = async (req: Request, res: Response) => {
  try {
    const { roadId } = req.params;
    const { name, params } = req.body;
    const session = getOrCreateSession();
    const road = session.roads.find(r => r.id === roadId);
    if (!road) return res.status(404).json({ success: false, message: '道路不存在' });
    if (name) road.name = name;
    if (params) road.params = { ...road.params, ...params };
    session.lastUpdateTime = Date.now();
    res.json({ success: true, data: road });
  } catch (error) {
    res.status(500).json({ success: false, message: '更新道路失败' });
  }
};

export const deleteRoad = async (req: Request, res: Response) => {
  try {
    const { roadId } = req.params;
    const session = getOrCreateSession();
    const index = session.roads.findIndex(r => r.id === roadId);
    if (index === -1) return res.status(404).json({ success: false, message: '道路不存在' });
    session.roads.splice(index, 1);
    session.lastUpdateTime = Date.now();
    res.json({ success: true, message: '道路已删除' });
  } catch (error) {
    res.status(500).json({ success: false, message: '删除道路失败' });
  }
};

// ============================================================
// 交叉点与圆弧生成（核心算法）
// ============================================================

/**
 * 生成交叉点和圆弧
 * 完全按照Python逻辑：拟合道路 → 构建交点 → 邻居判断 → 象限判断 → 圆弧生成
 */
export const generateIntersections = async (req: Request, res: Response) => {
  try {
    const session = getOrCreateSession();

    if (session.roads.length < 2) {
      return res.status(400).json({ success: false, message: '至少需要2条道路（1条纵向+1条横向）' });
    }

    const longitudinalRoads = session.roads.filter(r => r.type === 'longitudinal');
    const horizontalRoads = session.roads.filter(r => r.type === 'horizontal');

    if (longitudinalRoads.length < 1 || horizontalRoads.length < 1) {
      return res.status(400).json({ success: false, message: '需要至少1条纵向路和1条横向路' });
    }

    if (!roadProcessor || !arcGenerator || !coordinateService) {
      return res.status(400).json({ success: false, message: '服务未初始化，请先完成原点校准' });
    }

    // 验证道路数据质量
    const roadStats = session.roads.map(r => {
      const pts = r.points;
      let totalLen = 0;
      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i].mapXy.x - pts[i-1].mapXy.x;
        const dy = pts[i].mapXy.y - pts[i-1].mapXy.y;
        totalLen += Math.sqrt(dx*dx + dy*dy);
      }
      // 计算首尾位移
      const startEnd = Math.sqrt(
        (pts[pts.length-1].mapXy.x - pts[0].mapXy.x)**2 +
        (pts[pts.length-1].mapXy.y - pts[0].mapXy.y)**2
      );
      return { name: r.name, type: r.type, pointCount: pts.length, totalLength: totalLen, displacement: startEnd };
    });

    console.log('[GPS建图] 道路数据质量:');
    for (const s of roadStats) {
      console.log(`  ${s.name} (${s.type}): ${s.pointCount}点, 累计长度=${s.totalLength.toFixed(2)}m, 首尾位移=${s.displacement.toFixed(2)}m`);
    }

    // 检查是否有足够数据
    const shortRoads = roadStats.filter(s => s.displacement < 0.5);
    if (shortRoads.length > 0) {
      console.warn(`[GPS建图] 警告: ${shortRoads.map(r => r.name).join(', ')} 首尾位移<0.5m，可能是静止状态下采集的，已自动扩展`);
    }

    console.log('[GPS建图] 开始处理道路数据...');

    // 步骤1-5：道路处理（异常点剔除、主方向识别、正交化、拟合、重采样）
    const { processedRoads, fittedLines, directions } = roadProcessor.processRoads(session.roads, 0.2);
    session.roads = processedRoads;
    session.angles = { longitudinal: directions.longitudinalAngle, horizontal: directions.horizontalAngle };

    console.log(`[GPS建图] 道路方向: 纵向=${(directions.longitudinalAngle * 180 / Math.PI).toFixed(1)}°, 横向=${(directions.horizontalAngle * 180 / Math.PI).toFixed(1)}°`);

    // 打印拟合后的道路信息
    for (const road of processedRoads) {
      const fl = fittedLines.get(road.id);
      if (fl) {
        console.log(`  道路 ${road.name}: 拟合长度=${fl.length().toFixed(2)}m, 点数=${road.points.length}`);
      }
    }

    // 步骤6：构建路口（使用拟合直线的交点）
    const rawIntersections: Intersection[] = [];
    for (const vRoad of longitudinalRoads) {
      for (const hRoad of horizontalRoads) {
        const fittedV = fittedLines.get(vRoad.id);
        const fittedH = fittedLines.get(hRoad.id);
        if (!fittedV || !fittedH) continue;

        const center = roadProcessor.calculateIntersection(fittedV, fittedH);
        if (center) {
          const gps = coordinateService.mapToGps(center.x, center.y);
          rawIntersections.push({
            id: `inter_${vRoad.name}_${hRoad.name}`,
            type: 'cross',
            center: {
              gps: { latitude: gps.lat, longitude: gps.lon, altitude: 0 },
              mapXy: center
            },
            road_v_id: vRoad.id,
            road_h_id: hRoad.id,
            connectedRoads: [vRoad.id, hRoad.id],
            neighbors: {},
            valid_quadrants: []
          });
        }
      }
    }

    console.log(`[GPS建图] 构建 ${rawIntersections.length} 个路口`);

    if (rawIntersections.length === 0) {
      return res.status(400).json({
        success: false,
        message: '无法识别交叉点，请确保纵向路和横向路有交叉（检查道路方向和位置）'
      });
    }

    // 步骤7：处理路口（邻居判断、象限判断）
    session.intersections = intersectionProcessor.processIntersections(
      rawIntersections,
      directions.longitudinalAngle,
      directions.horizontalAngle
    );

    // 步骤8：生成圆弧
    session.turnArcs = arcGenerator.generateAllTurnArcs(
      session.intersections,
      directions.longitudinalAngle,
      directions.horizontalAngle,
      4.5
    );

    // 步骤9：生成梁位
    session.beamPositions = beamPositionProcessor.generateBeamPositions(session.intersections, processedRoads);

    session.lastUpdateTime = Date.now();

    // 统计
    const quadrantCount = { 0: 0, 1: 0, 2: 0, 3: 0 };
    for (const arc of session.turnArcs) quadrantCount[arc.quadrant as 0 | 1 | 2 | 3]++;

    console.log(`[GPS建图] 完成: ${session.intersections.length}个路口, ${session.turnArcs.length}条圆弧, ${session.beamPositions.length}个梁位`);

    res.json({
      success: true,
      message: `已生成 ${session.intersections.length} 个交叉点, ${session.turnArcs.length} 条圆弧`,
      data: {
        intersections: session.intersections,
        turnArcs: session.turnArcs,
        beamPositions: session.beamPositions,
        angles: {
          longitudinal: (directions.longitudinalAngle * 180 / Math.PI).toFixed(1) + '°',
          horizontal: (directions.horizontalAngle * 180 / Math.PI).toFixed(1) + '°'
        },
        quadrantCount
      }
    });
  } catch (error) {
    console.error('生成交叉点失败:', error);
    res.status(500).json({ success: false, message: `生成交叉点失败: ${(error as Error).message}` });
  }
};

export const getIntersections = async (req: Request, res: Response) => {
  try {
    res.json({ success: true, data: getOrCreateSession().intersections });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取交叉点失败' });
  }
};

export const getTurnArcs = async (req: Request, res: Response) => {
  try {
    res.json({ success: true, data: getOrCreateSession().turnArcs });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取转弯圆弧失败' });
  }
};

// ============================================================
// 梁位管理
// ============================================================

export const generateBeamPositions = async (req: Request, res: Response) => {
  try {
    const session = getOrCreateSession();
    if (session.intersections.length < 4) {
      return res.status(400).json({ success: false, message: '至少需要4个交叉点' });
    }
    session.beamPositions = beamPositionProcessor.generateBeamPositions(session.intersections, session.roads);
    session.status = 'beam_annotation';
    session.lastUpdateTime = Date.now();
    res.json({ success: true, message: `已识别 ${session.beamPositions.length} 个梁位`, data: session.beamPositions });
  } catch (error) {
    res.status(500).json({ success: false, message: '生成梁位失败' });
  }
};

export const getBeamPositions = async (req: Request, res: Response) => {
  try {
    res.json({ success: true, data: getOrCreateSession().beamPositions });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取梁位失败' });
  }
};

export const updateBeamPosition = async (req: Request, res: Response) => {
  try {
    const { beamId } = req.params;
    const { name, row, col } = req.body;
    const session = getOrCreateSession();
    const beam = session.beamPositions.find(b => b.id === beamId);
    if (!beam) return res.status(404).json({ success: false, message: '梁位不存在' });
    if (name) beam.name = name;
    if (row) beam.row = row;
    if (col) beam.col = col;
    session.lastUpdateTime = Date.now();
    res.json({ success: true, data: beam });
  } catch (error) {
    res.status(500).json({ success: false, message: '更新梁位失败' });
  }
};

export const deleteBeamPosition = async (req: Request, res: Response) => {
  try {
    const { beamId } = req.params;
    const session = getOrCreateSession();
    const index = session.beamPositions.findIndex(b => b.id === beamId);
    if (index === -1) return res.status(404).json({ success: false, message: '梁位不存在' });
    session.beamPositions.splice(index, 1);
    session.lastUpdateTime = Date.now();
    res.json({ success: true, message: '梁位已删除' });
  } catch (error) {
    res.status(500).json({ success: false, message: '删除梁位失败' });
  }
};

// ============================================================
// 地图文件生成
// ============================================================

// 后台生成状态
let generationStatus: {
  isGenerating: boolean;
  progress: string;
  error: string | null;
  completedAt: number | null;
  files: any[] | null;
} = {
  isGenerating: false,
  progress: '',
  error: null,
  completedAt: null,
  files: null
};

export const getGenerationStatus = async (req: Request, res: Response) => {
  res.json({
    isGenerating: generationStatus.isGenerating,
    progress: generationStatus.progress,
    error: generationStatus.error,
    completedAt: generationStatus.completedAt,
    files: generationStatus.files
  });
};

export const generateMapFiles = async (req: Request, res: Response) => {
  const session = getOrCreateSession();
  try {
    if (!session.origin || !coordinateService || !mapFileGenerator) {
      return res.status(400).json({ success: false, message: '原点未校准' });
    }
    if (session.roads.length === 0) {
      return res.status(400).json({ success: false, message: '没有道路数据' });
    }

    // 检查是否正在生成
    if (generationStatus.isGenerating) {
      return res.status(409).json({ success: false, message: '地图正在生成中，请稍候' });
    }

    // 立即返回响应，后台处理
    res.json({ success: true, message: '开始生成地图文件...', background: true });

    // 后台生成
    setImmediate(() => generateMapFilesAsync(session));
  } catch (error) {
    console.error('[GPS建图] 启动生成失败:', error);
    res.status(500).json({ success: false, message: `启动生成失败: ${(error as Error).message}` });
  }
};

async function generateMapFilesAsync(session: MappingSession) {
  generationStatus = { isGenerating: true, progress: '初始化...', error: null, completedAt: null, files: null };

  try {
    // 检查必要条件
    if (!session.origin || !coordinateService || !mapFileGenerator) {
      throw new Error('原点未校准或服务未初始化');
    }

    session.status = 'generating';
    console.log('[GPS建图] 开始生成地图文件...');

    // 如果还没有生成过交叉点和圆弧，先生成
    if (session.intersections.length === 0) {
      generationStatus.progress = '处理道路数据...';
      console.log('[GPS建图] 自动执行道路处理和圆弧生成...');
      if (!roadProcessor || !arcGenerator) {
        console.log('[GPS建图] 初始化服务...');
        initServices({
          latitude: session.origin!.gps.latitude,
          longitude: session.origin!.gps.longitude,
          rotation: session.origin!.rotation
        }, session.origin!.utm);
      }

      console.log('[GPS建图] 处理道路数据...');
      const { processedRoads, fittedLines, directions } = roadProcessor!.processRoads(session.roads, 0.5);
      session.roads = processedRoads;
      session.angles = { longitudinal: directions.longitudinalAngle, horizontal: directions.horizontalAngle };

      generationStatus.progress = '构建交叉点...';
      console.log('[GPS建图] 构建交叉点...');
      const rawIntersections: Intersection[] = [];
      const longitudinalRoads = processedRoads.filter(r => r.type === 'longitudinal');
      const horizontalRoads = processedRoads.filter(r => r.type === 'horizontal');

      for (const vRoad of longitudinalRoads) {
        for (const hRoad of horizontalRoads) {
          const fittedV = fittedLines.get(vRoad.id);
          const fittedH = fittedLines.get(hRoad.id);
          if (!fittedV || !fittedH) continue;
          const center = roadProcessor!.calculateIntersection(fittedV, fittedH);
          if (center) {
            const gps = coordinateService!.mapToGps(center.x, center.y);
            rawIntersections.push({
              id: `inter_${vRoad.name}_${hRoad.name}`,
              type: 'cross',
              center: { gps: { latitude: gps.lat, longitude: gps.lon, altitude: 0 }, mapXy: center },
              road_v_id: vRoad.id, road_h_id: hRoad.id,
              connectedRoads: [vRoad.id, hRoad.id],
              neighbors: {}, valid_quadrants: []
            });
          }
        }
      }

      generationStatus.progress = '处理交叉点和圆弧...';
      console.log('[GPS建图] 处理交叉点和圆弧...');
      session.intersections = intersectionProcessor.processIntersections(rawIntersections, directions.longitudinalAngle, directions.horizontalAngle);
      console.log(`[GPS建图] 交叉点数: ${session.intersections.length}, 有效象限: ${session.intersections.map(i => i.valid_quadrants).join(', ')}`);

      session.turnArcs = arcGenerator!.generateAllTurnArcs(session.intersections, directions.longitudinalAngle, directions.horizontalAngle);
      console.log(`[GPS建图] 生成的圆弧数: ${session.turnArcs.length}`);
      session.beamPositions = beamPositionProcessor.generateBeamPositions(session.intersections, processedRoads);
    }

    generationStatus.progress = '生成JSON文件...';
    console.log('[GPS建图] 生成JSON文件...');
    const origin = session.origin!;
    const gpsRoutesJSON = mapFileGenerator!.generateGPSRoutesJSON(origin, session.roads, session.intersections, session.turnArcs);
    const beamPositionsJSON = mapFileGenerator!.generateBeamPositionsJSON(session.beamPositions);

    // 保存到导航地图目录
    const mapsDir = '/home/jetson/yahboomcar_ros2_ws/yahboomcar_ws/src/yahboomcar_nav/maps';
    if (!fs.existsSync(mapsDir)) fs.mkdirSync(mapsDir, { recursive: true });

    fs.writeFileSync(path.join(mapsDir, 'gps_routes.json'), JSON.stringify(gpsRoutesJSON, null, 2));
    fs.writeFileSync(path.join(mapsDir, 'beam_positions.json'), JSON.stringify(beamPositionsJSON, null, 2));

    // 生成ROS2参数格式的GPS原点配置
    const gpsOriginYaml = `# GPS原点配置 - ROS2参数格式
# 用于auto_initial_pose节点和route_executor节点
# 生成时间: ${new Date().toISOString()}

/**:
  ros__parameters:
    # GPS原点坐标 (WGS84)
    origin_latitude: ${origin.gps.latitude}
    origin_longitude: ${origin.gps.longitude}
    origin_altitude: ${origin.gps.altitude || 0}

    # 地图旋转角度（弧度）- 道路方向相对于UTM北的角度
    map_rotation: ${origin.rotation || 0}

    # UTM分区
    utm_zone: ${origin.utm.zone}

    # UTM坐标（预计算）
    origin_easting: ${origin.utm.easting}
    origin_northing: ${origin.utm.northing}
`;
    fs.writeFileSync(path.join(mapsDir, 'gps_origin.yaml'), gpsOriginYaml);

    // 生成道路网络YAML文件
    const routesYaml = generateRoutesYaml(session.roads, session.turnArcs, origin);
    fs.writeFileSync(path.join(mapsDir, 'gps_routes.yaml'), routesYaml);

    // 保存到web预览目录
    const webMapsDir = path.join(process.cwd(), 'maps', 'beam_field');
    if (!fs.existsSync(webMapsDir)) fs.mkdirSync(webMapsDir, { recursive: true });
    fs.writeFileSync(path.join(webMapsDir, 'gps_routes.json'), JSON.stringify(gpsRoutesJSON, null, 2));
    fs.writeFileSync(path.join(webMapsDir, 'beam_positions.json'), JSON.stringify(beamPositionsJSON, null, 2));

    // 提取道路参数
    const defaultPreferredWidth = 1.4;
    const defaultHighCostWidth = 0.3;
    let preferredWidth = defaultPreferredWidth;
    let highCostWidth = defaultHighCostWidth;

    if (session.roads.length > 0 && session.roads[0].params) {
      if (session.roads[0].params.preferredWidth !== undefined) {
        preferredWidth = session.roads[0].params.preferredWidth;
      }
      if (session.roads[0].params.highCostWidth !== undefined) {
        highCostWidth = session.roads[0].params.highCostWidth;
      }
    }

    console.log(`[GPS建图] 地图参数: 首选网络宽度=${preferredWidth}m, 高代价区宽度=${highCostWidth}m`);

    // 生成PGM地图
    generationStatus.progress = '生成PGM地图...';
    try {
      console.log('[GPS建图] 生成PGM地图...');
      const { pgm, width, height, origin: mapOrigin } = mapFileGenerator!.generatePGMMap(
        session.roads, session.turnArcs, 0.1, preferredWidth, highCostWidth
      );
      fs.writeFileSync(path.join(mapsDir, 'beam_field_map.pgm'), pgm);
      fs.writeFileSync(path.join(mapsDir, 'beam_field_map.yaml'), mapFileGenerator!.generateYAMLConfig('beam_field_map.pgm', 0.1, mapOrigin));
      console.log(`[GPS建图] PGM地图生成成功: ${width}x${height}`);
    } catch (pgmError: any) {
      console.error('[GPS建图] PGM地图生成失败:', pgmError?.message || pgmError);
      console.error(pgmError?.stack);
      generationStatus.error = `PGM生成失败: ${pgmError?.message}`;
    }

    session.status = 'completed';
    session.lastUpdateTime = Date.now();

    const fileList = [
      { name: 'gps_routes.json', exists: fs.existsSync(path.join(mapsDir, 'gps_routes.json')), size: fs.existsSync(path.join(mapsDir, 'gps_routes.json')) ? fs.statSync(path.join(mapsDir, 'gps_routes.json')).size : 0 },
      { name: 'gps_routes.yaml', exists: fs.existsSync(path.join(mapsDir, 'gps_routes.yaml')), size: fs.existsSync(path.join(mapsDir, 'gps_routes.yaml')) ? fs.statSync(path.join(mapsDir, 'gps_routes.yaml')).size : 0 },
      { name: 'beam_positions.json', exists: fs.existsSync(path.join(mapsDir, 'beam_positions.json')), size: fs.existsSync(path.join(mapsDir, 'beam_positions.json')) ? fs.statSync(path.join(mapsDir, 'beam_positions.json')).size : 0 },
      { name: 'gps_origin.yaml', exists: fs.existsSync(path.join(mapsDir, 'gps_origin.yaml')), size: fs.existsSync(path.join(mapsDir, 'gps_origin.yaml')) ? fs.statSync(path.join(mapsDir, 'gps_origin.yaml')).size : 0 },
      { name: 'beam_field_map.pgm', exists: fs.existsSync(path.join(mapsDir, 'beam_field_map.pgm')), size: fs.existsSync(path.join(mapsDir, 'beam_field_map.pgm')) ? fs.statSync(path.join(mapsDir, 'beam_field_map.pgm')).size : 0 },
      { name: 'beam_field_map.yaml', exists: fs.existsSync(path.join(mapsDir, 'beam_field_map.yaml')), size: fs.existsSync(path.join(mapsDir, 'beam_field_map.yaml')) ? fs.statSync(path.join(mapsDir, 'beam_field_map.yaml')).size : 0 }
    ];

    console.log('[GPS建图] 地图文件生成完成！');

    generationStatus = {
      isGenerating: false,
      progress: '完成',
      error: null,
      completedAt: Date.now(),
      files: fileList
    };
  } catch (error) {
    console.error('[GPS建图] 生成地图文件失败:', error);
    session.status = 'idle';
    generationStatus = {
      isGenerating: false,
      progress: '失败',
      error: (error as Error).message,
      completedAt: Date.now(),
      files: null
    };
  }
}

// ============================================================
// 生成route_executor使用的YAML路线文件
// ============================================================

function generateRoutesYaml(roads: Road[], turnArcs: TurnArc[], origin: any): string {
  const lines: string[] = [];
  lines.push('# GPS道路网络路线文件');
  lines.push('# 用于route_executor逐点导航');
  lines.push(`# 生成时间: ${new Date().toISOString()}`);
  lines.push(`# GPS原点: (${origin.gps.latitude}, ${origin.gps.longitude})`);
  lines.push(`# 地图旋转: ${origin.rotation || 0} rad`);
  lines.push('');

  // 生成纵向道路路线
  const longitudinalRoads = roads.filter(r => r.type === 'longitudinal');
  for (const road of longitudinalRoads) {
    const routeName = `road_${road.name}_forward`;
    lines.push(`# 纵向道路 ${road.name} (正向)`);
    lines.push(`${routeName}:`);
    for (const point of road.points) {
      lines.push(`  - latitude: ${point.gps.latitude}`);
      lines.push(`    longitude: ${point.gps.longitude}`);
      lines.push(`    yaw: 0.0`);
      lines.push(`    # map_xy: (${point.mapXy.x.toFixed(2)}, ${point.mapXy.y.toFixed(2)})`);
    }
    lines.push('');

    // 反向路线
    const reverseName = `road_${road.name}_backward`;
    lines.push(`# 纵向道路 ${road.name} (反向)`);
    lines.push(`${reverseName}:`);
    for (let i = road.points.length - 1; i >= 0; i--) {
      const point = road.points[i];
      lines.push(`  - latitude: ${point.gps.latitude}`);
      lines.push(`    longitude: ${point.gps.longitude}`);
      lines.push(`    yaw: 0.0`);
    }
    lines.push('');
  }

  // 生成横向道路路线
  const horizontalRoads = roads.filter(r => r.type === 'horizontal');
  for (const road of horizontalRoads) {
    const routeName = `road_${road.name}_forward`;
    lines.push(`# 横向道路 ${road.name} (正向)`);
    lines.push(`${routeName}:`);
    for (const point of road.points) {
      lines.push(`  - latitude: ${point.gps.latitude}`);
      lines.push(`    longitude: ${point.gps.longitude}`);
      lines.push(`    yaw: 0.0`);
      lines.push(`    # map_xy: (${point.mapXy.x.toFixed(2)}, ${point.mapXy.y.toFixed(2)})`);
    }
    lines.push('');

    // 反向路线
    const reverseName = `road_${road.name}_backward`;
    lines.push(`# 横向道路 ${road.name} (反向)`);
    lines.push(`${reverseName}:`);
    for (let i = road.points.length - 1; i >= 0; i--) {
      const point = road.points[i];
      lines.push(`  - latitude: ${point.gps.latitude}`);
      lines.push(`    longitude: ${point.gps.longitude}`);
      lines.push(`    yaw: 0.0`);
    }
    lines.push('');
  }

  // 生成圆弧路线
  for (const arc of turnArcs) {
    const routeName = arc.id;
    lines.push(`# 圆弧 ${arc.id} (象限${arc.quadrant}, 半径${arc.radius}m)`);
    lines.push(`${routeName}:`);
    for (const point of arc.points) {
      lines.push(`  - latitude: ${point.gps.latitude}`);
      lines.push(`    longitude: ${point.gps.longitude}`);
      lines.push(`    yaw: 0.0`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================
// 建图状态
// ============================================================

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
        turnArcCount: session.turnArcs.length,
        beamPositionCount: session.beamPositions.length,
        currentRoadId: session.currentRoadId,
        lastUpdateTime: session.lastUpdateTime,
        turnArcs: session.turnArcs
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取建图状态失败' });
  }
};

export const resetMapping = async (req: Request, res: Response) => {
  try {
    currentSession = null;
    coordinateService = null;
    mapFileGenerator = null;
    roadProcessor = null;
    arcGenerator = null;
    res.json({ success: true, message: '建图会话已重置' });
  } catch (error) {
    res.status(500).json({ success: false, message: '重置建图失败' });
  }
};

// ============================================================
// 数据库持久化
// ============================================================

export const saveMappingToDatabase = async (req: Request, res: Response) => {
  try {
    const { name, description } = req.body;
    const session = getOrCreateSession();

    // 如果session没有数据，尝试从文件恢复
    if (!session.origin || session.roads.length === 0) {
      const mapsDir = '/home/jetson/yahboomcar_ros2_ws/yahboomcar_ws/src/yahboomcar_nav/maps';
      const gpsRoutesPath = path.join(mapsDir, 'gps_routes.json');

      if (fs.existsSync(gpsRoutesPath)) {
        const fileData = JSON.parse(fs.readFileSync(gpsRoutesPath, 'utf-8'));
        session.origin = fileData.origin;
        session.roads = fileData.roads || [];
        session.intersections = fileData.intersections || [];
        session.turnArcs = fileData.turn_arcs || [];
        session.status = 'completed';

        if (session.origin) {
        initServices({
          latitude: session.origin.gps.latitude,
          longitude: session.origin.gps.longitude,
          rotation: session.origin.rotation || 0
        }, session.origin.utm);
        }

        const beamPositionsPath = path.join(mapsDir, 'beam_positions.json');
        if (fs.existsSync(beamPositionsPath)) {
          const beamData = JSON.parse(fs.readFileSync(beamPositionsPath, 'utf-8'));
          session.beamPositions = beamData.positions || [];
        }
      }
    }

    if (!session.origin) {
      return res.status(400).json({ success: false, message: '没有可保存的建图数据' });
    }

    const gpsMap = await GPSMap.create({
      name: name || `GPS地图 ${new Date().toLocaleDateString()}`,
      description: description || '',
      origin: session.origin,
      supplyStation: session.supplyStation || undefined,
      roads: session.roads,
      intersections: session.intersections,
      turnPaths: [],
      turnArcs: session.turnArcs,
      beamPositions: session.beamPositions,
      status: session.status === 'completed' ? 'completed' : 'draft'
    });

    res.json({ success: true, message: '建图数据已保存', data: { id: gpsMap.id, name: gpsMap.name, status: gpsMap.status } });
  } catch (error) {
    console.error('保存建图数据失败:', error);
    res.status(500).json({ success: false, message: '保存建图数据失败' });
  }
};

export const loadMappingFromDatabase = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const gpsMap = await GPSMap.findByPk(id);
    if (!gpsMap) return res.status(404).json({ success: false, message: '地图不存在' });

    // 解析可能为字符串的字段
    let turnArcs = (gpsMap as any).turnArcs || [];
    if (typeof turnArcs === 'string') {
      try {
        turnArcs = JSON.parse(turnArcs);
        console.log('[GPS建图] turnArcs从字符串解析成功, 数量:', turnArcs.length);
      } catch (e) {
        console.error('[GPS建图] turnArcs解析失败:', e);
        turnArcs = [];
      }
    }

    currentSession = {
      id: `session_loaded_${Date.now()}`,
      status: gpsMap.status as any,
      currentRoadId: null,
      currentRoadType: null,
      origin: gpsMap.origin,
      supplyStation: gpsMap.supplyStation || null,
      roads: gpsMap.roads,
      intersections: gpsMap.intersections,
      turnArcs: turnArcs,
      beamPositions: gpsMap.beamPositions,
      angles: null,
      recordingStartTime: null,
      lastUpdateTime: Date.now()
    };

    console.log('[GPS建图] 加载地图:', gpsMap.name);
    console.log('[GPS建图] 道路数:', gpsMap.roads?.length || 0);
    console.log('[GPS建图] 交叉点数:', gpsMap.intersections?.length || 0);
    console.log('[GPS建图] 圆弧数:', Array.isArray(turnArcs) ? turnArcs.length : 0);

    if (gpsMap.origin) {
      initServices({
        latitude: gpsMap.origin.gps.latitude,
        longitude: gpsMap.origin.gps.longitude,
        rotation: gpsMap.origin.rotation
      }, gpsMap.origin.utm);
    }

    res.json({ success: true, message: '地图已加载', data: gpsMap });
  } catch (error) {
    console.error('加载建图数据失败:', error);
    res.status(500).json({ success: false, message: '加载建图数据失败' });
  }
};

export const getSavedMaps = async (req: Request, res: Response) => {
  try {
    const maps = await GPSMap.findAll({
      attributes: ['id', 'name', 'description', 'status', 'createdAt', 'updatedAt'],
      order: [['updatedAt', 'DESC']]
    });
    res.json({ success: true, data: maps });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取地图列表失败' });
  }
};

export const deleteSavedMap = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await GPSMap.destroy({ where: { id } });
    if (result === 0) return res.status(404).json({ success: false, message: '地图不存在' });
    res.json({ success: true, message: '地图已删除' });
  } catch (error) {
    res.status(500).json({ success: false, message: '删除地图失败' });
  }
};

// ============================================================
// 坐标转换
// ============================================================

export const convertGPSToMap = async (req: Request, res: Response) => {
  try {
    const { latitude, longitude } = req.body;
    if (!coordinateService) return res.status(400).json({ success: false, message: '原点未校准' });
    const mapPoint = coordinateService.gpsToMap(latitude, longitude);
    res.json({ success: true, data: mapPoint });
  } catch (error) {
    res.status(500).json({ success: false, message: '坐标转换失败' });
  }
};

export const convertMapToGPS = async (req: Request, res: Response) => {
  try {
    const { x, y } = req.body;
    if (!coordinateService) return res.status(400).json({ success: false, message: '原点未校准' });
    const gpsPoint = coordinateService.mapToGps(x, y);
    res.json({ success: true, data: gpsPoint });
  } catch (error) {
    res.status(500).json({ success: false, message: '坐标转换失败' });
  }
};

// ============================================================
// GPS状态（兼容）
// ============================================================

export const getGPSStatus = async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: { quality: 0, satellites: 0, hdop: 99, latitude: 0, longitude: 0, altitude: 0, isFixed: false, lastUpdate: new Date() }
  });
};

// ============================================================
// 导出原始GPS数据
// ============================================================

export const exportRawGPSData = async (req: Request, res: Response) => {
  try {
    const session = getOrCreateSession();
    
    const exportData = {
      exportTime: new Date().toISOString(),
      origin: session.origin,
      roads: session.roads.map(road => ({
        id: road.id,
        name: road.name,
        type: road.type,
        points: road.points.map(p => ({
          seq: p.seq,
          gps: p.gps,
          mapXy: p.mapXy
        })),
        totalPoints: road.points.length
      })),
      summary: {
        roadCount: session.roads.length,
        totalPoints: session.roads.reduce((sum, r) => sum + r.points.length, 0)
      }
    };

    const outputPath = path.join(process.cwd(), 'output', 'gps_raw_export.json');
    if (!fs.existsSync(path.dirname(outputPath))) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    }
    fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2));
    
    console.log(`[GPS建图] 原始数据已导出到: ${outputPath}`);
    
    res.json({
      success: true,
      message: '原始GPS数据已导出',
      data: {
        filePath: outputPath,
        summary: exportData.summary
      }
    });
  } catch (error) {
    console.error('[GPS建图] 导出原始数据失败:', error);
    res.status(500).json({ success: false, message: `导出失败: ${(error as Error).message}` });
  }
};

// ============================================================
// 获取当前会话的完整数据（调试用）
// ============================================================

export const getSessionDebug = async (req: Request, res: Response) => {
  try {
    const session = getOrCreateSession();
    res.json({
      success: true,
      data: {
        sessionId: session.id,
        status: session.status,
        origin: session.origin,
        roads: session.roads.map(r => ({
          id: r.id,
          name: r.name,
          type: r.type,
          pointsCount: r.points.length,
          firstPoint: r.points[0]?.gps,
          lastPoint: r.points[r.points.length - 1]?.gps
        })),
        intersectionsCount: session.intersections.length,
        turnArcsCount: session.turnArcs.length,
        beamPositionsCount: session.beamPositions.length,
        angles: session.angles
      }
    });
  } catch (error) {
    console.error('[GPS建图] 获取调试信息失败:', error);
    res.status(500).json({ success: false, message: `获取失败: ${(error as Error).message}` });
  }
};
