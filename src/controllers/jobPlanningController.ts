/**
 * 作业规划控制器
 * 按照文档 web-gps-mapping-design.md 实现喷淋作业规划
 *
 * 核心功能：
 * 1. 获取梁位列表（从GPS建图数据）
 * 2. 规划作业线路（闭环路径：补给站→梁位序列→补给站）
 * 3. 自动判断喷淋状态（共享道路双侧喷淋，非共享道路单侧喷淋）
 * 4. 执行作业（调用ROS2导航和喷淋服务）
 *
 * ROS2服务调用:
 * - /navigation_task/start: 开始导航任务
 * - /navigation_task/pause: 暂停导航
 * - /navigation_task/resume: 恢复导航
 * - /navigation_task/stop: 停止导航
 * - /spray_control/*: 喷淋设备控制
 */

import { Request, Response } from 'express';
import GPSMap from '../models/GPSMap';
import rosbridgeService from '../services/rosbridgeService';
import { jobRoutePlanner, JobRoute } from '../services/jobRoutePlanner';
import fs from 'fs';
import path from 'path';

// 类型定义
interface BeamPosition {
  id: string;
  name: string;
  row: string;
  col: number;
  center: { x: number; y: number };
  boundaries: {
    north?: string;
    south?: string;
    east?: string;
    west?: string;
  };
  crossPoints?: string[];           // 可选字段，兼容模型
  corner_intersections?: string[];  // V4.0新增
  neighbors?: {                     // V4.0新增
    left?: string;
    right?: string;
    top?: string;
    bottom?: string;
  };
}

interface Road {
  id: string;
  name: string;
  type: 'longitudinal' | 'horizontal';
  params: {
    preferredWidth: number;
    highCostWidth: number;
  };
  points: Array<{
    seq: number;
    gps: { latitude: number; longitude: number; altitude: number };
    mapXy: { x: number; y: number };
  }>;
}

interface RouteSegment {
  seq: number;
  name: string;
  roadId: string;
  length: number;
  sprayMode: 'none' | 'both' | 'left_only' | 'right_only';
  armStatus: 'retracted' | 'extended' | 'left_extended' | 'right_extended';
  sprayConfig?: {
    arm: string;
    leftValve: boolean;
    rightValve: boolean;
    pump: boolean;
    mountRaised: boolean;
  };
}

// 当前作业状态
interface JobStatus {
  status: 'idle' | 'executing' | 'paused' | 'error';
  jobId: string | null;
  progress: number;
  currentBeamPosition: string | null;
  estimatedTimeRemaining: number;
  errorMessage: string | null;
}

let currentJobStatus: JobStatus = {
  status: 'idle',
  jobId: null,
  progress: 0,
  currentBeamPosition: null,
  estimatedTimeRemaining: 0,
  errorMessage: null
};

let jobHistory: any[] = [];

// ==================== 坐标格式兼容辅助函数 ====================

/**
 * 获取道路点的地图坐标（兼容mapXy和map_xy两种格式）
 */
function getRoadPointMapXy(point: Road['points'][0]): { x: number; y: number } {
  if (point.mapXy) return point.mapXy;
  if ((point as any).map_xy) return (point as any).map_xy;
  return { x: 0, y: 0 };
}

// ==================== 数据加载辅助函数 ====================

const MAPS_DIR = '/home/jetson/yahboomcar_ros2_ws/yahboomcar_ws/src/yahboomcar_nav/maps';

/**
 * 从文件加载梁位数据
 */
function loadBeamPositionsFromFile(): BeamPosition[] {
  const filePath = path.join(MAPS_DIR, 'beam_positions.json');
  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (data.positions && Array.isArray(data.positions)) {
        console.log(`[作业规划] 从文件加载了 ${data.positions.length} 个梁位`);
        return data.positions;
      }
    } catch (e) {
      console.warn('[作业规划] 加载 beam_positions.json 失败:', e);
    }
  }
  return [];
}

