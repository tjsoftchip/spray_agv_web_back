/**
 * 补给站到第一梁位过渡 - 修复版
 * 关键修复：使用实际supplyPos并确保连接到转弯弧切点
 */

import { 
  BeamPosition, 
  RouteSegment, 
  MapPoint
} from '../types';
import { MapQuery } from '../core/mapQuery';
import { generateWaypointsWithYaw, distance } from '../utils';

export class SupplyToFirstTransit {
  private mapQuery: MapQuery;

  constructor(mapQuery: MapQuery) {
    this.mapQuery = mapQuery;
  }

  /**
   * 规划从补给站到第一梁位的过渡
   */
  plan(
    beam: BeamPosition, 
    supplyPos: MapPoint, 
    supplyHeading: number
  ): RouteSegment[] {
    console.log(`[SupplyToFirstTransit] 补给站 → ${beam.id}`);
    console.log(`[SupplyToFirstTransit] 补给站位置: (${supplyPos.x.toFixed(2)}, ${supplyPos.y.toFixed(2)})`);
    
    const segments: RouteSegment[] = [];
    const corners = this.mapQuery.getBeamCorners(beam);

    // 1. 找到补给站所在的道路（通常是南道路）
    const southRoadId = beam.boundaries.south;
    const southRoad = this.mapQuery.getRoad(southRoadId);
    if (!southRoad) {
      console.warn('[SupplyToFirstTransit] 找不到南道路，使用直线');
      return [this.createTransitSegment(supplyPos, corners.sw, supplyHeading)];
    }

    // 2. 找到西南角弧线
    const swInterId = beam.corner_intersections[0];
    const swInter = this.mapQuery.getIntersection(swInterId);
    if (!swInter) {
      console.warn('[SupplyToFirstTransit] 找不到西南交叉点');
      return [this.createTransitSegment(supplyPos, corners.sw, supplyHeading)];
    }

    // 3. 查找西南角弧线（西→北方向）
    const swArcInfo = this.mapQuery.findArcForTurn(swInter, 'west', 'north');
    if (!swArcInfo) {
      console.warn('[SupplyToFirstTransit] 找不到西南角弧线');
      return [this.createTransitSegment(supplyPos, corners.sw, supplyHeading)];
    }

    // 4. 获取弧线的切点
    // 正向：tp[0]是入口（西边界），tp[1]是出口（北方向）
    // 反向：tp[1]是入口（南边界），tp[0]是出口（西边界）
    const arcEntryTangent = swArcInfo.reverse
      ? swArcInfo.arc.tangent_points[1]  // 反向：入口在南边界
      : swArcInfo.arc.tangent_points[0];   // 正向：入口在西边界
    
    const arcExitTangent = swArcInfo.reverse
      ? swArcInfo.arc.tangent_points[0]   // 反向：出口在西边界
      : swArcInfo.arc.tangent_points[1];  // 正向：出口在北方向

    console.log(`[SupplyToFirstTransit] 弧线入口: (${arcEntryTangent.x.toFixed(2)}, ${arcEntryTangent.y.toFixed(2)})`);
    console.log(`[SupplyToFirstTransit] 弧线出口: (${arcExitTangent.x.toFixed(2)}, ${arcExitTangent.y.toFixed(2)})`);

    // 5. 从补给站到弧线入口
    const supplyToEntry = distance(supplyPos, arcEntryTangent);
    console.log(`[SupplyToFirstTransit] 补给站到弧线入口距离: ${supplyToEntry.toFixed(2)}m`);
    
    if (supplyToEntry > 0.5) {
      const roadPoints = this.mapQuery.getRoadSegmentBetweenPoints(southRoadId, supplyPos, arcEntryTangent);
      if (roadPoints && roadPoints.length >= 2) {
        // 确保方向正确：第一个点接近supplyPos
        const firstDist = distance(roadPoints[0], supplyPos);
        const lastDist = distance(roadPoints[roadPoints.length - 1], supplyPos);
        if (firstDist > lastDist) {
          roadPoints.reverse();
        }
        // 确保第一个点是补给站位置
        roadPoints[0] = supplyPos;
        // 修剪最后一个点接近弧线入口
        roadPoints[roadPoints.length - 1] = arcEntryTangent;
        
        segments.push({
          id: '',
          type: 'transit',
          spray_mode: 'none',
          waypoints: generateWaypointsWithYaw(roadPoints)
        });
        console.log(`[SupplyToFirstTransit] 添加补给站到弧线入口段: ${roadPoints.length}点`);
      } else {
        // 如果找不到道路段，使用直线路由
        segments.push(this.createTransitSegment(supplyPos, arcEntryTangent, supplyHeading));
      }
    }

    // 6. 添加西南角弧线
    const arcSegment = this.createArcSegment(swArcInfo.arc, swArcInfo.reverse);
    segments.push(arcSegment);
    console.log(`[SupplyToFirstTransit] 添加西南角弧线，弧线出口位置: (${arcExitTangent.x.toFixed(2)}, ${arcExitTangent.y.toFixed(2)})`);

    // 7. 不再添加"弧线出口到西边界"的过渡段
    // 让ClockwiseCircuit直接从弧线出口位置开始，这样转弯弧线出口直接连接到西边界道路
    // 注意：需要将弧线出口位置传递给routeBuilder

    console.log(`[SupplyToFirstTransit] 生成${segments.length}个过渡段`);
    return segments;
  }

  /**
   * 创建过渡段
   */
  private createTransitSegment(from: MapPoint, to: MapPoint, fromYaw?: number): RouteSegment {
    const travelYaw = Math.atan2(to.y - from.y, to.x - from.x);
    const startYaw = fromYaw !== undefined ? fromYaw : travelYaw;

    return {
      id: '',
      type: 'transit',
      spray_mode: 'none',
      waypoints: [
        { x: from.x, y: from.y, yaw: startYaw },
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

    const waypoints = generateWaypointsWithYaw(points);

    return {
      id: '',
      type: 'turn_arc',
      arc_id: arc.id,
      spray_mode: 'none',
      waypoints,
      tangent_points: reverse 
        ? [arc.tangent_points[1], arc.tangent_points[0]]
        : [arc.tangent_points[0], arc.tangent_points[1]]
    };
  }
}