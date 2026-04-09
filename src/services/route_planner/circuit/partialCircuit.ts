/**
 * 部分绕行 - 用于S形路线
 * 只绕行指定数量的边界（通常是3个）
 */

import { 
  BeamPosition, 
  RouteSegment, 
  MapPoint,
  SprayMode
} from '../types';
import { BaseCircuit } from './baseCircuit';
import { generateWaypointsWithYaw } from '../utils';

export class PartialCircuit {
  private mapQuery: any;
  private sprayManager: any;

  constructor(mapQuery: any, sprayManager: any) {
    this.mapQuery = mapQuery;
    this.sprayManager = sprayManager;
  }

  /**
   * 规划部分绕行
   * @param beam 梁位
   * @param startPos 起始位置
   * @param clockwise 是否顺时针
   * @param boundaryCount 绕行边界数量（1-4）
   */
  plan(
    beam: BeamPosition, 
    startPos: MapPoint, 
    clockwise: boolean,
    boundaryCount: number
  ): RouteSegment[] {
    const segments: RouteSegment[] = [];
    
    // 顺时针：west -> north -> east -> south
    // 逆时针：west -> south -> east -> north
    const boundaries = clockwise 
      ? ['west', 'north', 'east', 'south'] 
      : ['west', 'south', 'east', 'north'];

    // 只处理前 boundaryCount 个边界
    const activeBoundaries = boundaries.slice(0, boundaryCount);
    
    console.log(`[PartialCircuit] 梁位 ${beam.id}, ${clockwise ? '顺时针' : '逆时针'}, 边界数: ${boundaryCount}`);
    console.log(`[PartialCircuit] 边界顺序: ${activeBoundaries.join(' → ')}`);

    const corners = this.mapQuery.getBeamCorners(beam);

    for (let i = 0; i < activeBoundaries.length; i++) {
      const boundary = activeBoundaries[i];
      const roadId = beam.boundaries[boundary as keyof typeof beam.boundaries];
      if (!roadId) continue;

      const road = this.mapQuery.getRoad(roadId);
      if (!road) continue;

      const roadSegment = this.mapQuery.getBeamBoundarySegment(road, beam);
      if (!roadSegment) continue;

      // 获取行驶方向
      const travelDir = this.getTravelDirection(boundary, clockwise);
      const direction = this.getRoadDirection(boundary, road, clockwise);

      // 获取边界端点
      const { startPoint, endPoint } = this.getBoundaryEndpoints(boundary, corners);
      let roadPoints = this.orderRoadPoints(roadSegment.points, startPoint, endPoint);

      // 获取喷淋模式
      const sprayMode = this.sprayManager.getSprayMode(roadId, beam.id, travelDir);

      // 如果已喷淋，跳过
      if (sprayMode === 'none') {
        console.log(`[PartialCircuit] 边界 ${boundary} 已喷淋，跳过`);
        // 但仍需要添加转弯弧线连接
      } else {
        // 添加道路段
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
        const sides = sprayMode === 'both' ? 'both' : (clockwise ? 'right' : 'left');
        this.sprayManager.recordSpray(roadId, beam.id, sides as any);
        
        console.log(`[PartialCircuit] 边界 ${boundary}, 喷淋: ${sprayMode}`);
      }

      // 添加转弯弧（除了最后一个边界）
      if (i < activeBoundaries.length - 1 && roadSegment.points.length > 0) {
        const nextBoundary = activeBoundaries[i + 1];
        // 找到两个边界相交的交叉点
        const turnArc = this.findTurnBetweenBoundaries(
          beam, 
          boundary, 
          nextBoundary,
          travelDir,
          clockwise
        );
        
        if (turnArc) {
          segments.push(turnArc);
        }
      }
    }

    return segments;
  }

  /**
   * 获取行驶方向
   */
  private getTravelDirection(boundary: string, clockwise: boolean): string {
    if (clockwise) {
      switch (boundary) {
        case 'west': return 'north';
        case 'north': return 'east';
        case 'east': return 'south';
        case 'south': return 'west';
      }
    } else {
      switch (boundary) {
        case 'west': return 'south';
        case 'south': return 'east';
        case 'east': return 'north';
        case 'north': return 'west';
      }
    }
    return 'north';
  }

  /**
   * 获取道路方向
   */
  private getRoadDirection(boundary: string, road: any, clockwise: boolean): string {
    const points = road.points;
    if (points.length < 2) return 'forward';

    const startPoint = points[0].map_xy;
    const endPoint = points[points.length - 1].map_xy;
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;

    const targetDir = this.getTravelDirection(boundary, clockwise);

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

    const firstDistToStart = this.distance(points[0], startPoint);
    const firstDistToEnd = this.distance(points[0], endPoint);

    if (firstDistToStart > firstDistToEnd) {
      return [...points].reverse();
    }
    return [...points];
  }

  /**
   * 计算距离
   */
  private distance(p1: MapPoint, p2: MapPoint): number {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
  }

  /**
   * 查找边界之间的转弯弧
   */
  private findTurnBetweenBoundaries(
    beam: BeamPosition,
    fromBoundary: string,
    toBoundary: string,
    fromDir: string,
    clockwise: boolean
  ): RouteSegment | null {
    // 找到两个边界相交的交叉点
    // 根据fromBoundary和toBoundary确定交叉点位置
    const fromCorner = this.getCornerForBoundary(fromBoundary);
    const toCorner = this.getCornerForBoundary(toBoundary);
    
    // 从梁位的corner_intersections找到对应的交叉点
    const interIds = beam.corner_intersections;
    const cornerMap: Record<string, number> = { SW: 0, SE: 1, NW: 2, NE: 3 };
    
    const fromIdx = cornerMap[fromCorner];
    const toIdx = cornerMap[toCorner];
    
    if (fromIdx === undefined || toIdx === undefined || !interIds[fromIdx]) {
      return null;
    }

    const inter = this.mapQuery.getIntersection(interIds[fromIdx]);
    if (!inter) return null;

    // 查找转弯弧
    const arcInfo = this.mapQuery.findArcForTurn(
      inter, 
      fromDir as any, 
      this.getTravelDirection(toBoundary, clockwise) as any
    );

    if (!arcInfo) return null;

    // 创建弧线段
    let points = arcInfo.arc.points.map((p: any) => ({ x: p.map_xy.x, y: p.map_xy.y }));
    if (arcInfo.reverse) {
      points = points.reverse();
    }

    const waypoints = generateWaypointsWithYaw(points);

    return {
      id: `seg_0`,
      type: 'turn_arc',
      arc_id: arcInfo.arc.id,
      spray_mode: 'none',
      waypoints
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
   * 获取部分绕行的结束位置
   */
  getPartialCircuitEndPosition(segments: RouteSegment[]): MapPoint | null {
    if (segments.length === 0) return null;
    const lastSeg = segments[segments.length - 1];
    return lastSeg.waypoints[lastSeg.waypoints.length - 1];
  }
}