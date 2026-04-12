/**
 * 连续梁位行规划器
 * 
 * 针对横排连续梁位生成完整喷淋路线：
 * 1. 西边界（最左梁西侧）→ 圆弧 →
 * 2. 北边界（所有梁北侧，从左到右）→ 圆弧 →
 * 3. 东边界（最右梁东侧）→ 圆弧 →
 * 4. 南边界（所有梁南侧，从右到左）→ 圆弧 →
 * 5. 共享中间道路（相邻梁位之间，双侧喷淋）
 */

import { 
  BeamPosition, 
  RouteSegment, 
  MapPoint,
  BeamLayout,
  CircuitConfig
} from './types';
import { MapQuery } from './core/mapQuery';
import { SprayStatusManager } from './spray/sprayStatusManager';
import { distance, generateWaypointsWithYaw } from './utils';
import { CLOCKWISE_TRAVEL_DIR, CORNER_INDEX } from './constants';

export class ContinuousRowPlanner {
  private mapQuery: MapQuery;
  private sprayManager: SprayStatusManager;

  constructor(mapQuery: MapQuery, sprayManager: SprayStatusManager) {
    this.mapQuery = mapQuery;
    this.sprayManager = sprayManager;
  }

  isApplicable(layout: BeamLayout): boolean {
    if (!layout.isSingleRow || layout.beams.length < 2) {
      return false;
    }
    const sorted = [...layout.beams].sort((a, b) => a.center.x - b.center.x);
    for (let i = 0; i < sorted.length - 1; i++) {
      const neighbors = layout.adjacencyMap.get(sorted[i].id) || [];
      if (!neighbors.includes(sorted[i + 1].id)) {
        return false;
      }
    }
    return true;
  }

  plan(
    beams: BeamPosition[],
    startPos: MapPoint,
    supplyHeading: number
  ): RouteSegment[] {
    const segments: RouteSegment[] = [];
    const rowBeams = [...beams].sort((a, b) => a.col - b.col);
    
    console.log(`[ContinuousRowPlanner] 规划连续梁位行，共 ${rowBeams.length} 个: ${rowBeams.map(b => b.id).join(' → ')}`);

    this.sprayManager.reset();
    this.sprayManager.setSelectedBeams(beams.map(b => b.id));

    const requirements = new Map<string, any>();
    for (const beam of beams) {
      for (const side of ['north', 'south', 'east', 'west'] as const) {
        const roadId = beam.boundaries[side];
        if (!roadId) continue;
        const sideDir = this.getSideDirection(side);
        if (!requirements.has(roadId)) {
          requirements.set(roadId, {
            roadId, type: 'single', beams: [beam.id],
            targetSides: new Set([sideDir]), completed: false
          });
        } else {
          const req = requirements.get(roadId);
          if (!req.beams.includes(beam.id)) req.beams.push(beam.id);
          req.targetSides.add(sideDir);
        }
      }
    }
    this.sprayManager.setRequirements(requirements);

    const leftmostBeam = rowBeams[0];
    const rightmostBeam = rowBeams[rowBeams.length - 1];

    // ===== 步骤1: 西边界 =====
    console.log(`[ContinuousRowPlanner] 步骤1: 西边界 - ${leftmostBeam.id}`);
    let pos = this.addBoundaryRoad(segments, leftmostBeam, 'west', startPos);
    console.log(`[ContinuousRowPlanner]   西边界结束: (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)})`);

    // 西→北 转弯弧
    pos = this.addTurnArc(segments, leftmostBeam, 'west', 'north', pos);

    // ===== 步骤2: 北边界（从左到右连续喷淋）=====
    console.log(`[ContinuousRowPlanner] 步骤2: 北边界`);
    for (let i = 0; i < rowBeams.length; i++) {
      const beam = rowBeams[i];
      pos = this.addBoundaryRoad(segments, beam, 'north', pos);
      console.log(`[ContinuousRowPlanner]   ${beam.id} 北边界结束: (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)})`);

      if (i < rowBeams.length - 1) {
        // 北边界两梁之间不需要转弯弧，道路连续
      }
    }

    // 北→东 转弯弧
    pos = this.addTurnArc(segments, rightmostBeam, 'north', 'east', pos);

    // ===== 步骤3: 东边界 =====
    console.log(`[ContinuousRowPlanner] 步骤3: 东边界 - ${rightmostBeam.id}`);
    pos = this.addBoundaryRoad(segments, rightmostBeam, 'east', pos);
    console.log(`[ContinuousRowPlanner]   东边界结束: (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)})`);

    // 东→南 转弯弧
    pos = this.addTurnArc(segments, rightmostBeam, 'east', 'south', pos);

    // ===== 步骤4: 南边界（从右到左连续喷淋）=====
    console.log(`[ContinuousRowPlanner] 步骤4: 南边界`);
    const reversedBeams = [...rowBeams].reverse();
    for (let i = 0; i < reversedBeams.length; i++) {
      const beam = reversedBeams[i];
      pos = this.addBoundaryRoad(segments, beam, 'south', pos);
      console.log(`[ContinuousRowPlanner]   ${beam.id} 南边界结束: (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)})`);
    }

    // ===== 步骤5: 共享中间道路（双侧喷淋）=====
    // 相邻梁位之间的共享边界（beam_A.east = beam_B.west）
    // 这些道路需要从南边界结束后走过去，双侧喷淋
    console.log(`[ContinuousRowPlanner] 步骤5: 共享中间道路`);
    const sharedRoads = this.findSharedRoads(rowBeams);
    if (sharedRoads.length > 0) {
      for (const shared of sharedRoads) {
        // 南→共享道路 转弯弧
        pos = this.addTurnArcForSharedRoad(segments, shared, pos);
        pos = this.addSharedBoundaryRoad(segments, shared, pos);
        console.log(`[ContinuousRowPlanner]   共享道路 ${shared.roadId.slice(0,15)} 结束: (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)})`);
      }
    }

    // 重新分配路段ID
    segments.forEach((seg, idx) => {
      seg.id = `seg_${idx}`;
    });

    const optimizedLength = this.calculateTotalLength(segments);
    console.log(`[ContinuousRowPlanner] 优化完成: ${segments.length}个路段, ${optimizedLength.toFixed(2)}m`);
    return segments;
  }

