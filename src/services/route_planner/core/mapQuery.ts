/**
 * 地图查询工具 - 道路、交叉点、角点查询
 */

import { 
  Road, 
  Intersection, 
  TurnArc, 
  BeamPosition,
  MapPoint,
  RoadSegment,
  BeamCorners,
  BoundaryEndpoints
} from '../types';
import { 
  distance, 
  inferDirection, 
  projectOnRoad, 
  orderRoadPoints,
  getOppositeDirection,
  getTurnQuadrant
} from '../utils';
import { CORNER_INDEX } from '../constants';

export class MapQuery {
  private roads: Map<string, Road> = new Map();
  private intersections: Map<string, Intersection> = new Map();
  private turnArcs: Map<string, TurnArc> = new Map();
  private beams: Map<string, BeamPosition> = new Map();

  /**
   * 初始化数据
   */
  initialize(
    roads: Road[], 
    intersections: Intersection[], 
    turnArcs: TurnArc[],
    beams: BeamPosition[]
  ): void {
    this.roads.clear();
    this.intersections.clear();
    this.turnArcs.clear();
    this.beams.clear();

    for (const road of roads) {
      this.roads.set(road.id, road);
    }
    for (const inter of intersections) {
      this.intersections.set(inter.id, inter);
    }
    for (const arc of turnArcs) {
      this.turnArcs.set(arc.id, arc);
    }
    for (const beam of beams) {
      this.beams.set(beam.id, beam);
    }
  }

  /**
   * 获取道路
   */
  getRoad(roadId: string): Road | undefined {
    return this.roads.get(roadId);
  }

  /**
   * 获取交叉点
   */
  getIntersection(interId: string): Intersection | undefined {
    return this.intersections.get(interId);
  }

  /**
   * 获取转弯弧
   */
  getTurnArc(arcId: string): TurnArc | undefined {
    return this.turnArcs.get(arcId);
  }

  /**
   * 获取所有转弯弧
   */
  getAllArcs(): TurnArc[] {
    return Array.from(this.turnArcs.values());
  }

  /**
   * 获取梁位
   */
  getBeam(beamId: string): BeamPosition | undefined {
    return this.beams.get(beamId);
  }

  /**
   * 获取梁位四个角点
   */
  getBeamCorners(beam: BeamPosition): BeamCorners {
    const corners: BeamCorners = { nw: { x: 0, y: 0 }, ne: { x: 0, y: 0 }, sw: { x: 0, y: 0 }, se: { x: 0, y: 0 } };

    const interIds = beam.corner_intersections;
    if (interIds && interIds.length >= 4) {
      const swInter = this.intersections.get(interIds[0]);
      const seInter = this.intersections.get(interIds[1]);
      const nwInter = this.intersections.get(interIds[2]);
      const neInter = this.intersections.get(interIds[3]);

      if (swInter) corners.sw = swInter.center.map_xy;
      if (seInter) corners.se = seInter.center.map_xy;
      if (nwInter) corners.nw = nwInter.center.map_xy;
      if (neInter) corners.ne = neInter.center.map_xy;
    }

    return corners;
  }

  /**
   * 找到离点最近的交叉点
   */
  findNearestIntersection(point: MapPoint): Intersection | null {
    let nearest: Intersection | null = null;
    let minDist = Infinity;

    for (const inter of this.intersections.values()) {
      const dist = distance(point, inter.center.map_xy);
      if (dist < minDist) {
        minDist = dist;
        nearest = inter;
      }
    }

    return nearest;
  }

  /**
   * 找到离点最近的道路
   */
  findNearestRoad(point: MapPoint): Road | null {
    let nearestRoad: Road | null = null;
    let minDist = Infinity;

    for (const road of this.roads.values()) {
      for (const roadPoint of road.points) {
        const dist = distance(point, roadPoint.map_xy);
        if (dist < minDist) {
          minDist = dist;
          nearestRoad = road;
        }
      }
    }

    return nearestRoad;
  }

