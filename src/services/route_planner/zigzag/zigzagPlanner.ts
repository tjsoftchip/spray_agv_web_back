/**
 * S形路线规划器
 * 适用场景：单行东西排列的相邻梁位
 * 
 * 规则：
 * - 偶数索引梁位：顺时针绕行（只绕3个边界）
 * - 奇数索引梁位：逆时针绕行（只绕3个边界）
 * - 第3个边界结束时，切换到下一个梁位
 * - 最后梁位完成后，做反向S返回补给站
 */

import { 
  BeamPosition, 
  RouteSegment, 
  MapPoint,
  BeamLayout
} from '../types';
import { MapQuery } from '../core/mapQuery';
import { PartialCircuit } from '../circuit/partialCircuit';
import { ZigzagSwitch } from './zigzagSwitch';
import { ZigzagReturn } from './zigzagReturn';
import { SprayStatusManager } from '../spray/sprayStatusManager';

export class ZigzagPlanner {
  private mapQuery: MapQuery;
  private partialCircuit: PartialCircuit;
  private zigzagSwitch: ZigzagSwitch;
  private zigzagReturn: ZigzagReturn;
  private sprayManager: SprayStatusManager;

  constructor(
    mapQuery: MapQuery, 
    sprayManager: SprayStatusManager
  ) {
    this.mapQuery = mapQuery;
    this.sprayManager = sprayManager;
    this.partialCircuit = new PartialCircuit(mapQuery, sprayManager);
    this.zigzagSwitch = new ZigzagSwitch(mapQuery);
    this.zigzagReturn = new ZigzagReturn(mapQuery, sprayManager);
  }

  /**
   * 判断是否适合S形路线
   */
  isApplicable(layout: BeamLayout): boolean {
    return layout.isSingleRow && layout.beams.length >= 2;
  }

  /**
   * 规划S形路线
   */
  plan(
    beams: BeamPosition[],
    supplyPos: MapPoint,
    supplyHeading: number
  ): RouteSegment[] {
    console.log(`[ZigzagPlanner] 开始S形路线规划，梁位数量: ${beams.length}`);
    
    const segments: RouteSegment[] = [];

    // 1. 补给站到第一个梁位
    const firstSegments = this.planSupplyToFirst(beams[0], supplyPos, supplyHeading);
    segments.push(...firstSegments);

    // 2. 逐个梁位S形绕行
    for (let i = 0; i < beams.length; i++) {
      const beam = beams[i];
      const isClockwise = (i % 2 === 0); // 偶数顺时针，奇数逆时针
      const isLast = (i === beams.length - 1);
      
      console.log(`[ZigzagPlanner] 梁位 ${beam.id}, ${isClockwise ? '顺时针' : '逆时针'}${isLast ? ' (最后)' : ''}`);

      // 规划部分绕行（3个边界）
      const circuitSegments = this.partialCircuit.plan(
        beam, 
        this.getLastPosition(segments),
        isClockwise,
        3 // 只绕3个边界
      );
      segments.push(...circuitSegments);

      // 如果不是最后梁位，添加S形切换
      if (!isLast) {
        const currentPos = this.getLastPosition(segments);
        const currentYaw = this.getLastYaw(segments);
        
        const switchSegments = this.zigzagSwitch.plan(
          beam,
          beams[i + 1],
          currentPos,
          currentYaw,
          isClockwise // 切换到相反方向
        );
        segments.push(...switchSegments);
      }
    }

    // 3. S形返回补给站
    const returnSegments = this.zigzagReturn.plan(beams, supplyPos);
    segments.push(...returnSegments);

    console.log(`[ZigzagPlanner] S形路线规划完成，共${segments.length}个路段`);
    return segments;
  }

