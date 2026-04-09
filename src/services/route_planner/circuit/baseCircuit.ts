/**
 * 基础绕行抽象类
 */

import { 
  BeamPosition, 
  RouteSegment, 
  CircuitConfig,
  MapPoint,
  BoundaryInfo,
  BeamCorners,
  Intersection,
  Road,
  SprayMode
} from '../types';
import { MapQuery } from '../core/mapQuery';
import { SprayStatusManager } from '../spray/sprayStatusManager';
import { 
  generateWaypointsWithYaw, 
  orderRoadPoints, 
  trimRoadPointsToTangent,
  getOppositeDirection,
  inferDirection
} from '../utils';
import { CLOCKWISE_BOUNDARIES, COUNTERCLOCKWISE_BOUNDARIES } from '../constants';

export abstract class BaseCircuit {
  protected mapQuery: MapQuery;
  protected sprayManager: SprayStatusManager;

  constructor(mapQuery: MapQuery, sprayManager: SprayStatusManager) {
    this.mapQuery = mapQuery;
    this.sprayManager = sprayManager;
  }

  /**
   * 规划绕行路线（抽象方法）
   */
  abstract plan(
    beam: BeamPosition, 
    startPos: MapPoint, 
    config: CircuitConfig
  ): RouteSegment[];

  /**
   * 获取边界顺序
   */
  protected getBoundaryOrder(clockwise: boolean): string[] {
    return clockwise ? [...CLOCKWISE_BOUNDARIES] : [...COUNTERCLOCKWISE_BOUNDARIES];
  }

  /**
   * 获取边界对应的行驶方向（顺时针）
   */
  protected getClockwiseTravelDirection(boundary: string): string {
    switch (boundary) {
      case 'west': return 'north';
      case 'north': return 'east';
      case 'east': return 'south';
      case 'south': return 'west';
    }
    return 'north';
  }

  /**
   * 获取边界对应的行驶方向（逆时针）
   */
  protected getCounterClockwiseTravelDirection(boundary: string): string {
    switch (boundary) {
      case 'west': return 'south';
      case 'south': return 'east';
      case 'east': return 'north';
      case 'north': return 'west';
    }
    return 'south';
  }

  /**
   * 计算边界端点
   */
  protected calculateBoundaryEndpoints(
    boundary: 'west' | 'north' | 'east' | 'south',
    corners: BeamCorners,
    _roadSegment: any
  ): { startPoint: MapPoint; endPoint: MapPoint; startInter: Intersection | null; endInter: Intersection | null } {
    let startPoint: MapPoint, endPoint: MapPoint;

    switch (boundary) {
      case 'west':
        startPoint = corners.sw;
        endPoint = corners.nw;
        break;
      case 'north':
        startPoint = corners.nw;
        endPoint = corners.ne;
        break;
      case 'east':
        startPoint = corners.ne;
        endPoint = corners.se;
        break;
      case 'south':
        startPoint = corners.se;
        endPoint = corners.sw;
        break;
    }

    // 查找对应的交叉点（简化版本）
    const beam = this.findBeamByBoundary(boundary);
    const startInter = beam ? (this.mapQuery.getIntersection(beam.corner_intersections[0]) ?? null) : null;
    const endInter = beam ? (this.mapQuery.getIntersection(beam.corner_intersections[2]) ?? null) : null;

    return { startPoint, endPoint, startInter, endInter };
  }

  /**
   * 根据边界找到梁位
   */
  private findBeamByBoundary(boundary: string): BeamPosition | null {
    return null;
  }

