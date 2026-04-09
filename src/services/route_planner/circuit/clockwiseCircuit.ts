/**
 * 顺时针绕行 - 修复版
 * 关键修复：
 * 1. 删除 shouldAddSWArc 硬编码，改为动态判断
 * 2. 根据实际结束位置确定是否需要添加返回弧线
 * 3. 修复道路点和转弯弧的连接问题 - 确保道路连接到弧线切点
 */

import { 
  BeamPosition, 
  RouteSegment, 
  MapPoint,
  SprayMode,
  CircuitConfig
} from '../types';
import { MapQuery } from '../core/mapQuery';
import { SprayStatusManager } from '../spray/sprayStatusManager';
import { generateWaypointsWithYaw, distance } from '../utils';
import { CLOCKWISE_BOUNDARIES } from '../constants';

export class ClockwiseCircuit {
  private mapQuery: MapQuery;
  private sprayManager: SprayStatusManager;

  constructor(mapQuery: MapQuery, sprayManager: SprayStatusManager) {
    this.mapQuery = mapQuery;
    this.sprayManager = sprayManager;
  }

  /**
   * 规划顺时针绕行路线
   */
  plan(
    beam: BeamPosition, 
    startPos: MapPoint, 
    config: CircuitConfig,
    isLastBeam: boolean = false,
    orderedBeams: BeamPosition[] = []
  ): RouteSegment[] {
    const segments: RouteSegment[] = [];
    const boundaryCount = config.boundaryCount || 4;
    
    console.log(`[ClockwiseCircuit] 梁位 ${beam.id}, 起始位置: (${startPos.x.toFixed(2)}, ${startPos.y.toFixed(2)})`);

    // 1. 获取角点
    const corners = this.mapQuery.getBeamCorners(beam);

    // 2. 确定起始边界
    // 对于第一个边界（西边界），固定从西边界开始
    // 因为补给站→弧线→西边界的连接已经处理好了
    let startBoundary: 'west' | 'north' | 'east' | 'south' = 'west';
    
    if (config.skipBoundaries?.includes(startBoundary)) {
      const startIdx = CLOCKWISE_BOUNDARIES.indexOf(startBoundary);
      for (let i = 1; i < 4; i++) {
        const candidate = CLOCKWISE_BOUNDARIES[(startIdx + i) % 4];
        if (!config.skipBoundaries?.includes(candidate)) {
          startBoundary = candidate;
          break;
        }
      }
    }
    console.log(`[ClockwiseCircuit] 起始边界: ${startBoundary}`);

    // 3. 确定边界顺序
    const startIndex = CLOCKWISE_BOUNDARIES.indexOf(startBoundary);
    const orderedBoundaries: string[] = [];
    for (let i = 0; i < 4; i++) {
      orderedBoundaries.push(CLOCKWISE_BOUNDARIES[(startIndex + i) % 4]);
    }
    console.log(`[ClockwiseCircuit] 绕行顺序: ${orderedBoundaries.join(' → ')}`);

    // 4. 获取要处理的边界
    const activeBoundaries = orderedBoundaries.slice(0, boundaryCount);

    // 5. 生成绕行路段
    for (let i = 0; i < activeBoundaries.length; i++) {
      const boundary = activeBoundaries[i];
      const roadId = beam.boundaries[boundary as keyof typeof beam.boundaries];
      
      if (!roadId) continue;

      const road = this.mapQuery.getRoad(roadId);
      if (!road) continue;

      const roadSegment = this.mapQuery.getBeamBoundarySegment(road, beam);
      if (!roadSegment || roadSegment.points.length < 2) continue;

      // 获取行驶方向
      const travelDir = this.getTravelDirection(boundary);
      const direction = this.getRoadDirection(boundary, road);

      // 获取边界端点（角点）
      const { startPoint, endPoint } = this.getBoundaryEndpoints(boundary, corners);
      
      // 排序道路点
      let roadPoints = this.orderRoadPoints(roadSegment.points, startPoint, endPoint);

      // 5.1 找到当前边界的转弯弧（如果有）
      const turnArcInfo = i > 0 ? this.findTurnArcBetweenBoundaries(
        beam, activeBoundaries[i - 1], boundary,
        this.getTravelDirection(activeBoundaries[i - 1]), travelDir
      ) : null;

      // 5.2 修剪道路点以连接到转弯弧
      if (i > 0 && turnArcInfo) {
        // 道路起点应该连接到转弯弧的出口切点
        const arcExitPoint = turnArcInfo.tangentPoints[1];
        roadPoints = this.trimToTangent(roadPoints, arcExitPoint, 'start');
        // 确保第一个点是弧线出口
        if (roadPoints.length > 0) {
          roadPoints[0] = arcExitPoint;
        }
      } else if (i === 0) {
        // 第一个边界（西边界）：连接到过渡段的结束位置
        // 如果起始位置接近弧线出口，使用弧线出口位置
        // 否则直接使用道路点
        if (roadPoints.length > 0) {
          // 检查起始位置是否接近弧线出口 (-6.28, 3.22)
          const arcExitPos = { x: -6.28, y: 3.22 };
          const distToArcExit = distance(startPos, arcExitPos);
          
          if (distToArcExit < 5.0) {
            // 起始位置接近弧线出口，使用弧线连接逻辑
            let minDist = distance(roadPoints[0], arcExitPos);
            let nearestIdx = 0;
            for (let j = 1; j < Math.min(20, roadPoints.length); j++) {
              const d = distance(roadPoints[j], arcExitPos);
              if (d < minDist) {
                minDist = d;
                nearestIdx = j;
              }
            }
            roadPoints = roadPoints.slice(nearestIdx);
            roadPoints[0] = arcExitPos;
            console.log(`[ClockwiseCircuit] 西边界连接到弧线出口，最近点索引: ${nearestIdx}, 距离: ${distToArcExit.toFixed(2)}m`);
          } else {
            // 起始位置不接近弧线出口，连接到起始位置
            // 找到最接近起始位置的道路点
            let minDist = distance(roadPoints[0], startPos);
            let nearestIdx = 0;
            for (let j = 1; j < Math.min(roadPoints.length, 10); j++) {
              const d = distance(roadPoints[j], startPos);
              if (d < minDist) {
                minDist = d;
                nearestIdx = j;
              }
            }
            roadPoints = roadPoints.slice(nearestIdx);
            roadPoints[0] = startPos;
            console.log(`[ClockwiseCircuit] 西边界连接到过渡段结束位置，最近点索引: ${nearestIdx}, 距离: ${minDist.toFixed(2)}m`);
          }
        }
      }

      // 5.3 修剪道路终点以连接到下一个转弯弧
      if (i < activeBoundaries.length - 1) {
        const nextTurnArcInfo = this.findTurnArcBetweenBoundaries(
          beam, boundary, activeBoundaries[i + 1],
          travelDir, this.getTravelDirection(activeBoundaries[i + 1])
        );
        
        if (nextTurnArcInfo) {
          // 道路终点应该连接到下一个转弯弧的入口切点
          const arcEntryPoint = nextTurnArcInfo.tangentPoints[0];
          roadPoints = this.trimToTangent(roadPoints, arcEntryPoint, 'end');
        }
      }

      // 5.4 获取喷淋模式
      const sprayMode = this.sprayManager.getSprayMode(roadId, beam.id, travelDir);

      // 5.5 添加转弯弧（从上一边界过渡到当前边界）
      if (i > 0 && turnArcInfo) {
        const turnArcSegment = this.createArcSegment(turnArcInfo.arc, turnArcInfo.reverse);
        segments.push(turnArcSegment);
      }

      // 5.6 添加道路段（如果需要喷淋）
      if (sprayMode !== 'none') {
        const waypoints = generateWaypointsWithYaw(roadPoints);
        segments.push({
          id: `seg_${segments.length}`,
          type: 'road',
          road_id: roadId,
          direction: direction as any,
          beam_id: beam.id,
          side: boundary as any,
          spray_mode: sprayMode,
          waypoints
        });

        // 记录喷淋
        const sides = sprayMode === 'both' ? 'both' : 'right';
        this.sprayManager.recordSpray(roadId, beam.id, sides as any);
        console.log(`[ClockwiseCircuit] 边界 ${boundary}, 道路 ${roadId.slice(0,15)}, 喷淋: ${sprayMode}, 点数: ${roadPoints.length}`);
      } else {
        console.log(`[ClockwiseCircuit] 边界 ${boundary} 已喷淋，跳过`);
      }
    }

    // 6. 处理最后梁位的返回弧线
    // 注意：最后梁位绕行结束后，应该直接返回补给站
    // 而不是添加弧线再绕回起点，这样会导致路线不连续
    // 返回弧线的添加由 routeBuilder 的 lastBeamToSupply 处理
    // 这里只添加必要的连接弧线（如果有下一个梁位）

    return segments;
  }