/**
 * 从文件加载道路数据
 */
function loadRoadsFromFile(): Road[] {
  const filePath = path.join(MAPS_DIR, 'gps_routes.json');
  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (data.roads && Array.isArray(data.roads)) {
        console.log(`[作业规划] 从文件加载了 ${data.roads.length} 条道路`);
        return data.roads;
      }
    } catch (e) {
      console.warn('[作业规划] 加载 gps_routes.json 失败:', e);
    }
  }
  return [];
}

/**
 * 获取建图数据（优先从数据库，其次从文件）
 */
async function getMappingData(): Promise<{ beamPositions: BeamPosition[]; roads: Road[] }> {
  // 先尝试从数据库获取
  try {
    const latestMap = await GPSMap.findOne({
      where: { status: 'completed' },
      order: [['updatedAt', 'DESC']]
    });

    if (latestMap && latestMap.beamPositions && latestMap.beamPositions.length > 0) {
      console.log(`[作业规划] 从数据库加载了 ${latestMap.beamPositions.length} 个梁位`);
      return {
        beamPositions: latestMap.beamPositions,
        roads: latestMap.roads || []
      };
    }
  } catch (e) {
    console.warn('[作业规划] 从数据库加载失败，尝试从文件加载:', e);
  }

  // 从文件加载
  const beamPositions = loadBeamPositionsFromFile();
  const roads = loadRoadsFromFile();

  return { beamPositions, roads };
}

// ==================== 工具函数 ====================

/**
 * 计算两点间距离
 */
function calculateDistance(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}

/**
 * 贪心算法优化梁位顺序
 * 实现文档中的闭环路径规划：补给站 → 梁位序列 → 补给站
 */
function optimizeBeamOrder(
  selectedIds: string[],
  beamPositions: BeamPosition[],
  startPosition: { x: number; y: number } = { x: 0, y: 0 }
): string[] {
  const remaining = [...selectedIds];
  const ordered: string[] = [];
  let current = startPosition;

  while (remaining.length > 0) {
    // 找最近的梁位
    let nearestIndex = 0;
    let minDistance = Infinity;

    remaining.forEach((id, index) => {
      const pos = beamPositions.find(b => b.id === id);
      if (pos) {
        const dist = calculateDistance(current, pos.center);
        if (dist < minDistance) {
          minDistance = dist;
          nearestIndex = index;
        }
      }
    });

    const nearestId = remaining.splice(nearestIndex, 1)[0];
    ordered.push(nearestId);

    const nearestPos = beamPositions.find(b => b.id === nearestId);
    if (nearestPos) {
      current = nearestPos.center;
    }
  }

  return ordered;
}

/**
 * 判断两个梁位是否相邻
 */
function areAdjacent(beam1: BeamPosition, beam2: BeamPosition): boolean {
  // 同行相邻（列差1）
  if (beam1.row === beam2.row && Math.abs(beam1.col - beam2.col) === 1) {
    return true;
  }
  // 同列相邻（行相邻）
  const rowLabels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const row1Idx = rowLabels.indexOf(beam1.row);
  const row2Idx = rowLabels.indexOf(beam2.row);
  if (beam1.col === beam2.col && Math.abs(row1Idx - row2Idx) === 1) {
    return true;
  }
  return false;
}

/**
 * 获取两个相邻梁位之间的共享道路
 */
function getSharedRoad(beam1: BeamPosition, beam2: BeamPosition): string | null {
  // 同行相邻：共享东侧/西侧道路
  if (beam1.row === beam2.row) {
    if (beam2.col === beam1.col + 1) {
      return beam1.boundaries.east ?? beam2.boundaries.west ?? null;
    } else if (beam1.col === beam2.col + 1) {
      return beam1.boundaries.west ?? beam2.boundaries.east ?? null;
    }
  }

  // 同列相邻：共享北侧/南侧道路
  const rowLabels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const row1Idx = rowLabels.indexOf(beam1.row);
  const row2Idx = rowLabels.indexOf(beam2.row);
  if (beam1.col === beam2.col) {
    if (row2Idx === row1Idx + 1) {
      return beam1.boundaries.south ?? beam2.boundaries.north ?? null;
    } else if (row1Idx === row2Idx + 1) {
      return beam1.boundaries.north ?? beam2.boundaries.south ?? null;
    }
  }

  return null;
}