  /**
   * 预处理边界信息
   */
  protected prepareBoundaryInfos(
    beam: BeamPosition,
    orderedBoundaries: string[],
    clockwise: boolean,
    skipBoundaries: string[] = []
  ): BoundaryInfo[] {
    const boundaryInfos: BoundaryInfo[] = [];
    const corners = this.mapQuery.getBeamCorners(beam);

    for (const boundary of orderedBoundaries) {
      if (skipBoundaries.includes(boundary)) {
        console.log(`[BaseCircuit] 跳过边界: ${boundary}`);
        continue;
      }

      const roadId = beam.boundaries[boundary as keyof typeof beam.boundaries];
      if (!roadId) continue;

      const road = this.mapQuery.getRoad(roadId);
      if (!road) continue;

      const roadSegment = this.mapQuery.getBeamBoundarySegment(road, beam);
      if (!roadSegment) continue;

      const travelDir = clockwise 
        ? this.getClockwiseTravelDirection(boundary) 
        : this.getCounterClockwiseTravelDirection(boundary);

      const direction = this.getRoadDirection(boundary, road, clockwise);
      const { startPoint, endPoint, startInter, endInter } = this.calculateBoundaryEndpoints(
        boundary as 'west' | 'north' | 'east' | 'south',
        corners,
        roadSegment
      );

      let roadPoints = orderRoadPoints(roadSegment.points, startPoint, endPoint);

      // 查找转弯弧用于修剪
      if (endInter && startInter) {
        const nextInfo = boundaryInfos[boundaryInfos.length - 1];
        if (nextInfo && nextInfo.endInter) {
          const endTurnArc = this.findTurnArc(endInter, nextInfo.travelDir as any, travelDir as any);
          if (endTurnArc && endTurnArc.tangent_points && endTurnArc.tangent_points.length >= 2) {
            const entryTangent = endTurnArc.tangent_points[0];
            roadPoints = trimRoadPointsToTangent(roadPoints, entryTangent, 'end');
          }
        }
      }

      boundaryInfos.push({
        boundary: boundary as 'west' | 'north' | 'east' | 'south',
        road,
        roadSegment,
        direction: direction as 'forward' | 'backward',
        travelDir: travelDir as 'north' | 'south' | 'east' | 'west',
        startInter,
        endInter,
        roadPoints
      });
    }

    return boundaryInfos;
  }

  /**
   * 获取道路行驶方向
   */
  private getRoadDirection(boundary: string, road: Road, clockwise: boolean): string {
    const points = road.points;
    if (points.length < 2) return 'forward';

    const startPoint = points[0].map_xy;
    const endPoint = points[points.length - 1].map_xy;
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;

    const targetDir = clockwise 
      ? this.getClockwiseTravelDirection(boundary) 
      : this.getCounterClockwiseTravelDirection(boundary);

    if (targetDir === 'north') return dy > 0 ? 'forward' : 'backward';
    if (targetDir === 'east') return dx > 0 ? 'forward' : 'backward';
    if (targetDir === 'south') return dy < 0 ? 'forward' : 'backward';
    return dx < 0 ? 'forward' : 'backward';
  }

  /**
   * 查找转弯弧
   */
  protected findTurnArc(
    inter: Intersection,
    fromDir: 'north' | 'south' | 'east' | 'west',
    toDir: 'north' | 'south' | 'east' | 'west'
  ): any {
    const arcInfo = this.mapQuery.findArcForTurn(inter, fromDir, toDir);
    if (!arcInfo) return null;

    const arc = arcInfo.arc;
    let points = arc.points.map(p => ({ x: p.map_xy.x, y: p.map_xy.y }));
    if (arcInfo.reverse) {
      points = points.reverse();
    }

    const waypoints = generateWaypointsWithYaw(points);
    const finalTangents = arcInfo.reverse
      ? [arc.tangent_points[1], arc.tangent_points[0]]
      : [arc.tangent_points[0], arc.tangent_points[1]];

    return {
      type: 'turn_arc',
      arc_id: arc.id,
      spray_mode: 'none' as SprayMode,
      waypoints,
      tangent_points: finalTangents
    };
  }

  /**
   * 创建直线路段
   */
  protected createRoadSegment(
    roadId: string,
    beamId: string,
    side: string,
    sprayMode: SprayMode,
    roadPoints: MapPoint[]
  ): RouteSegment {
    const waypoints = generateWaypointsWithYaw(roadPoints);
    
    return {
      id: '',
      type: 'road',
      road_id: roadId,
      beam_id: beamId,
      side: side as any,
      spray_mode: sprayMode,
      waypoints
    };
  }

  /**
   * 创建转弯弧线段
   */
  protected createArcSegment(arc: any, reverse: boolean): RouteSegment {
    let points = arc.points.map((p: any) => ({ x: p.map_xy.x, y: p.map_xy.y }));
    if (reverse) {
      points = points.reverse();
    }

    const waypoints = generateWaypointsWithYaw(points);
    const finalTangents = reverse
      ? [arc.tangent_points[1], arc.tangent_points[0]]
      : [arc.tangent_points[0], arc.tangent_points[1]];

    return {
      id: '',
      type: 'turn_arc',
      arc_id: arc.id,
      spray_mode: 'none',
      waypoints,
      tangent_points: finalTangents
    };
  }

  /**
   * 创建过渡路段
   */
  protected createTransitSegment(from: MapPoint, to: MapPoint): RouteSegment {
    const waypoints = generateWaypointsWithYaw([from, to]);
    
    return {
      id: '',
      type: 'transit',
      spray_mode: 'none',
      waypoints
    };
  }
}