  /**
   * 添加单条边界道路段，返回结束位置
   */
  private addBoundaryRoad(
    segments: RouteSegment[],
    beam: BeamPosition,
    side: 'north' | 'south' | 'east' | 'west',
    startPos: MapPoint
  ): MapPoint {
    const roadId = beam.boundaries[side];
    if (!roadId) return startPos;

    const road = this.mapQuery.getRoad(roadId);
    if (!road) return startPos;

    const roadSegment = this.mapQuery.getBeamBoundarySegment(road, beam);
    if (!roadSegment || roadSegment.points.length < 2) return startPos;

    const corners = this.mapQuery.getBeamCorners(beam);
    const { startPoint, endPoint } = this.getBoundaryEndpoints(side, corners);
    let roadPoints = this.orderRoadPoints(roadSegment.points, startPoint, endPoint);

    // 连接到起始位置：找最近点并替换
    if (segments.length === 0 || this.shouldConnectToStart(segments, startPos, roadPoints)) {
      let minDist = Number.MAX_VALUE;
      let nearestIdx = 0;
      for (let j = 0; j < Math.min(roadPoints.length, 20); j++) {
        const d = distance(roadPoints[j], startPos);
        if (d < minDist) { minDist = d; nearestIdx = j; }
      }
      roadPoints = roadPoints.slice(nearestIdx);
      if (roadPoints.length > 0 && minDist < 5.0) {
        roadPoints[0] = startPos;
      }
    }

    // 确保与上一段终点连续
    if (segments.length > 0) {
      const lastEnd = this.getSegmentEnd(segments[segments.length - 1]);
      if (lastEnd && roadPoints.length > 0) {
        const gap = distance(lastEnd, roadPoints[0]);
        if (gap > 0.01 && gap < 3.0) {
          roadPoints[0] = { x: lastEnd.x, y: lastEnd.y };
        }
      }
    }

    const travelDir = CLOCKWISE_TRAVEL_DIR[side];
    const sprayMode = this.sprayManager.getSprayMode(roadId, beam.id, travelDir);

    if (sprayMode !== 'none') {
      segments.push({
        id: `seg_${segments.length}`,
        type: 'road',
        road_id: roadId,
        direction: this.getRoadDirection(side, road),
        beam_id: beam.id,
        side: side,
        spray_mode: sprayMode,
        waypoints: generateWaypointsWithYaw(roadPoints)
      });

      const sides = sprayMode === 'both' ? 'both' : 'right';
      this.sprayManager.recordSpray(roadId, beam.id, sides as any);
      console.log(`[ContinuousRowPlanner]   ${beam.id} ${side}侧, 喷淋: ${sprayMode}, 点数: ${roadPoints.length}`);
    } else {
      console.log(`[ContinuousRowPlanner]   ${beam.id} ${side}侧 已喷淋，跳过`);
    }

    return roadPoints.length > 0 ? roadPoints[roadPoints.length - 1] : startPos;
  }