/**
 * 判断道路的喷淋状态
 * 核心原则：文档中的全覆盖原则
 * - 共享道路（两侧梁位都选中）→ 双侧喷淋
 * - 非共享道路（仅一侧梁位选中）→ 单侧喷淋
 */
function determineSprayMode(
  roadId: string,
  selectedBeamIds: string[],
  allBeamPositions: BeamPosition[]
): 'none' | 'both' | 'left_only' | 'right_only' {
  // 找到这条道路两侧的梁位
  const leftBeam = allBeamPositions.find(bp =>
    bp.boundaries.east === roadId && selectedBeamIds.includes(bp.id)
  );
  const rightBeam = allBeamPositions.find(bp =>
    bp.boundaries.west === roadId && selectedBeamIds.includes(bp.id)
  );
  const northBeam = allBeamPositions.find(bp =>
    bp.boundaries.south === roadId && selectedBeamIds.includes(bp.id)
  );
  const southBeam = allBeamPositions.find(bp =>
    bp.boundaries.north === roadId && selectedBeamIds.includes(bp.id)
  );

  const hasLeft = !!leftBeam || !!northBeam;
  const hasRight = !!rightBeam || !!southBeam;

  if (hasLeft && hasRight) {
    return 'both'; // 共享道路，双侧喷淋
  } else if (hasLeft) {
    return 'left_only';
  } else if (hasRight) {
    return 'right_only';
  } else {
    return 'none';
  }
}

/**
 * 生成喷淋配置
 */
function generateSprayConfig(sprayMode: 'none' | 'both' | 'left_only' | 'right_only'): RouteSegment['sprayConfig'] {
  switch (sprayMode) {
    case 'both':
      return {
        arm: 'extended',
        leftValve: true,
        rightValve: true,
        pump: true,
        mountRaised: true
      };
    case 'left_only':
      return {
        arm: 'left_extended',
        leftValve: true,
        rightValve: false,
        pump: true,
        mountRaised: true
      };
    case 'right_only':
      return {
        arm: 'right_extended',
        leftValve: false,
        rightValve: true,
        pump: true,
        mountRaised: true
      };
    default:
      return {
        arm: 'retracted',
        leftValve: false,
        rightValve: false,
        pump: false,
        mountRaised: false
      };
  }
}

/**
 * 生成作业路线段
 */
