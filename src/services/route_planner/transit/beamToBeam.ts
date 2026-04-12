/**
 * 梁位间过渡 - 修复版
 * 
 * 正确的过渡逻辑：
 * 1. 当前梁位绕行结束后，车头朝西（在西边界尽头）
 * 2. 不能倒车或掉头，只能继续前进
 * 3. 路径：西边界结束点 → 继续向西 → 通过弧线网络 → 到达下一个梁位西边界起点
 * 
 * 关键：必须沿着道路网络连续移动，不能跳跃
 */

import { 
  BeamPosition, 
  RouteSegment, 
  MapPoint
} from '../types';
import { MapQuery } from '../core/mapQuery';
import { generateWaypointsWithYaw, distance } from '../utils';

export class BeamToBeamTransit {
  private mapQuery: MapQuery;

  constructor(mapQuery: MapQuery) {
    this.mapQuery = mapQuery;
  }

  /**
   * 规划从当前梁位到下一个梁位的过渡
   * 
   * 情况分析：
   * - beam_AB_21 绕行结束后在 (-4.8, -1.1)，车头朝西 (yaw=4.5 ≈ 270°)
   * - 当前位置已经是西边界（south road的西端）
   * - 需要继续前进（不能倒车），沿着道路网络到达下一个梁位
   * 
   * 正确路径：
   * (-4.8, -1.1) 朝西 → 继续沿south road向西 → inter_A_2 → 
   * 找到弧线/道路继续 → west road → north road → inter_B_1 → 
   * 到达 beam_BC_21 西边界入口
   */
  plan(
    currentPos: MapPoint, 
    currentYaw: number,
    currentBeam: BeamPosition, 
    nextBeam: BeamPosition
  ): RouteSegment[] {
    console.log(`[BeamToBeamTransit] ${currentBeam.id} → ${nextBeam.id}`);
    console.log(`[BeamToBeamTransit] 当前位置: (${currentPos.x.toFixed(2)}, ${currentPos.y.toFixed(2)}), 朝向: ${currentYaw.toFixed(2)}`);
    
    const segments: RouteSegment[] = [];
    const currentCorners = this.mapQuery.getBeamCorners(currentBeam);
    const nextCorners = this.mapQuery.getBeamCorners(nextBeam);

    // 分析当前结束位置的方向
    // 当前在south road西端，朝向西
    // 需要继续向西（不倒车）
    
    // 1. 找到当前结束位置附近的交叉点（inter_A_2 在 -5.3, -1.2 附近）
    const currentSouthRoadId = currentBeam.boundaries.south;
    const westRoadId = currentBeam.boundaries.west;
    const northRoadId = currentBeam.boundaries.north;
    
    console.log(`[BeamToBeamTransit] 当前南道路: ${currentSouthRoadId}`);
    console.log(`[BeamToBeamTransit] 当前西道路: ${westRoadId}`);
    console.log(`[BeamToBeamTransit] 下一梁位西道路: ${nextBeam.boundaries.west}`);
    
    // 2. 从当前位置向西继续沿south road到inter_A_2
    const interA2 = this.mapQuery.getIntersection('inter_A_2');
    if (interA2) {
      const interA2Pos = interA2.center.map_xy;
      console.log(`[BeamToBeamTransit] inter_A_2位置: (${interA2Pos.x.toFixed(1)}, ${interA2Pos.y.toFixed(1)})`);
      
      // 从当前位置到inter_A_2
      const toInterA2 = this.mapQuery.getRoadSegmentBetweenPoints(currentSouthRoadId, currentPos, interA2Pos);
      console.log(`[BeamToBeamTransit] 搜索道路段: 从 (${currentPos.x.toFixed(1)}, ${currentPos.y.toFixed(1)}) 到 (${interA2Pos.x.toFixed(1)}, ${interA2Pos.y.toFixed(1)})`);
      console.log(`[BeamToBeamTransit] 道路段结果: ${toInterA2 ? toInterA2.length + '点' : 'null'}`);
      
        if (toInterA2 && toInterA2.length >= 2) {
          toInterA2[0] = currentPos;
          
          segments.push({
            id: '',
            type: 'road',
            road_id: currentSouthRoadId,
            spray_mode: 'none',
            waypoints: generateWaypointsWithYaw(toInterA2)
          });
          console.log(`[BeamToBeamTransit] 添加: ${currentSouthRoadId} → inter_A_2, 点数: ${toInterA2.length}`);
        
        // 3. 从inter_A_2通过弧线/道路到west road北端
        const interA1 = this.mapQuery.getIntersection('inter_A_1');
        if (interA1) {
          const interA1Pos = interA1.center.map_xy;
          console.log(`[BeamToBeamTransit] inter_A_1位置: (${interA1Pos.x.toFixed(1)}, ${interA1Pos.y.toFixed(1)})`);
          
          // 从inter_A_2沿west road向北到inter_A_1
          const toInterA1 = this.mapQuery.getRoadSegmentBetweenPoints(westRoadId, interA2Pos, interA1Pos);
          
          if (toInterA1 && toInterA1.length >= 2) {
            toInterA1[0] = interA2Pos;

            segments.push({
              id: '',
              type: 'road',
              road_id: westRoadId,
              spray_mode: 'none',
              waypoints: generateWaypointsWithYaw(toInterA1)
            });
            console.log(`[BeamToBeamTransit] 添加: ${westRoadId} → inter_A_1, 点数: ${toInterA1.length}`);

            // 添加圆弧：inter_A_2 → inter_A_1
            const arcA2A1 = this.findArcBetweenIntersections('inter_A_2', 'inter_A_1');
            if (arcA2A1) {
              const arcPoints = arcA2A1.tangent_points.map((p: any) => ({ x: p.map_xy.x, y: p.map_xy.y }));
              segments.push({
                id: '',
                type: 'turn_arc',
                arc_id: arcA2A1.id,
                spray_mode: 'none',
                waypoints: generateWaypointsWithYaw(arcPoints)
              });
              console.log(`[BeamToBeamTransit] 添加圆弧: ${arcA2A1.id}`);
            }
            
            // 4. 从inter_A_1沿north road向东到inter_B_1
            const interB1 = this.mapQuery.getIntersection('inter_B_1');
            if (interB1) {
              const interB1Pos = interB1.center.map_xy;
              console.log(`[BeamToBeamTransit] inter_B_1位置: (${interB1Pos.x.toFixed(1)}, ${interB1Pos.y.toFixed(1)})`);
              
              const toInterB1 = this.mapQuery.getRoadSegmentBetweenPoints(northRoadId, interA1Pos, interB1Pos);
              
              if (toInterB1 && toInterB1.length >= 2) {
                toInterB1[0] = interA1Pos;

                segments.push({
                  id: '',
                  type: 'road',
                  road_id: northRoadId,
                  spray_mode: 'none',
                  waypoints: generateWaypointsWithYaw(toInterB1)
                });
                console.log(`[BeamToBeamTransit] 添加: ${northRoadId} → inter_B_1, 点数: ${toInterB1.length}`);

                // 添加圆弧：inter_A_1 → inter_B_1
                const arcA1B1 = this.findArcBetweenIntersections('inter_A_1', 'inter_B_1');
                if (arcA1B1) {
                  const arcPoints = arcA1B1.tangent_points.map((p: any) => ({ x: p.map_xy.x, y: p.map_xy.y }));
                  segments.push({
                    id: '',
                    type: 'turn_arc',
                    arc_id: arcA1B1.id,
                    spray_mode: 'none',
                    waypoints: generateWaypointsWithYaw(arcPoints)
                  });
                  console.log(`[BeamToBeamTransit] 添加圆弧: ${arcA1B1.id}`);
                }
                
                // 5. 从inter_B_1到下一个梁位的西边界入口
                // beam_BC_21的西边界入口应该在inter_B_2附近
                const nextWestArcId = this.findWestEntryArc(nextBeam);
                if (nextWestArcId) {
                  const arc = this.mapQuery.getTurnArc(nextWestArcId);
                  if (arc) {
                    const arcEntry = arc.tangent_points[0];
                    console.log(`[BeamToBeamTransit] 下一梁位西边界弧线入口: (${arcEntry.x.toFixed(1)}, ${arcEntry.y.toFixed(1)})`);
                    
                    // 从inter_B_1到弧线入口
                    // 可能需要通过一段道路
                    const nextWestRoadId = nextBeam.boundaries.west;
                    const toArcEntry = this.mapQuery.getRoadSegmentBetweenPoints(nextWestRoadId, interB1Pos, arcEntry);
                    
                    if (toArcEntry && toArcEntry.length >= 2) {
                      toArcEntry[0] = interB1Pos;
                      segments.push({
                        id: '',
                        type: 'road',
                        road_id: nextWestRoadId,
                        spray_mode: 'none',
                        waypoints: generateWaypointsWithYaw(toArcEntry)
                      });
                      console.log(`[BeamToBeamTransit] 添加: ${nextWestRoadId} → 西边界入口, 点数: ${toArcEntry.length}`);
                    }
                  }
                }
              }
            }
          }
        }
      } else {
        console.warn('[BeamToBeamTransit] 无法找到从当前位置到inter_A_2的道路');
      }
    }

    if (segments.length === 0) {
      // Fallback: 直线过渡
      console.warn('[BeamToBeamTransit] 无法规划路径，使用直线过渡');
      const nextStart = this.findNextBeamStartPoint(nextBeam);
      segments.push(this.createTransitSegment(currentPos, nextStart, currentYaw));
    }

    console.log(`[BeamToBeamTransit] 生成${segments.length}个过渡段`);
    return segments;
  }

