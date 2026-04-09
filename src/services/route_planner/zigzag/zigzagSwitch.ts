/**
 * S形切换 - 从当前梁位切换到下一个梁位
 * 同时切换绕行方向（顺时针<->逆时针）
 */

import { 
  BeamPosition, 
  RouteSegment, 
  MapPoint
} from '../types';
import { MapQuery } from '../core/mapQuery';
import { generateWaypointsWithYaw, distance } from '../utils';

export class ZigzagSwitch {
  private mapQuery: MapQuery;

  constructor(mapQuery: MapQuery) {
    this.mapQuery = mapQuery;
  }

  /**
   * 规划S形切换
   * @param currentBeam 当前梁位
   * @param nextBeam 下一个梁位
   * @param currentPos 当前位置
   * @param currentYaw 当前朝向
   * @param switchToClockwise 切换到顺时针（true）还是逆时针（false）
   */
  plan(
    currentBeam: BeamPosition,
    nextBeam: BeamPosition,
    currentPos: MapPoint,
    currentYaw: number,
    switchToClockwise: boolean
  ): RouteSegment[] {
    console.log(`[ZigzagSwitch] ${currentBeam.id} → ${nextBeam.id}, 切换到${switchToClockwise ? '顺时针' : '逆时针'}`);
    
    const segments: RouteSegment[] = [];
    const currentCorners = this.mapQuery.getBeamCorners(currentBeam);
    const nextCorners = this.mapQuery.getBeamCorners(nextBeam);

    // 当前梁位的东南角（如果是顺时针结束）或西南角（如果是逆时针结束）
    // 根据switchToClockwise判断：
    // - 切换到顺时针：从当前结束位置（可能是东南角）到下一个梁位的起始位置
    // - 切换到逆时针：从当前结束位置到下一个梁位的起始位置
    
    // 找到两个梁位共享的道路
    const sharedRoadId = this.findSharedRoad(currentBeam, nextBeam);
    
    if (sharedRoadId) {
      // 沿共享道路移动
      const sharedRoad = this.mapQuery.getRoad(sharedRoadId);
      if (sharedRoad) {
        // 从当前位置到共享道路的适当位置
        const roadPoints = this.mapQuery.getRoadSegmentBetweenPoints(
          sharedRoadId, 
          currentPos, 
          nextCorners.sw // 使用下一个梁位的西南角作为目标
        );
        
        if (roadPoints && roadPoints.length >= 2) {
          // 调整方向：从当前结束位置到目标
          const firstDist = distance(roadPoints[0], currentPos);
          const lastDist = distance(roadPoints[roadPoints.length - 1], currentPos);
          if (firstDist > lastDist) {
            roadPoints.reverse();
          }
          roadPoints[0] = currentPos;
          
          segments.push({
            id: '',
            type: 'transit',
            spray_mode: 'none',
            waypoints: generateWaypointsWithYaw(roadPoints)
          });
        }
      }
    } else {
      // 没有共享道路，使用直线路由
      segments.push({
        id: '',
        type: 'transit',
        spray_mode: 'none',
        waypoints: generateWaypointsWithYaw([currentPos, nextCorners.sw])
      });
    }

    console.log(`[ZigzagSwitch] 生成${segments.length}个切换段`);
    return segments;
  }

  /**
   * 找到两个梁位之间的共享道路
   */
  private findSharedRoad(beam1: BeamPosition, beam2: BeamPosition): string | null {
    const boundaries1 = beam1.boundaries;
    const boundaries2 = beam2.boundaries;

    // 检查东边界
    if (boundaries1.east === boundaries2.west) return boundaries1.east;
    if (boundaries1.west === boundaries2.east) return boundaries1.west;
    
    // 检查北边界
    if (boundaries1.north === boundaries2.south) return boundaries1.north;
    if (boundaries1.south === boundaries2.north) return boundaries1.south;

    return null;
  }
}