  /**
   * 添加边界之间的转弯弧，返回弧线结束位置
   */
  private addTurnArc(
    segments: RouteSegment[],
    beam: BeamPosition,
    fromBoundary: string,
    toBoundary: string,
    currentPos: MapPoint
  ): MapPoint {
    const fromDir = CLOCKWISE_TRAVEL_DIR[fromBoundary];
    const toDir = CLOCKWISE_TRAVEL_DIR[toBoundary];

    // 找到转弯角点对应的交叉点
    const toCorner = this.getCornerForBoundary(toBoundary);
    const cornerIdx = CORNER_INDEX[toCorner];
    const interId = beam.corner_intersections[cornerIdx];
    const inter = this.mapQuery.getIntersection(interId);

    if (!inter) {
      console.warn(`[ContinuousRowPlanner] 未找到 ${fromBoundary}→${toBoundary} 的交叉点`);
      return currentPos;
    }

    const arcInfo = this.mapQuery.findArcForTurn(inter, fromDir as any, toDir as any);

    if (!arcInfo) {
      console.warn(`[ContinuousRowPlanner] 未找到 ${fromBoundary}→${toBoundary} 的圆弧, inter=${interId}`);
      return currentPos;
    }

    const arc = arcInfo.arc;
    let arcPoints = arc.points.map((p: any) => ({ x: p.map_xy.x, y: p.map_xy.y }));
    if (arcInfo.reverse) {
      arcPoints = arcPoints.reverse();
    }

    // 确保弧线起点与上一段终点连续
    if (segments.length > 0 && arcPoints.length > 0) {
      const lastEnd = this.getSegmentEnd(segments[segments.length - 1]);
      if (lastEnd) {
        const gap = distance(lastEnd, arcPoints[0]);
        if (gap > 0.01 && gap < 3.0) {
          arcPoints[0] = { x: lastEnd.x, y: lastEnd.y };
        }
      }
    }

    segments.push({
      id: `seg_${segments.length}`,
      type: 'turn_arc',
      arc_id: arc.id,
      spray_mode: 'none',
      waypoints: generateWaypointsWithYaw(arcPoints)
    });

    console.log(`[ContinuousRowPlanner]   添加圆弧: ${arc.id} (${fromBoundary}→${toBoundary})`);
    return arcPoints[arcPoints.length - 1];
  }

  /**
   * 找到相邻梁位之间的共享道路
   */
  private findSharedRoads(beams: BeamPosition[]): Array<{
    roadId: string;
    leftBeam: BeamPosition;
    rightBeam: BeamPosition;
  }> {
    const shared: Array<{
      roadId: string;
      leftBeam: BeamPosition;
      rightBeam: BeamPosition;
    }> = [];

    for (let i = 0; i < beams.length - 1; i++) {
      const leftBeam = beams[i];
      const rightBeam = beams[i + 1];
      // beam_A.east === beam_B.west => 共享道路
      if (leftBeam.boundaries.east && leftBeam.boundaries.east === rightBeam.boundaries.west) {
        shared.push({
          roadId: leftBeam.boundaries.east,
          leftBeam,
          rightBeam
        });
        console.log(`[ContinuousRowPlanner]   发现共享道路: ${leftBeam.boundaries.east.slice(0,15)} (${leftBeam.id}.east = ${rightBeam.id}.west)`);
      }
    }
    return shared;
  }

