/**
 * 作业路线规划器 - 工具函数
 */

import { MapPoint, Waypoint } from './types';

/**
 * 计算两点之间的距离
 */
export function distance(p1: MapPoint, p2: MapPoint): number {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}

/**
 * 归一化角度到 [0, 2π) 范围
 */
export function normalizeAngle(angle: number): number {
  while (angle < 0) angle += 2 * Math.PI;
  while (angle >= 2 * Math.PI) angle -= 2 * Math.PI;
  return angle;
}

/**
 * 根据两点计算yaw角（北向为0，东向为π/2）
 * 使用 atan2(dx, dy) 转换到北向坐标系
 */
export function calculateYawFromPoints(from: MapPoint, to: MapPoint): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.atan2(dx, dy);
}

/**
 * 归一化角度到 [-π, π] 范围
 */
export function normalizeAngleSigned(angle: number): number {
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

/**
 * 根据方向获取yaw角
 * @deprecated 使用 calculateYawFromPoints 代替
 */
export function directionToYaw(direction: 'north' | 'south' | 'east' | 'west'): number {
  switch (direction) {
    case 'north': return 0;
    case 'east': return Math.PI / 2;
    case 'south': return Math.PI;
    case 'west': return -Math.PI / 2;
  }
}

/**
 * 获取相反方向
 */
export function getOppositeDirection(dir: 'north' | 'south' | 'east' | 'west'): 'north' | 'south' | 'east' | 'west' {
  switch (dir) {
    case 'north': return 'south';
    case 'south': return 'north';
    case 'east': return 'west';
    case 'west': return 'east';
  }
}

/**
 * 推断点相对于中心的方向
 */
export function inferDirection(center: MapPoint, point: MapPoint): 'north' | 'south' | 'east' | 'west' {
  const dx = point.x - center.x;
  const dy = point.y - center.y;

  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? 'east' : 'west';
  } else {
    return dy > 0 ? 'north' : 'south';
  }
}

/**
 * 根据转弯方向计算象限
 */
export function getTurnQuadrant(
  fromDir: 'north' | 'south' | 'east' | 'west',
  toDir: 'north' | 'south' | 'east' | 'west'
): number {
  const key = `${fromDir}:${toDir}`;
  
  const rightTurnMap: Record<string, number> = {
    'north:east': 3,
    'east:south': 0,
    'south:west': 1,
    'west:north': 2,
  };

  const leftTurnMap: Record<string, number> = {
    'north:west': 2,
    'west:south': 1,
    'south:east': 0,
    'east:north': 3,
  };

  if (rightTurnMap[key] !== undefined) return rightTurnMap[key];
  if (leftTurnMap[key] !== undefined) return leftTurnMap[key];
  
  console.warn(`[getTurnQuadrant] 未知转弯方向: ${key}, 默认返回0`);
  return 0;
}

/**
 * 生成带yaw角的航点数组
 */
export function generateWaypointsWithYaw(points: MapPoint[]): Waypoint[] {
  const waypoints: Waypoint[] = [];

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    let yaw: number;

    if (i < points.length - 1) {
      yaw = normalizeAngle(calculateYawFromPoints(point, points[i + 1]));
    } else if (i > 0) {
      yaw = normalizeAngle(calculateYawFromPoints(points[i - 1], point));
    } else {
      yaw = 0;
    }

    waypoints.push({
      x: point.x,
      y: point.y,
      yaw
    });
  }

  return waypoints;
}

/**
 * 投影点到道路
 */
export function projectOnRoad(point: MapPoint, roadPoints: { map_xy: MapPoint }[]): number {
  if (roadPoints.length < 2) return 0;
  
  let totalDist = 0;
  let minProj = 0;
  let minDist = Infinity;

  for (let i = 0; i < roadPoints.length - 1; i++) {
    const p1 = roadPoints[i].map_xy;
    const p2 = roadPoints[i + 1].map_xy;
    const segLen = distance(p1, p2);

    if (segLen === 0) continue;

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const t = Math.max(0, Math.min(1, ((point.x - p1.x) * dx + (point.y - p1.y) * dy) / (segLen * segLen)));

    const projX = p1.x + t * dx;
    const projY = p1.y + t * dy;
    const projDist = distance(point, { x: projX, y: projY });

    if (projDist < minDist) {
      minDist = projDist;
      minProj = totalDist + t * segLen;
    }

    totalDist += segLen;
  }

  return minProj;
}

/**
 * 计算道路段长度
 */
export function calculateRoadSegmentLength(points: MapPoint[]): number {
  let length = 0;
  for (let i = 0; i < points.length - 1; i++) {
    length += distance(points[i], points[i + 1]);
  }
  return length;
}

/**
 * 按起点到终点的顺序排列道路点
 */
export function orderRoadPoints(points: MapPoint[], startPoint: MapPoint, endPoint: MapPoint): MapPoint[] {
  if (points.length < 2) return points;

  const firstDistToStart = distance(points[0], startPoint);
  const firstDistToEnd = distance(points[0], endPoint);

  if (firstDistToStart > firstDistToEnd) {
    return [...points].reverse();
  }
  return [...points];
}

/**
 * 裁剪道路点以匹配转弯弧切点
 */
export function trimRoadPointsToTangent(
  points: MapPoint[], 
  tangent: MapPoint, 
  side: 'start' | 'end'
): MapPoint[] {
  if (points.length < 2) return points;

  let nearestIdx = 0;
  let minDist = distance(points[0], tangent);
  
  for (let i = 1; i < points.length; i++) {
    const d = distance(points[i], tangent);
    if (d < minDist) {
      minDist = d;
      nearestIdx = i;
    }
  }

  // 如果切点距离最近的点太远，不裁剪
  if (minDist > 5.0) {
    return points;
  }

  if (side === 'start') {
    return points.slice(nearestIdx);
  } else {
    return points.slice(0, nearestIdx + 1);
  }
}

/**
 * 计算两个角度之间的差值（考虑周期性）
 */
export function angleDifference(angle1: number, angle2: number): number {
  let diff = angle2 - angle1;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return diff;
}

/**
 * 检查是否掉头（180度转向）
 */
export function isUTurn(yaw1: number, yaw2: number): boolean {
  const diff = Math.abs(angleDifference(yaw1, yaw2));
  return diff > Math.PI * 0.8; // 大于144度视为掉头
}

/**
 * 检查是否倒车（反向行驶）
 */
export function isReversing(yaw1: number, yaw2: number): boolean {
  const diff = Math.abs(angleDifference(yaw1, yaw2));
  return diff > Math.PI * 0.5; // 大于90度视为倒车
}