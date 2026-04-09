/**
 * S形反向返回 - 从最后一个梁位返回补给站
 * 在返回过程中，对于已喷淋的共享道路不再喷淋
 */

import { 
  BeamPosition, 
  RouteSegment, 
  MapPoint
} from '../types';
import { MapQuery } from '../core/mapQuery';
import { SprayStatusManager } from '../spray/sprayStatusManager';
import { generateWaypointsWithYaw, distance } from '../utils';

export class ZigzagReturn {
  private mapQuery: MapQuery;
  private sprayManager: SprayStatusManager;

  constructor(mapQuery: MapQuery, sprayManager: SprayStatusManager) {
    this.mapQuery = mapQuery;
    this.sprayManager = sprayManager;
  }

  /**
   * 规划S形返回
   * @param beams 所有梁位
   * @param supplyPos 补给站位置
   */
  plan(beams: BeamPosition[], supplyPos: MapPoint): RouteSegment[] {
    console.log(`[ZigzagReturn] 开始反向S返回`);
    
    const segments: RouteSegment[] = [];

    if (beams.length === 0) {
      return segments;
    }

    // 1. 从最后一个梁位当前位置开始
    const lastBeam = beams[beams.length - 1];
    const corners = this.mapQuery.getBeamCorners(lastBeam);
    let currentPos = corners.sw; // 默认从西南角开始

    // 2. 沿共享道路反向遍历
    // 从最后一个梁位（可能是奇数索引，逆时针结束）回到第一个梁位
    
    // 先沿南道路向西移动
    const southRoadId = lastBeam.boundaries.south;
    if (southRoadId) {
      // 检查道路是否已喷淋
      const isSprayed = this.sprayManager.isFullySprayed(southRoadId);
      const sprayMode = isSprayed ? 'none' : 'none'; // 返回过程不喷淋

      const roadPoints = this.mapQuery.getRoadSegmentBetweenPoints(southRoadId, currentPos, supplyPos);
      if (roadPoints && roadPoints.length >= 2) {
        const firstDist = distance(roadPoints[0], currentPos);
        const lastDist = distance(roadPoints[roadPoints.length - 1], currentPos);
        if (firstDist > lastDist) {
          roadPoints.reverse();
        }
        roadPoints[0] = currentPos;
        
        segments.push({
          id: '',
          type: 'transit',
          spray_mode: 'none', // 返回过程不喷淋
          waypoints: generateWaypointsWithYaw(roadPoints)
        });
      }
    }

    // 3. 直接返回补给站（如果南道路不足以到达）
    const lastPos = segments.length > 0 
      ? segments[segments.length - 1].waypoints[segments[segments.length - 1].waypoints.length - 1]
      : currentPos;
      
    const distToSupply = distance(lastPos, supplyPos);
    if (distToSupply > 1.0) {
      // 如果还有距离，添加最后的过渡段
      segments.push({
        id: '',
        type: 'transit',
        spray_mode: 'none',
        waypoints: generateWaypointsWithYaw([
          { x: lastPos.x, y: lastPos.y },
          supplyPos
        ])
      });
    }

    console.log(`[ZigzagReturn] 生成${segments.length}个返回段`);
    return segments;
  }

  /**
   * 检查道路是否已喷淋
   */
  private isRoadSprayed(roadId: string): boolean {
    return this.sprayManager.isFullySprayed(roadId);
  }
}