  /**
   * 获取梁位边界内的道路段
   */
  getBeamBoundarySegment(road: Road, beam: BeamPosition): RoadSegment | null {
    const relevantInters: Intersection[] = [];
    
    for (const interId of beam.corner_intersections) {
      const inter = this.intersections.get(interId);
      if (inter && inter.connected_roads.includes(road.id)) {
        relevantInters.push(inter);
      }
    }

    if (relevantInters.length < 2) {
      console.warn(`[MapQuery] 道路 ${road.id} 只找到 ${relevantInters.length} 个交叉点，使用整条道路`);
      const points = road.points.map(p => p.map_xy);
      return {
        road_id: road.id,
        start_point: points[0],
        end_point: points[points.length - 1],
        start_inter_id: relevantInters[0]?.id || '',
        end_inter_id: relevantInters[relevantInters.length - 1]?.id || '',
        beam_left_id: null,
        beam_right_id: null,
        points
      };
    }

    // 按道路方向排序
    relevantInters.sort((a, b) => {
      const aProj = projectOnRoad(a.center.map_xy, road.points);
      const bProj = projectOnRoad(b.center.map_xy, road.points);
      return aProj - bProj;
    });

    const startInter = relevantInters[0];
    const endInter = relevantInters[relevantInters.length - 1];

    const roadPoints = road.points.map(p => p.map_xy);
    const startProj = projectOnRoad(startInter.center.map_xy, road.points);
    const endProj = projectOnRoad(endInter.center.map_xy, road.points);

    const segmentPoints: MapPoint[] = [];
    for (let i = 0; i < roadPoints.length; i++) {
      const proj = projectOnRoad(roadPoints[i], road.points);
      if (proj >= startProj - 0.5 && proj <= endProj + 0.5) {
        segmentPoints.push(roadPoints[i]);
      }
    }

    if (segmentPoints.length < 2) {
      segmentPoints.length = 0;
      segmentPoints.push(startInter.center.map_xy);
      segmentPoints.push(endInter.center.map_xy);
    }

    return {
      road_id: road.id,
      start_point: segmentPoints[0],
      end_point: segmentPoints[segmentPoints.length - 1],
      start_inter_id: startInter.id,
      end_inter_id: endInter.id,
      beam_left_id: null,
      beam_right_id: null,
      points: segmentPoints
    };
  }

  /**
   * 获取边界起止点（基于顺时针方向）
   */
  getBoundaryEndpoints(
    boundary: 'west' | 'north' | 'east' | 'south',
    direction: 'forward' | 'backward',
    roadSegment: RoadSegment,
    corners: BeamCorners
  ): BoundaryEndpoints {
    let startPoint: MapPoint, endPoint: MapPoint;
    let startCorner: string, endCorner: string;

    switch (boundary) {
      case 'west':
        startPoint = corners.sw;
        endPoint = corners.nw;
        startCorner = 'SW';
        endCorner = 'NW';
        break;
      case 'north':
        startPoint = corners.nw;
        endPoint = corners.ne;
        startCorner = 'NW';
        endCorner = 'NE';
        break;
      case 'east':
        startPoint = corners.ne;
        endPoint = corners.se;
        startCorner = 'NE';
        endCorner = 'SE';
        break;
      case 'south':
        startPoint = corners.se;
        endPoint = corners.sw;
        startCorner = 'SE';
        endCorner = 'SW';
        break;
    }

    // 查找对应的交叉点
    const startInter = this.findCornerIntersection(startCorner);
    const endInter = this.findCornerIntersection(endCorner);

    return { startPoint, endPoint, startInter, endInter };
  }

  /**
   * 根据角点名称查找交叉点
   */
  private findCornerIntersection(corner: string): Intersection | null {
    // 需要传入梁位信息，这里先返回null，由调用者传入梁位
    return null;
  }

  /**
   * 查找特定转弯方向的弧线
   */
  findArcForTurn(
    inter: Intersection,
    fromDir: 'north' | 'south' | 'east' | 'west',
    toDir: 'north' | 'south' | 'east' | 'west',
    allowReverse: boolean = true
  ): { arc: TurnArc; reverse: boolean } | null {
    const expectedEntryDir = getOppositeDirection(fromDir);
    const expectedExitDir = toDir;

    for (const arc of this.turnArcs.values()) {
      if (arc.intersection_id !== inter.id) continue;
      if (arc.tangent_points.length < 2) continue;

      const tp0 = arc.tangent_points[0];
      const tp1 = arc.tangent_points[1];
      const interCenter = inter.center.map_xy;

      const dir0 = inferDirection(interCenter, tp0);
      const dir1 = inferDirection(interCenter, tp1);

      // 正向：tp0是入口，tp1是出口
      if (dir0 === expectedEntryDir && dir1 === expectedExitDir) {
        return { arc, reverse: false };
      }
      // 反向：tp1是入口，tp0是出口
      if (allowReverse && dir1 === expectedEntryDir && dir0 === expectedExitDir) {
        return { arc, reverse: true };
      }
    }

    return null;
  }

