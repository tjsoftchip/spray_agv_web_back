/**
 * 最后梁位返回补给站过渡
 */

import { 
  BeamPosition, 
  RouteSegment, 
  MapPoint
} from '../types';
import { MapQuery } from '../core/mapQuery';
import { generateWaypointsWithYaw, distance } from '../utils';

export class LastBeamToSupplyTransit {
  private mapQuery: MapQuery;

  constructor(mapQuery: MapQuery) {
    this.mapQuery = mapQuery;
  }

  /**
   * 规划从最后一个梁位返回补给站
   * @param lastBeam 最后梁位
   * @param supplyPos 补给站位置
   * @param currentPos 当前位置
   * @param currentYaw 当前朝向
   */
  plan(
    lastBeam: BeamPosition, 
    supplyPos: MapPoint, 
    currentPos: MapPoint, 
    currentYaw: number
  ): RouteSegment[] {
    console.log(`[LastBeamToSupplyTransit] ${lastBeam.id} → 补给站`);
    console.log(`[LastBeamToSupplyTransit] 当前位置: (${currentPos.x.toFixed(2)}, ${currentPos.y.toFixed(2)})`);
    
    const segments: RouteSegment[] = [];

    // 1. 找到南道路
    const southRoadId = lastBeam.boundaries.south;
    const southRoad = this.mapQuery.getRoad(southRoadId);
    if (!southRoad) {
      console.warn('[LastBeamToSupplyTransit] 找不到南道路');
      return [this.createTransitSegment(currentPos, supplyPos, currentYaw)];
    }

    // 2. 沿南道路向西到补给站
    const roadPoints = this.mapQuery.getRoadSegmentBetweenPoints(southRoadId, currentPos, supplyPos);
    if (roadPoints && roadPoints.length >= 2) {
      // 确保方向正确
      const firstDist = distance(roadPoints[0], currentPos);
      const lastDist = distance(roadPoints[roadPoints.length - 1], currentPos);
      if (firstDist > lastDist) {
        roadPoints.reverse();
      }
      
      // 替换起点和终点为精确位置
      roadPoints[0] = currentPos;
      roadPoints[roadPoints.length - 1] = supplyPos;
      
      segments.push({
        id: '',
        type: 'transit',
        spray_mode: 'none',
        waypoints: generateWaypointsWithYaw(roadPoints)
      });
    } else {
      segments.push(this.createTransitSegment(currentPos, supplyPos, currentYaw));
    }

    console.log(`[LastBeamToSupplyTransit] 生成${segments.length}个过渡段`);
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
}