  /**
   * 添加共享边界道路段（双侧喷淋），返回结束位置
   */
  private addSharedBoundaryRoad(
    segments: RouteSegment[],
    shared: { roadId: string; leftBeam: BeamPosition; rightBeam: BeamPosition },
    startPos: MapPoint
  ): MapPoint {
    const road = this.mapQuery.getRoad(shared.roadId);
    if (!road) return startPos;

    const roadSegment = this.mapQuery.getBeamBoundarySegment(road, shared.leftBeam);
    if (!roadSegment || roadSegment.points.length < 2) return startPos;

    // 共享道路是纵向道路（西侧道路），行驶方向从南到北
    const corners = this.mapQuery.getBeamCorners(shared.leftBeam);
    const rightCorners = this.mapQuery.getBeamCorners(shared.rightBeam);
    
    // 共享道路连接 leftBeam 的 NE/SE 角和 rightBeam 的 NW/SW 角
    // 从南到北行驶
    const southPoint = corners.se || corners.se;
    const northPoint = rightCorners.nw || rightCorners.nw;
    
    let roadPoints = this.orderRoadPoints(roadSegment.points, southPoint, northPoint);

    // 连接到起始位置
    let minDist = Number.MAX_VALUE;
    let nearestIdx = 0;
    for (let j = 0; j < Math.min(roadPoints.length, 20); j++) {
      const d = distance(roadPoints[j], startPos);
      if (d < minDist) { minDist = d; nearestIdx = j; }
    }
    roadPoints = roadPoints.slice(nearestIdx);
    if (roadPoints.length > 0 && minDist < 5.0) {
      roadPoints[0] = startPos;
    }

    // 确保与上一段终点连续
    if (segments.length > 0 && roadPoints.length > 0) {
      const lastEnd = this.getSegmentEnd(segments[segments.length - 1]);
      if (lastEnd) {
        const gap = distance(lastEnd, roadPoints[0]);
        if (gap > 0.01 && gap < 3.0) {
          roadPoints[0] = { x: lastEnd.x, y: lastEnd.y };
        }
      }
    }

    segments.push({
      id: `seg_${segments.length}`,
      type: 'road',
      road_id: shared.roadId,
      direction: this.getRoadDirection('east', road),
      beam_id: shared.leftBeam.id,
      side: 'east',
      spray_mode: 'both',
      waypoints: generateWaypointsWithYaw(roadPoints)
    });

    this.sprayManager.recordSpray(shared.roadId, shared.leftBeam.id, 'both');
    console.log(`[ContinuousRowPlanner]   共享道路 ${shared.roadId.slice(0,15)}, 双侧喷淋, 点数: ${roadPoints.length}`);

    return roadPoints.length > 0 ? roadPoints[roadPoints.length - 1] : startPos;
  }

  /**
   * 为共享道路添加转弯弧
   * 从南边界转向共享道路（纵向道路）
   */
  private addTurnArcForSharedRoad(
    segments: RouteSegment[],
    shared: { roadId: string; leftBeam: BeamPosition; rightBeam: BeamPosition },
    currentPos: MapPoint
  ): MapPoint {
    // 南边界结束后在西南角，需要向北转入共享道路
    // 使用 leftBeam 的 SE 角交叉点 (corner_intersections[1])
    const seCornerIdx = CORNER_INDEX.SE;
    const interId = shared.leftBeam.corner_intersections[seCornerIdx];
    const inter = this.mapQuery.getIntersection(interId);

    if (!inter) {
      console.warn(`[ContinuousRowPlanner] 未找到共享道路转弯交叉点`);
      return currentPos;
    }

    // 从西行(南边界结束方向)转向北行(共享道路方向)
    const arcInfo = this.mapQuery.findArcForTurn(inter, 'west' as any, 'north' as any);
    if (!arcInfo) {
      // 尝试反向
      const arcInfo2 = this.mapQuery.findArcForTurn(inter, 'east' as any, 'north' as any);
      if (!arcInfo2) {
        console.warn(`[ContinuousRowPlanner] 未找到共享道路转弯圆弧`);
        return currentPos;
      }
      return this.createArcSegment(segments, arcInfo2.arc, arcInfo2.reverse, currentPos);
    }

    return this.createArcSegment(segments, arcInfo.arc, arcInfo.reverse, currentPos);
  }

