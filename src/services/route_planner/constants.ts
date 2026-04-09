/**
 * 作业路线规划器 - 常量定义
 */

// 距离阈值
export const DISTANCE_THRESHOLD = {
  CONNECTION: 0.5,      // 路段连接距离阈值
  TRIM_TANGENT: 5.0,    // 道路修剪切点距离阈值
  NEAREST_BEAM: 3.0,    // 最近梁位距离阈值
  NEAREST_ROAD: 2.0,    // 最近道路距离阈值
};

// 速度配置 (m/s)
export const SPEED_CONFIG = {
  TRAVEL: 0.5,          // 行驶速度
  SPRAY: 0.3,           // 喷淋速度
  TURN: 5,              // 单次转弯时间(秒)
};

// 顺时针边界顺序
export const CLOCKWISE_BOUNDARIES = ['west', 'north', 'east', 'south'] as const;

// 逆时针边界顺序
export const COUNTERCLOCKWISE_BOUNDARIES = ['west', 'south', 'east', 'north'] as const;

// 边界对应的行驶方向（顺时针）
export const CLOCKWISE_TRAVEL_DIR: Record<string, string> = {
  west: 'north',
  north: 'east',
  east: 'south',
  south: 'west',
};

// 边界对应的行驶方向（逆时针）
export const COUNTERCLOCKWISE_TRAVEL_DIR: Record<string, string> = {
  west: 'south',
  south: 'east',
  east: 'north',
  north: 'west',
};

// 象限定义
export const QUADRANT = {
  SW: 0,  // 西南角 - 右转：东→南，左转：南→东
  SE: 1,  // 东南角 - 右转：南→西，左转：西→南
  NE: 2,  // 东北角 - 右转：西→北，左转：北→西
  NW: 3,  // 西北角 - 右转：北→东，左转：东→北
};

// 转弯方向象限映射
export const TURN_QUADRANT_MAP = {
  // 右转
  'north:east': QUADRANT.NW,
  'east:south': QUADRANT.SW,
  'south:west': QUADRANT.SE,
  'west:north': QUADRANT.NE,
  // 左转
  'north:west': QUADRANT.NE,
  'west:south': QUADRANT.SE,
  'south:east': QUADRANT.SW,
  'east:north': QUADRANT.NW,
};

// 角点索引映射
export const CORNER_INDEX: Record<string, number> = {
  SW: 0,
  SE: 1,
  NW: 2,
  NE: 3,
};

// 默认配置
export const DEFAULT_CONFIG = {
  SUPPLY_APPROACH_DISTANCE: 3.0,
  MAX_ITERATIONS: 1000,
};