function generateRouteSegments(
  orderedBeamIds: string[],
  beamPositions: BeamPosition[],
  roads: Road[]
): RouteSegment[] {
  const segments: RouteSegment[] = [];
  let seq = 0;

  // 补给站到第一个梁位
  const firstBeam = beamPositions.find(b => b.id === orderedBeamIds[0]);
  if (firstBeam) {
    segments.push({
      seq: ++seq,
      name: '补给站→' + orderedBeamIds[0],
      roadId: 'road_start',
      length: 50,
      sprayMode: 'none',
      armStatus: 'retracted',
      sprayConfig: generateSprayConfig('none')
    });
  }

  // 梁位之间的路线
  for (let i = 0; i < orderedBeamIds.length; i++) {
    const currentId = orderedBeamIds[i];
    const nextId = orderedBeamIds[i + 1];

    const currentBeam = beamPositions.find(b => b.id === currentId);
    if (!currentBeam) continue;

    // 当前梁位的喷淋路段 - 遍历梁位四周的所有道路
    const adjacentBeams = beamPositions.filter(b => 
      b.id !== currentId && areAdjacent(currentBeam, b)
    );

    // 为每条相邻道路生成喷淋路段
    for (const adjacentBeam of adjacentBeams) {
      const sharedRoad = getSharedRoad(currentBeam, adjacentBeam);
      if (sharedRoad) {
        const sprayMode = determineSprayMode(sharedRoad, orderedBeamIds, beamPositions);
        
        // 检查是否已经添加过这条道路
        const existingSegment = segments.find(s => s.roadId === sharedRoad);
        if (!existingSegment) {
          const road = roads.find(r => r.id === sharedRoad);
          const roadLength = road ? calculateRoadLength(road) : 30;

          segments.push({
            seq: ++seq,
            name: `${currentId}-${adjacentBeam.id}道路`,
            roadId: sharedRoad,
            length: roadLength,
            sprayMode,
            armStatus: sprayMode === 'none' ? 'retracted' : 
                       sprayMode === 'both' ? 'extended' :
                       sprayMode === 'left_only' ? 'left_extended' : 'right_extended',
            sprayConfig: generateSprayConfig(sprayMode)
          });
        }
      }
    }

    // 过渡到下一个梁位
    if (nextId) {
      const nextBeam = beamPositions.find(b => b.id === nextId);
      if (nextBeam) {
        const dist = calculateDistance(currentBeam.center, nextBeam.center);
        segments.push({
          seq: ++seq,
          name: `${currentId}→${nextId}过渡`,
          roadId: `road_${currentId}_${nextId}`,
          length: dist,
          sprayMode: 'none',
          armStatus: 'retracted',
          sprayConfig: generateSprayConfig('none')
        });
      }
    }
  }

  // 最后一个梁位返回补给站
  const lastBeamId = orderedBeamIds[orderedBeamIds.length - 1];
  segments.push({
    seq: ++seq,
    name: lastBeamId + '→补给站',
    roadId: 'road_end',
    length: 50,
    sprayMode: 'none',
    armStatus: 'retracted',
    sprayConfig: generateSprayConfig('none')
  });

  return segments;
}

/**
 * 计算道路长度
 */
function calculateRoadLength(road: Road): number {
  let length = 0;
  const points = road.points || [];
  for (let i = 1; i < points.length; i++) {
    const p1 = getRoadPointMapXy(points[i - 1]);
    const p2 = getRoadPointMapXy(points[i]);
    length += Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
  }
  return length;
}

// ==================== 控制器函数 ====================

/**
 * 获取梁位列表
 * 从最新的GPS建图数据中获取（优先数据库，其次文件）
 */
export const getBeamPositions = async (req: Request, res: Response) => {
  try {
    const { beamPositions } = await getMappingData();

    if (beamPositions.length === 0) {
      return res.json({
        success: true,
        data: [],
        message: '暂无建图数据，请先完成GPS建图'
      });
    }

    res.json({
      success: true,
      data: beamPositions
    });
  } catch (error) {
    console.error('获取梁位列表失败:', error);
    res.status(500).json({
      success: false,
      message: '获取梁位列表失败'
    });
  }
};

/**
 * 规划作业路线
 * 使用 JobRoutePlanner 实现完整路线规划
 * 保存时使用任务名称作为前缀，避免覆盖
 */