  /**
   * 获取道路上两点之间的路段
   */
  getRoadSegmentBetweenPoints(roadId: string, from: MapPoint, to: MapPoint): MapPoint[] | null {
    const road = this.roads.get(roadId);
    if (!road) return null;

    const roadPoints = road.points.map(p => p.map_xy);
    
    // 找到最接近from和to的道路点索引
    let fromIdx = 0, toIdx = roadPoints.length - 1;
    let minFromDist = Infinity, minToDist = Infinity;

    for (let i = 0; i < roadPoints.length; i++) {
      const dFrom = distance(roadPoints[i], from);
      if (dFrom < minFromDist) { minFromDist = dFrom; fromIdx = i; }
      const dTo = distance(roadPoints[i], to);
      if (dTo < minToDist) { minToDist = dTo; toIdx = i; }
    }

    console.log(`[MapQuery] getRoadSegment: fromIdx=${fromIdx}, toIdx=${toIdx}, fromDist=${minFromDist.toFixed(2)}, toDist=${minToDist.toFixed(2)}`);

    // 如果起点和终点在道路上的最近点是同一个，说明它们之间没有有效的道路段
    if (fromIdx === toIdx) {
      // 尝试：直接返回从当前位置到最近道路点的路径
      console.log(`[MapQuery] Warning: from and to map to same road point, trying direct path`);
      
      // 返回从当前位置到目标点最近道路点的直接路径
      const closestToTo = roadPoints[toIdx];
      return [from, closestToTo];
    }

    // 确保方向正确
    let points: MapPoint[];
    if (fromIdx <= toIdx) {
      points = roadPoints.slice(fromIdx, toIdx + 1);
    } else {
      points = roadPoints.slice(toIdx, fromIdx + 1).reverse();
    }

    return points.length >= 2 ? points : null;
  }

  /**
   * 获取两个交叉点之间的道路段
   */
  getRoadSegmentBetweenIntersections(inter1: Intersection, inter2: Intersection, road: Road): { points: MapPoint[] } | null {
    const proj1 = projectOnRoad(inter1.center.map_xy, road.points);
    const proj2 = projectOnRoad(inter2.center.map_xy, road.points);

    const roadPoints = road.points.map(p => p.map_xy);

    const segmentPoints: MapPoint[] = [];
    const minProj = Math.min(proj1, proj2);
    const maxProj = Math.max(proj1, proj2);

    for (const rp of roadPoints) {
      const proj = projectOnRoad(rp, road.points);
      if (proj >= minProj - 1.0 && proj <= maxProj + 1.0) {
        segmentPoints.push(rp);
      }
    }

    // 确保方向正确：从inter1到inter2
    if (segmentPoints.length >= 2) {
      const distFirstToInter1 = distance(segmentPoints[0], inter1.center.map_xy);
      const distLastToInter1 = distance(segmentPoints[segmentPoints.length - 1], inter1.center.map_xy);
      if (distLastToInter1 < distFirstToInter1) {
        segmentPoints.reverse();
      }
    }

    if (segmentPoints.length < 2) {
      return { points: [inter1.center.map_xy, inter2.center.map_xy] };
    }

    return { points: segmentPoints };
  }

  /**
   * 找到离补给站最近的梁位边界，确定顺时针绕行的起始边界
   */
  findNearestBoundary(beam: BeamPosition, supplyPos: MapPoint): 'west' | 'north' | 'east' | 'south' {
    const corners = this.getBeamCorners(beam);

    const distSW = distance(supplyPos, corners.sw);
    const distNW = distance(supplyPos, corners.nw);
    const distSE = distance(supplyPos, corners.se);
    const distNE = distance(supplyPos, corners.ne);

    // 西南角最近 -> 从西边界开始
    if (distSW <= distNW && distSW <= distSE && distSW <= distNE) {
      return 'west';
    } else if (distNW <= distSE && distNW <= distNE) {
      return 'north';
    } else if (distNE <= distSE) {
      return 'east';
    } else {
      return 'south';
    }
  }

  /**
   * 找到离指定位置最近的边界入口点
   */
  findNearestBoundaryEntry(
    beam: BeamPosition, 
    pos: MapPoint
  ): { boundary: 'west' | 'north' | 'east' | 'south'; entryPoint: MapPoint; direction: string } {
    const corners = this.getBeamCorners(beam);
    
    const entries = [
      { boundary: 'west' as const, entryPoint: corners.sw, direction: 'north' },
      { boundary: 'north' as const, entryPoint: corners.nw, direction: 'east' },
      { boundary: 'east' as const, entryPoint: corners.ne, direction: 'south' },
      { boundary: 'south' as const, entryPoint: corners.se, direction: 'west' },
    ];

    let nearest = entries[0];
    let minDist = distance(pos, entries[0].entryPoint);

    for (const entry of entries) {
      const dist = distance(pos, entry.entryPoint);
      if (dist < minDist) {
        minDist = dist;
        nearest = entry;
      }
    }

    return nearest;
  }

  /**
   * 根据转弯方向计算象限
   */
  calculateTurnQuadrant(
    fromDir: 'north' | 'south' | 'east' | 'west',
    toDir: 'north' | 'south' | 'east' | 'west'
  ): number {
    return getTurnQuadrant(fromDir, toDir);
  }
}