  /**
   * 找到下一个梁位的西边界入口弧线
   */
  private findWestEntryArc(beam: BeamPosition): string | null {
    if (beam.corner_intersections && beam.corner_intersections.length > 0) {
      const swInterId = beam.corner_intersections[0]; // SW corner
      const inter = this.mapQuery.getIntersection(swInterId);
      if (inter) {
        const allArcs = this.mapQuery.getAllArcs();
        const relevantArcs = allArcs.filter(a => a.intersection_id === inter.id);
        
        for (const arc of relevantArcs) {
          const entry = arc.tangent_points[0];
          if (Math.abs(entry.x - 9.3) < 1.5 && Math.abs(entry.y - 6.0) < 1.5) {
            return arc.id;
          }
        }
      }
    }
    return null;
  }

  /**
   * 查找两个交叉点之间的圆弧
   */
  private findArcBetweenIntersections(fromInterId: string, toInterId: string): any | null {
    const allArcs = this.mapQuery.getAllArcs();
    const fromInter = this.mapQuery.getIntersection(fromInterId);
    const toInter = this.mapQuery.getIntersection(toInterId);
    
    if (!fromInter || !toInter) return null;

    for (const arc of allArcs) {
      if (arc.intersection_id === fromInterId) {
        const tangent = arc.tangent_points;
        if (tangent && tangent.length >= 2) {
          const endPoint = tangent[tangent.length - 1];
          if (Math.abs(endPoint.x - toInter.center.map_xy.x) < 2 && 
              Math.abs(endPoint.y - toInter.center.map_xy.y) < 2) {
            return arc;
          }
        }
      }
    }
    return null;
  }

  /**
   * 找到下一个梁位的实际起点
   */
  private findNextBeamStartPoint(beam: BeamPosition): MapPoint {
    return { x: beam.center.x - 3, y: beam.center.y };
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