export const planRoutes = async (req: Request, res: Response) => {
  try {
    const { beamPositionIds, taskName } = req.body;

    if (!beamPositionIds || beamPositionIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: '请选择至少一个梁位'
      });
    }

    // 加载地图数据到规划器
    const mapsDir = '/home/jetson/yahboomcar_ros2_ws/yahboomcar_ws/src/yahboomcar_nav/maps';
    if (!jobRoutePlanner.loadData(mapsDir)) {
      return res.status(400).json({
        success: false,
        message: '无法加载地图数据，请先完成GPS建图'
      });
    }

    // 验证梁位ID
    const validIds = beamPositionIds.filter((id: string) => {
      // 规划器内部会验证
      return true;
    });

    if (validIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: '无效的梁位ID'
      });
    }

    // 使用规划器生成完整路线
    const route = jobRoutePlanner.planJobRoute(validIds);

    // 生成YAML格式（可选，用于ROS2）
    const yamlRoute = jobRoutePlanner.generateYAMLRoute(route);

    // 生成文件名：taskName_job_routes.yaml
    // 如果没有提供taskName，使用默认名称
    const safeTaskName = (taskName || 'task').replace(/[^a-zA-Z0-9_]/g, '_');
    const routeFileName = `${safeTaskName}_job_routes.yaml`;
    const routePath = path.join(mapsDir, routeFileName);
    fs.writeFileSync(routePath, yamlRoute, 'utf-8');
    console.log(`[作业规划] 路线已保存到: ${routePath}`);

    res.json({
      success: true,
      data: {
        route,
        yaml: yamlRoute,
        routeFilePath: routeFileName,
        alternatives: []
      }
    });
  } catch (error) {
    console.error('规划路线失败:', error);
    res.status(500).json({
      success: false,
      message: `规划路线失败: ${(error as Error).message}`
    });
  }
};

/**
 * 执行喷淋作业
 * 调用ROS2导航服务开始作业
 */
export const executeJob = async (req: Request, res: Response) => {
  try {
    const { routeId, beamPositionIds, route } = req.body;

    currentJobStatus = {
      status: 'executing',
      jobId: routeId || `job_${Date.now()}`,
      progress: 0,
      currentBeamPosition: null,
      estimatedTimeRemaining: 0,
      errorMessage: null
    };

    // 调用ROS2服务开始导航任务
    if (rosbridgeService.isConnected()) {
      try {
        // 发布导航任务开始消息
        rosbridgeService.publish('/navigation_task/start', 'std_msgs/String', {
          data: JSON.stringify({
            route_id: currentJobStatus.jobId,
            beam_positions: beamPositionIds,
            route: route
          })
        });
        console.log('[作业规划] ROS2导航任务已启动');
      } catch (rosError) {
        console.warn('[作业规划] 调用ROS2导航服务失败:', rosError);
      }
    }

    res.json({
      success: true,
      message: '作业已启动',
      data: currentJobStatus
    });
  } catch (error) {
    console.error('执行作业失败:', error);
    res.status(500).json({
      success: false,
      message: '执行作业失败'
    });
  }
};

/**
 * 暂停作业
 * 调用ROS2服务暂停导航
 */
export const pauseJob = async (req: Request, res: Response) => {
  try {
    if (currentJobStatus.status !== 'executing') {
      return res.status(400).json({
        success: false,
        message: '当前没有正在执行的作业'
      });
    }

    currentJobStatus.status = 'paused';

    // 调用ROS2服务暂停导航
    if (rosbridgeService.isConnected()) {
      try {
        rosbridgeService.publish('/navigation_task/pause', 'std_msgs/Empty', {});
        console.log('[作业规划] ROS2导航任务已暂停');
      } catch (rosError) {
        console.warn('[作业规划] 调用ROS2暂停服务失败:', rosError);
      }
    }

    res.json({
      success: true,
      message: '作业已暂停',
      data: currentJobStatus
    });
  } catch (error) {
    console.error('暂停作业失败:', error);
    res.status(500).json({
      success: false,
      message: '暂停作业失败'
    });
  }
};

/**
 * 恢复作业
 * 调用ROS2服务恢复导航
 */
export const resumeJob = async (req: Request, res: Response) => {
  try {
    if (currentJobStatus.status !== 'paused') {
      return res.status(400).json({
        success: false,
        message: '当前没有暂停的作业'
      });
    }

    currentJobStatus.status = 'executing';

    // 调用ROS2服务恢复导航
    if (rosbridgeService.isConnected()) {
      try {
        rosbridgeService.publish('/navigation_task/resume', 'std_msgs/Empty', {});
        console.log('[作业规划] ROS2导航任务已恢复');
      } catch (rosError) {
        console.warn('[作业规划] 调用ROS2恢复服务失败:', rosError);
      }
    }

    res.json({
      success: true,
      message: '作业已恢复',
      data: currentJobStatus
    });
  } catch (error) {
    console.error('恢复作业失败:', error);
    res.status(500).json({
      success: false,
      message: '恢复作业失败'
    });
  }
};