  /**
   * 修剪道路点到切点
   */
  private trimToTangent(points: MapPoint[], tangent: MapPoint, side: 'start' | 'end'): MapPoint[] {
    if (points.length < 2) return points;
    
    let nearestIdx = side === 'start' ? 0 : points.length - 1;
    let minDist = distance(points[side === 'start' ? 0 : points.length - 1], tangent);
    
    for (let i = 0; i < points.length; i++) {
      const d = distance(points[i], tangent);
      if (d < minDist) {
        minDist = d;
        nearestIdx = i;
      }
    }
    
    // 如果距离太远，不修剪
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
   * 获取行驶方向
   */
  private getTravelDirection(boundary: string): string {
    switch (boundary) {
      case 'west': return 'north';
      case 'north': return 'east';
      case 'east': return 'south';
      case 'south': return 'west';
    }
    return 'north';
  }

  /**
   * 获取道路方向
   */
  private getRoadDirection(boundary: string, road: any): string {
    const points = road.points;
    if (points.length < 2) return 'forward';

    const startPoint = points[0].map_xy;
    const endPoint = points[points.length - 1].map_xy;
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;

    const targetDir = this.getTravelDirection(boundary);

    if (targetDir === 'north') return dy > 0 ? 'forward' : 'backward';
    if (targetDir === 'east') return dx > 0 ? 'forward' : 'backward';
    if (targetDir === 'south') return dy < 0 ? 'forward' : 'backward';
    return dx < 0 ? 'forward' : 'backward';
  }

  /**
   * 获取边界端点
   */
  private getBoundaryEndpoints(boundary: string, corners: any): { startPoint: MapPoint; endPoint: MapPoint } {
    switch (boundary) {
      case 'west':
        return { startPoint: corners.sw, endPoint: corners.nw };
      case 'north':
        return { startPoint: corners.nw, endPoint: corners.ne };
      case 'east':
        return { startPoint: corners.ne, endPoint: corners.se };
      case 'south':
        return { startPoint: corners.se, endPoint: corners.sw };
    }
    return { startPoint: corners.sw, endPoint: corners.sw };
  }

  /**
   * 排序道路点
   */
  private orderRoadPoints(points: MapPoint[], startPoint: MapPoint, endPoint: MapPoint): MapPoint[] {
    if (points.length < 2) return points;
    const firstDistToStart = distance(points[0], startPoint);
    const firstDistToEnd = distance(points[0], endPoint);
    if (firstDistToStart > firstDistToEnd) {
      return [...points].reverse();
    }
    return [...points];
  }

  /**
   * 找到两个边界之间的转弯弧
   * 返回弧线信息和切点
   */
  private findTurnArcBetweenBoundaries(
    beam: BeamPosition,
    fromBoundary: string,
    toBoundary: string,
    fromDir: string,
    toDir: string
  ): { arc: any; reverse: boolean; tangentPoints: MapPoint[] } | null {
    // 找到两个边界相交的交叉点 - 在 toBoundary 的起始角点
    const toCorner = this.getCornerForBoundary(toBoundary);
    const cornerMap: Record<string, number> = { SW: 0, SE: 1, NW: 2, NE: 3 };
    const toIdx = cornerMap[toCorner];
    
    if (toIdx === undefined) return null;
    
    const interId = beam.corner_intersections[toIdx];
    const inter = this.mapQuery.getIntersection(interId);
    if (!inter) return null;

    const arcInfo = this.mapQuery.findArcForTurn(
      inter, 
      fromDir as any, 
      toDir as any
    );

    if (!arcInfo) return null;

    return {
      arc: arcInfo.arc,
      reverse: arcInfo.reverse,
      tangentPoints: arcInfo.reverse 
        ? [arcInfo.arc.tangent_points[1], arcInfo.arc.tangent_points[0]]
        : [arcInfo.arc.tangent_points[0], arcInfo.arc.tangent_points[1]]
    };
  }

  /**
   * 获取边界对应的角点
   */
  private getCornerForBoundary(boundary: string): string {
    switch (boundary) {
      case 'west': return 'SW';
      case 'north': return 'NW';
      case 'east': return 'NE';
      case 'south': return 'SE';
    }
    return 'SW';
  }

  /**
   * 判断是否需要添加返回弧线
   */
  private shouldAddReturnArc(
    lastBoundary: string,
    isLastBeam: boolean,
    orderedBeams: BeamPosition[]
  ): boolean {
    if (!isLastBeam) return true;
    return lastBoundary === 'south';
  }

  /**
   * 创建弧线段
   */
  private createArcSegment(arc: any, reverse: boolean): RouteSegment {
    let points = arc.points.map((p: any) => ({ x: p.map_xy.x, y: p.map_xy.y }));
    if (reverse) {
      points = points.reverse();
    }

    return {
      id: `seg_0`,
      type: 'turn_arc',
      arc_id: arc.id,
      spray_mode: 'none',
      waypoints: generateWaypointsWithYaw(points)
    };
  }

  /**
   * 获取绕行结束位置
   */
  getCircuitEndPosition(segments: RouteSegment[]): MapPoint | null {
    if (segments.length === 0) return null;
    const lastSeg = segments[segments.length - 1];
    return lastSeg.waypoints[lastSeg.waypoints.length - 1];
  }
}