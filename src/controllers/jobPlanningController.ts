import { Request, Response } from 'express';

// 梁位数据类型
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
}

// 路线段数据类型
interface RouteSegment {
  seq: number;
  name: string;
  roadId: string;
  length: number;
  sprayMode: 'none' | 'both' | 'left_only' | 'right_only';
  armStatus: 'retracted' | 'extended' | 'left_extended' | 'right_extended';
}

// 作业路线数据类型
interface JobRoute {
  id: string;
  name: string;
  totalLength: number;
  estimatedTime: number; // 秒
  segments: RouteSegment[];
  beamPositions: string[];
}

// 内存存储
let beamPositions: BeamPosition[] = [];
let currentJobStatus = {
  status: 'idle' as 'idle' | 'executing' | 'paused' | 'error',
  jobId: null as string | null,
  progress: 0,
  currentBeamPosition: null as string | null,
  estimatedTimeRemaining: 0,
  errorMessage: null as string | null
};
let jobHistory: any[] = [];

// 初始化示例梁位数据
const initSampleBeamPositions = () => {
  if (beamPositions.length === 0) {
    // 生成示例梁位（3行x4列）
    const rows = ['A', 'B', 'C'];
    const cols = [1, 2, 3, 4];
    
    rows.forEach((row, rowIndex) => {
      cols.forEach((col, colIndex) => {
        beamPositions.push({
          id: `${row}${col}`,
          name: `梁位${row}${col}`,
          row,
          col,
          center: {
            x: colIndex * 30 + 15,
            y: rowIndex * 25 + 12.5
          },
          boundaries: {
            north: rowIndex > 0 ? `road_h_${rowIndex}` : undefined,
            south: rowIndex < rows.length - 1 ? `road_h_${rowIndex + 1}` : undefined,
            east: colIndex < cols.length - 1 ? `road_v_${colIndex + 1}` : undefined,
            west: colIndex > 0 ? `road_v_${colIndex}` : undefined
          }
        });
      });
    });
  }
};

// 初始化
initSampleBeamPositions();

// 计算两点间距离
const calculateDistance = (p1: { x: number; y: number }, p2: { x: number; y: number }): number => {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
};

// 贪心算法优化梁位顺序
const optimizeBeamOrder = (selectedIds: string[], startPosition: { x: number; y: number }): string[] => {
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
};

// 生成路线段
const generateRouteSegments = (orderedBeamIds: string[]): RouteSegment[] => {
  const segments: RouteSegment[] = [];
  let seq = 0;

  // 补给站到第一个梁位
  segments.push({
    seq: ++seq,
    name: '补给站→' + orderedBeamIds[0],
    roadId: 'road_start',
    length: 50,
    sprayMode: 'none',
    armStatus: 'retracted'
  });

  // 梁位之间的路线
  for (let i = 0; i < orderedBeamIds.length; i++) {
    const currentId = orderedBeamIds[i];
    const nextId = orderedBeamIds[i + 1];

    // 当前梁位的喷淋路段
    segments.push({
      seq: ++seq,
      name: `${currentId}梁位作业`,
      roadId: `road_${currentId}`,
      length: 30,
      sprayMode: 'both', // 默认双侧，后续根据相邻梁位调整
      armStatus: 'extended'
    });

    // 过渡到下一个梁位
    if (nextId) {
      segments.push({
        seq: ++seq,
        name: `${currentId}→${nextId}过渡`,
        roadId: `road_${currentId}_${nextId}`,
        length: 25,
        sprayMode: 'none',
        armStatus: 'retracted'
      });
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
    armStatus: 'retracted'
  });

  return segments;
};

// 计算喷淋状态（根据相邻梁位）
const calculateSprayModes = (segments: RouteSegment[], orderedBeamIds: string[]): RouteSegment[] => {
  return segments.map(seg => {
    if (seg.name.includes('梁位作业')) {
      const beamId = seg.name.replace('梁位作业', '');
      const beamIndex = orderedBeamIds.indexOf(beamId);
      
      // 简化判断：如果两侧都有相邻梁位，则双侧喷淋
      const hasLeftNeighbor = beamIndex > 0;
      const hasRightNeighbor = beamIndex < orderedBeamIds.length - 1;
      
      if (hasLeftNeighbor && hasRightNeighbor) {
        return { ...seg, sprayMode: 'both' as const, armStatus: 'extended' as const };
      } else if (hasLeftNeighbor) {
        return { ...seg, sprayMode: 'left_only' as const, armStatus: 'left_extended' as const };
      } else if (hasRightNeighbor) {
        return { ...seg, sprayMode: 'right_only' as const, armStatus: 'right_extended' as const };
      } else {
        return { ...seg, sprayMode: 'both' as const, armStatus: 'extended' as const };
      }
    }
    return seg;
  });
};