/**
 * 停止作业
 * 调用ROS2服务停止导航和喷淋
 */
export const stopJob = async (req: Request, res: Response) => {
  try {
    if (currentJobStatus.status === 'idle') {
      return res.status(400).json({
        success: false,
        message: '当前没有执行中的作业'
      });
    }

    // 调用ROS2服务停止导航
    if (rosbridgeService.isConnected()) {
      try {
        rosbridgeService.publish('/navigation_task/stop', 'std_msgs/Empty', {});
        console.log('[作业规划] ROS2导航任务已停止');
        
        // 停止喷淋设备 - 使用与ROS2 spray_controller.py一致的话题名称
        rosbridgeService.publish('/spray/pump_control', 'std_msgs/Bool', { data: false });
        rosbridgeService.publish('/spray/left_valve_control', 'std_msgs/Bool', { data: false });
        rosbridgeService.publish('/spray/right_valve_control', 'std_msgs/Bool', { data: false });
        rosbridgeService.publish('/spray/left_arm_control', 'std_msgs/String', { data: 'close' });
        rosbridgeService.publish('/spray/right_arm_control', 'std_msgs/String', { data: 'close' });
        rosbridgeService.publish('/spray/arm_height_control', 'std_msgs/Bool', { data: false });
        console.log('[作业规划] 喷淋设备已关闭');
      } catch (rosError) {
        console.warn('[作业规划] 调用ROS2停止服务失败:', rosError);
      }
    }

    jobHistory.push({
      ...currentJobStatus,
      endTime: new Date()
    });

    currentJobStatus = {
      status: 'idle',
      jobId: null,
      progress: 0,
      currentBeamPosition: null,
      estimatedTimeRemaining: 0,
      errorMessage: null
    };

    res.json({
      success: true,
      message: '作业已停止'
    });
  } catch (error) {
    console.error('停止作业失败:', error);
    res.status(500).json({
      success: false,
      message: '停止作业失败'
    });
  }
};

/**
 * 获取作业状态
 */
export const getJobStatus = async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: currentJobStatus
    });
  } catch (error) {
    console.error('获取作业状态失败:', error);
    res.status(500).json({
      success: false,
      message: '获取作业状态失败'
    });
  }
};

/**
 * 获取作业历史
 */
export const getJobHistory = async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: jobHistory.slice(-20)
    });
  } catch (error) {
    console.error('获取作业历史失败:', error);
    res.status(500).json({
      success: false,
      message: '获取作业历史失败'
    });
  }
};

// ==================== 本地端点（不需要认证） ====================

export const getBeamPositionsLocal = getBeamPositions;
export const planRoutesLocal = planRoutes;
export const getJobStatusLocal = getJobStatus;

// ==================== 路线预览 ====================

/**
 * 预览作业路线（不保存，仅返回可视化数据）
 */