  /**
   * 创建弧线段并添加到segments
   */
  private createArcSegment(
    segments: RouteSegment[],
    arc: any,
    reverse: boolean,
    currentPos: MapPoint
  ): MapPoint {
    let arcPoints = arc.points.map((p: any) => ({ x: p.map_xy.x, y: p.map_xy.y }));
    if (reverse) {
      arcPoints = arcPoints.reverse();
    }

    // 确保与上一段终点连续
    if (segments.length > 0 && arcPoints.length > 0) {
      const lastEnd = this.getSegmentEnd(segments[segments.length - 1]);
      if (lastEnd) {
        const gap = distance(lastEnd, arcPoints[0]);
        if (gap > 0.01 && gap < 3.0) {
          arcPoints[0] = { x: lastEnd.x, y: lastEnd.y };
        }
      }
    }

    segments.push({
      id: `seg_${segments.length}`,
      type: 'turn_arc',
      arc_id: arc.id,
      spray_mode: 'none',
      waypoints: generateWaypointsWithYaw(arcPoints)
    });

    console.log(`[ContinuousRowPlanner]   添加圆弧: ${arc.id}`);
    return arcPoints[arcPoints.length - 1];
  }

  private shouldConnectToStart(segments: RouteSegment[], startPos: MapPoint, roadPoints: MapPoint[]): boolean {
    if (roadPoints.length === 0) return false;
    const dist = distance(startPos, roadPoints[0]);
    return dist < 10.0;
  }

  private getSegmentEnd(segment: RouteSegment): MapPoint | null {
    if (segment.waypoints.length === 0) return null;
    const last = segment.waypoints[segment.waypoints.length - 1];
    return { x: last.x, y: last.y };
  }

  private getSideDirection(side: string): string {
    switch (side) {
      case 'north': return 'right';
      case 'south': return 'left';
      case 'east': return 'right';
      case 'west': return 'left';
      default: return 'right';
    }
  }

  private getBoundaryEndpoints(boundary: string, corners: any): { startPoint: MapPoint; endPoint: MapPoint } {
    switch (boundary) {
      case 'west': return { startPoint: corners.sw, endPoint: corners.nw };
      case 'north': return { startPoint: corners.nw, endPoint: corners.ne };
      case 'east': return { startPoint: corners.ne, endPoint: corners.se };
      case 'south': return { startPoint: corners.se, endPoint: corners.sw };
    }
    return { startPoint: corners.sw, endPoint: corners.sw };
  }

  private orderRoadPoints(points: MapPoint[], startPoint: MapPoint, endPoint: MapPoint): MapPoint[] {
    if (points.length < 2) return points;
    const firstDistToStart = distance(points[0], startPoint);
    const firstDistToEnd = distance(points[0], endPoint);
    if (firstDistToStart > firstDistToEnd) {
      return [...points].reverse();
    }
    return [...points];
  }

  private getRoadDirection(boundary: string, road: any): 'forward' | 'backward' {
    const points = road.points;
    if (points.length < 2) return 'forward';
    const startPoint = points[0].map_xy;
    const endPoint = points[points.length - 1].map_xy;
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    if (boundary === 'north') return dx > 0 ? 'forward' : 'backward';
    if (boundary === 'south') return dx < 0 ? 'forward' : 'backward';
    if (boundary === 'west') return dy > 0 ? 'forward' : 'backward';
    return dy < 0 ? 'forward' : 'backward';
  }

  private getCornerForBoundary(boundary: string): string {
    switch (boundary) {
      case 'west': return 'SW';
      case 'north': return 'NW';
      case 'east': return 'NE';
      case 'south': return 'SE';
    }
    return 'SW';
  }

  private calculateTotalLength(segments: RouteSegment[]): number {
    let total = 0;
    for (const seg of segments) {
      for (let i = 1; i < seg.waypoints.length; i++) {
        total += distance(seg.waypoints[i - 1], seg.waypoints[i]);
      }
    }
    return total;
  }
}