// 获取梁位列表（本地）
export const getBeamPositionsLocal = async (req: Request, res: Response) => {
  try {
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

// 获取梁位列表（认证）
export const getBeamPositions = async (req: Request, res: Response) => {
  return getBeamPositionsLocal(req, res);
};

// 规划作业路线（本地）
export const planRoutesLocal = async (req: Request, res: Response) => {
  try {
    const { beamPositionIds } = req.body;

    if (!beamPositionIds || beamPositionIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: '请选择至少一个梁位'
      });
    }

    // 验证梁位ID
    const validIds = beamPositionIds.filter((id: string) => 
      beamPositions.some(b => b.id === id)
    );

    if (validIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: '无效的梁位ID'
      });
    }

    // 补给站位置（原点）
    const supplyStation = { x: 0, y: 0 };

    // 优化梁位顺序
    const orderedIds = optimizeBeamOrder(validIds, supplyStation);

    // 生成路线段
    let segments = generateRouteSegments(orderedIds);

    // 计算喷淋状态
    segments = calculateSprayModes(segments, orderedIds);

    // 计算总长度
    const totalLength = segments.reduce((sum, seg) => sum + seg.length, 0);

    // 估算时间（直线0.2m/s，转弯0.1m/s，加上喷淋时间）
    const travelTime = totalLength / 0.2; // 秒
    const sprayTime = orderedIds.length * 60; // 每个梁位约1分钟喷淋时间
    const estimatedTime = Math.ceil(travelTime + sprayTime);

    const route: JobRoute = {
      id: `route_${Date.now()}`,
      name: `喷淋路线 ${new Date().toLocaleDateString()}`,
      totalLength,
      estimatedTime,
      segments,
      beamPositions: orderedIds
    };

    res.json({
      success: true,
      data: {
        route,
        alternatives: [] // 可以生成多个备选路线
      }
    });
  } catch (error) {
    console.error('规划路线失败:', error);
    res.status(500).json({
      success: false,
      message: '规划路线失败'
    });
  }
};

// 规划作业路线（认证）
export const planRoutes = async (req: Request, res: Response) => {
  return planRoutesLocal(req, res);
};

// 执行喷淋作业
export const executeJob = async (req: Request, res: Response) => {
  try {
    const { routeId, beamPositionIds } = req.body;

    // 更新状态
    currentJobStatus = {
      status: 'executing',
      jobId: routeId || `job_${Date.now()}`,
      progress: 0,
      currentBeamPosition: null,
      estimatedTimeRemaining: 0,
      errorMessage: null
    };

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

// 暂停作业
export const pauseJob = async (req: Request, res: Response) => {
  try {
    if (currentJobStatus.status !== 'executing') {
      return res.status(400).json({
        success: false,
        message: '当前没有正在执行的作业'
      });
    }

    currentJobStatus.status = 'paused';

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

// 恢复作业
export const resumeJob = async (req: Request, res: Response) => {
  try {
    if (currentJobStatus.status !== 'paused') {
      return res.status(400).json({
        success: false,
        message: '当前没有暂停的作业'
      });
    }

    currentJobStatus.status = 'executing';

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

// 停止作业
export const stopJob = async (req: Request, res: Response) => {
  try {
    if (currentJobStatus.status === 'idle') {
      return res.status(400).json({
        success: false,
        message: '当前没有执行中的作业'
      });
    }

    // 保存历史
    jobHistory.push({
      ...currentJobStatus,
      endTime: new Date()
    });

    // 重置状态
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

// 获取作业状态（本地）
export const getJobStatusLocal = async (req: Request, res: Response) => {
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

// 获取作业状态（认证）
export const getJobStatus = async (req: Request, res: Response) => {
  return getJobStatusLocal(req, res);
};

// 获取作业历史
export const getJobHistory = async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: jobHistory.slice(-20) // 最近20条
    });
  } catch (error) {
    console.error('获取作业历史失败:', error);
    res.status(500).json({
      success: false,
      message: '获取作业历史失败'
    });
  }
};