export const previewRoute = async (req: Request, res: Response) => {
  try {
    const { beamPositionIds } = req.body;

    if (!beamPositionIds || beamPositionIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: '请选择至少一个梁位'
      });
    }

    // 加载地图数据到规划器
    const mapsDir = '/home/jetson/yahboomcar_ros2_ws/yahboomcar_ws/src/yahboomcar_nav/maps';
    if (!jobRoutePlanner.loadData(mapsDir)) {
      return res.status(400).json({
        success: false,
        message: '无法加载地图数据，请先完成GPS建图'
      });
    }

    // 生成预览路线
    const route = jobRoutePlanner.planJobRoute(beamPositionIds);

    // 提取可视化数据
    const visualizationData = {
      beamSequence: route.beam_sequence,
      totalLength: route.statistics.total_length,
      estimatedTime: route.statistics.estimated_time,
      sprayLength: route.statistics.spray_length,
      transitLength: route.statistics.transit_length,
      segments: route.segments.map(seg => ({
        id: seg.id,
        type: seg.type,
        roadId: seg.road_id,
        beamId: seg.beam_id,
        side: seg.side,
        sprayMode: seg.spray_mode,
        waypointCount: seg.waypoints.length,
        // 前端可视化需要的坐标数据
        coordinates: seg.waypoints.map(wp => ({
          x: wp.x,
          y: wp.y,
          yaw: wp.yaw,
          sprayAction: wp.spray_action
        }))
      }))
    };

    res.json({
      success: true,
      data: visualizationData
    });
  } catch (error) {
    console.error('预览路线失败:', error);
    res.status(500).json({
      success: false,
      message: `预览路线失败: ${(error as Error).message}`
    });
  }
};

/**
 * 获取地图数据（供前端可视化使用）
 */
export const getMapData = async (req: Request, res: Response) => {
  try {
    const mapsDir = '/home/jetson/yahboomcar_ros2_ws/yahboomcar_ws/src/yahboomcar_nav/maps';

    // 加载道路数据
    const roadsPath = path.join(mapsDir, 'gps_routes.json');
    let roads: any[] = [];
    let intersections: any[] = [];
    let turnArcs: any[] = [];
    let origin: any = null;

    if (fs.existsSync(roadsPath)) {
      const data = JSON.parse(fs.readFileSync(roadsPath, 'utf-8'));
      roads = data.roads || [];
      intersections = data.intersections || [];
      turnArcs = data.turn_arcs || [];
      origin = data.origin || null;
    }

    // 加载梁位数据
    const beamPath = path.join(mapsDir, 'beam_positions.json');
    let beamPositions: any[] = [];
    if (fs.existsSync(beamPath)) {
      const data = JSON.parse(fs.readFileSync(beamPath, 'utf-8'));
      beamPositions = data.positions || [];
    }

    res.json({
      success: true,
      data: {
        roads: roads.map((r: any) => ({
          id: r.id,
          name: r.name,
          type: r.type,
          points: (r.points || []).map((p: any) => {
            const xy = p.mapXy || p.map_xy || { x: 0, y: 0 };
            return { x: xy.x, y: xy.y };
          })
        })),
        intersections: intersections.map((i: any) => ({
          id: i.id,
          x: i.center?.map_xy?.x || i.center?.mapXy?.x || 0,
          y: i.center?.map_xy?.y || i.center?.mapXy?.y || 0,
          roadVId: i.road_v_id,
          roadHId: i.road_h_id,
          validQuadrants: i.valid_quadrants || []
        })),
        turnArcs: turnArcs.map((a: any) => ({
          id: a.id,
          intersectionId: a.intersection_id,
          quadrant: a.quadrant,
          center: a.center,
          points: (a.points || []).map((p: any) => {
            const xy = p.mapXy || p.map_xy || { x: 0, y: 0 };
            return { x: xy.x, y: xy.y };
          })
        })),
        beamPositions: beamPositions.map((b: any) => ({
          id: b.id,
          name: b.name,
          row: b.row,
          col: b.col,
          center: b.center,
          boundaries: b.boundaries,
          neighbors: b.neighbors
        })),
        origin: origin ? {
          latitude: origin.gps?.latitude || origin.gps?.lat,
          longitude: origin.gps?.longitude || origin.gps?.lon
        } : null,
        supplyStation: {
          x: 0,
          y: 0,
          name: '补给站'
        }
      }
    });
  } catch (error) {
    console.error('获取地图数据失败:', error);
    res.status(500).json({
      success: false,
      message: '获取地图数据失败'
    });
  }
};

export const previewRouteLocal = previewRoute;
export const getMapDataLocal = getMapData;