  /**
   * 规划补给站到第一个梁位
   */
  private planSupplyToFirst(
    beam: BeamPosition,
    supplyPos: MapPoint,
    supplyHeading: number
  ): RouteSegment[] {
    const segments: RouteSegment[] = [];
    const corners = this.mapQuery.getBeamCorners(beam);

    // 找到南道路和西南角弧线
    const southRoadId = beam.boundaries.south;
    const southRoad = this.mapQuery.getRoad(southRoadId);
    if (!southRoad) {
      return [this.createTransitSegment(supplyPos, corners.sw)];
    }

    const swInterId = beam.corner_intersections[0];
    const swInter = this.mapQuery.getIntersection(swInterId);
    if (!swInter) {
      return [this.createTransitSegment(supplyPos, corners.sw)];
    }

    const swArcInfo = this.mapQuery.findArcForTurn(swInter, 'west', 'north');
    if (!swArcInfo) {
      return [this.createTransitSegment(supplyPos, corners.sw)];
    }

    // 补给站到弧线入口
    const arcEntryTangent = swArcInfo.reverse
      ? swArcInfo.arc.tangent_points[1]
      : swArcInfo.arc.tangent_points[0];

    const supplyToEntry = Math.sqrt(
      Math.pow(supplyPos.x - arcEntryTangent.x, 2) + 
      Math.pow(supplyPos.y - arcEntryTangent.y, 2)
    );

    if (supplyToEntry > 0.5) {
      const roadPoints = this.mapQuery.getRoadSegmentBetweenPoints(southRoadId, supplyPos, arcEntryTangent);
      if (roadPoints && roadPoints.length >= 2) {
        roadPoints[0] = supplyPos;
        segments.push({
          id: '',
          type: 'transit',
          spray_mode: 'none',
          waypoints: this.generateWaypoints(roadPoints)
        });
      }
    }

    // 西南角弧线
    segments.push(this.createArcSegment(swArcInfo.arc, swArcInfo.reverse));

    return segments;
  }

  /**
   * 获取最后一个位置
   */
  private getLastPosition(segments: RouteSegment[]): MapPoint {
    if (segments.length === 0) {
      return { x: 0, y: 0 };
    }
    const lastSeg = segments[segments.length - 1];
    return lastSeg.waypoints[lastSeg.waypoints.length - 1];
  }

  /**
   * 获取最后一个yaw
   */
  private getLastYaw(segments: RouteSegment[]): number {
    if (segments.length === 0) {
      return 0;
    }
    const lastSeg = segments[segments.length - 1];
    return lastSeg.waypoints[lastSeg.waypoints.length - 1].yaw;
  }

  /**
   * 创建过渡段
   */
  private createTransitSegment(from: MapPoint, to: MapPoint): RouteSegment {
    const travelYaw = Math.atan2(to.y - from.y, to.x - from.x);
    
    return {
      id: '',
      type: 'transit',
      spray_mode: 'none',
      waypoints: [
        { x: from.x, y: from.y, yaw: travelYaw },
        { x: to.x, y: to.y, yaw: travelYaw }
      ]
    };
  }

  /**
   * 创建弧线段
   */
  private createArcSegment(arc: any, reverse: boolean): RouteSegment {
    let points = arc.points.map((p: any) => ({ x: p.map_xy.x, y: p.map_xy.y }));
    if (reverse) {
      points = points.reverse();
    }

    const waypoints = this.generateWaypoints(points);

    return {
      id: '',
      type: 'turn_arc',
      arc_id: arc.id,
      spray_mode: 'none',
      waypoints
    };
  }

  /**
   * 生成航点
   */
  private generateWaypoints(points: MapPoint[]): any[] {
    const waypoints = [];
    for (let i = 0; i < points.length; i++) {
      let yaw: number;
      if (i < points.length - 1) {
        yaw = Math.atan2(points[i + 1].y - points[i].y, points[i + 1].x - points[i].x);
        while (yaw < 0) yaw += 2 * Math.PI;
      } else if (i > 0) {
        yaw = Math.atan2(points[i].y - points[i - 1].y, points[i].x - points[i - 1].x);
        while (yaw < 0) yaw += 2 * Math.PI;
      } else {
        yaw = 0;
      }
      waypoints.push({ x: points[i].x, y: points[i].y, yaw });
    }
    return waypoints;
  }
}