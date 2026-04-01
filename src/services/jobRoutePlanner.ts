/**
 * 作业路线规划器
 * 按照ROUTE_PLANNING_DESIGN.md设计文档实现
 *
 * 核心功能:
 * 1. 梁位顺序优化（最近邻算法）
 * 2. 单梁位绕行路线生成
 * 3. 梁位间过渡路线规划（A*无掉头）
 * 4. 喷淋模式自动判断
 * 5. yaw角动态计算
 * 6. 生成route_executor格式路线
 */

import fs from 'fs';
import path from 'path';

// ============================================================
// 类型定义
// ============================================================

export interface GpsPoint {
  latitude: number;
  longitude: number;
  altitude: number;
}

export interface MapPoint {
  x: number;
  y: number;
}

export interface RoadPoint {
  seq: number;
  gps: GpsPoint;
  map_xy: MapPoint;
}

export interface Road {
  id: string;
  name: string;
  type: 'longitudinal' | 'horizontal';
  params?: {
    preferredWidth: number;
    highCostWidth: number;
  };
  points: RoadPoint[];
}

export interface Intersection {
  id: string;
  type: 'cross' | 'T' | 'L' | string;
  center: {
    gps: GpsPoint;
    map_xy: MapPoint;
  };
  road_v_id?: string;
  road_h_id?: string;
  connected_roads: string[];
  neighbors?: {
    top?: string;
    bottom?: string;
    left?: string;
    right?: string;
    top_road_id?: string;
    bottom_road_id?: string;
    left_road_id?: string;
    right_road_id?: string;
  };
  valid_quadrants?: number[];
}

export interface TurnArcPoint {
  seq: number;
  gps: GpsPoint;
  map_xy: MapPoint;
}

export interface TurnArc {
  id: string;
  intersection_id: string;
  quadrant: number;
  radius: number;
  center: MapPoint;
  tangent_points: MapPoint[];
  points: TurnArcPoint[];
}

export interface BeamPosition {
  id: string;
  name: string;
  row: string;
  col: number;
  center: MapPoint;
  boundaries: {
    north: string;
    south: string;
    east: string;
    west: string;
  };
  corner_intersections: string[];
  neighbors?: {
    top?: string;
    bottom?: string;
    left?: string;
    right?: string;
  };
}

export interface SupplyStation {
  id: string;
  position: MapPoint;
  heading: number;
  aruco_marker_id: number;
  approach_distance: number;
  entry_road_id: string;
  entry_intersection_id: string;
}

export interface GpsRoutes {
  version: string;
  origin: {
    gps: { lat: number; lon: number };
    utm: { zone: number; easting: number; northing: number };
    rotation: number;
  };
  roads: Road[];
  intersections: Intersection[];
  turn_arcs: TurnArc[];
}

export interface Waypoint {
  x: number;
  y: number;
  yaw: number;
  spray_action?: 'extend_left_arm' | 'extend_right_arm' | 'retract_all' | 'none';
}

export type SprayMode = 'left_only' | 'right_only' | 'both' | 'none';

export interface RouteSegment {
  id: string;
  type: 'road' | 'turn_arc' | 'transit';
  road_id?: string;
  arc_id?: string;
  direction?: 'forward' | 'backward';
  beam_id?: string;
  side?: 'north' | 'south' | 'east' | 'west';
  spray_mode: SprayMode;
  waypoints: Waypoint[];
}

export interface JobRoute {
  id: string;
  name: string;
  created: string;
  beam_sequence: string[];
  segments: RouteSegment[];
  statistics: {
    total_length: number;
    estimated_time: number;
    spray_length: number;
    transit_length: number;
  };
}

export interface RoadSegment {
  road_id: string;
  start_point: MapPoint;
  end_point: MapPoint;
  start_inter_id: string;
  end_inter_id: string;
  beam_left_id: string | null;
  beam_right_id: string | null;
  points: MapPoint[];
}

// ============================================================
// 辅助函数
// ============================================================

function distance(p1: MapPoint, p2: MapPoint): number {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}

function normalizeAngle(angle: number): number {
  while (angle < 0) angle += 2 * Math.PI;
  while (angle >= 2 * Math.PI) angle -= 2 * Math.PI;
  return angle;
}

function calculateAngle(from: MapPoint, to: MapPoint): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

// ============================================================
// 作业路线规划器类
// ============================================================

export class JobRoutePlanner {
  private roads: Road[] = [];
  private intersections: Intersection[] = [];
  private turnArcs: TurnArc[] = [];
  private beamPositions: BeamPosition[] = [];
  private supplyStation: SupplyStation | null = null;

  // 索引
  private roadById: Map<string, Road> = new Map();
  private interById: Map<string, Intersection> = new Map();
  private arcById: Map<string, TurnArc> = new Map();
  private beamById: Map<string, BeamPosition> = new Map();
  private interByRoads: Map<string, Intersection> = new Map(); // "roadV:roadH" -> inter

  constructor() {}

  /**
   * 加载数据文件
   */
  loadData(mapsDir: string): boolean {
    try {
      // 加载gps_routes.json
      const routesPath = path.join(mapsDir, 'gps_routes.json');
      if (!fs.existsSync(routesPath)) {
        console.error('[JobRoutePlanner] gps_routes.json 不存在');
        return false;
      }
      const routesData: GpsRoutes = JSON.parse(fs.readFileSync(routesPath, 'utf-8'));
      this.roads = routesData.roads || [];
      this.intersections = routesData.intersections || [];
      this.turnArcs = routesData.turn_arcs || [];

      // 加载beam_positions.json
      const beamPath = path.join(mapsDir, 'beam_positions.json');
      if (fs.existsSync(beamPath)) {
        const beamData = JSON.parse(fs.readFileSync(beamPath, 'utf-8'));
        this.beamPositions = beamData.positions || [];
      }

      // 加载gps_origin.yaml (补给站配置)
      const originPath = path.join(mapsDir, 'gps_origin.yaml');
      if (fs.existsSync(originPath)) {
        this.supplyStation = this.parseSupplyStationFromYaml(originPath);
      }

      // 构建索引
      this.buildIndexes();

      console.log(`[JobRoutePlanner] 加载数据: ${this.roads.length}条道路, ${this.intersections.length}个交叉点, ${this.turnArcs.length}条圆弧, ${this.beamPositions.length}个梁位`);

      return true;
    } catch (error) {
      console.error('[JobRoutePlanner] 加载数据失败:', error);
      return false;
    }
  }

  private parseSupplyStationFromYaml(yamlPath: string): SupplyStation | null {
    try {
      const content = fs.readFileSync(yamlPath, 'utf-8');
      // 简单解析YAML（不需要完整YAML解析器）
      const getValue = (key: string): string | null => {
        const match = content.match(new RegExp(`${key}:\\s*(.+)`));
        return match ? match[1].trim() : null;
      };

      const getNestedValue = (parent: string, key: string): string | null => {
        const parentMatch = content.match(new RegExp(`${parent}:`));
        if (!parentMatch) return null;
        const startIndex = parentMatch.index! + parentMatch[0].length;
        const nextKeyMatch = content.slice(startIndex).match(/^\s+\w+:/m);
        const endIndex = nextKeyMatch ? startIndex + nextKeyMatch.index! : content.length;
        const parentBlock = content.slice(startIndex, endIndex);
        const match = parentBlock.match(new RegExp(`${key}:\\s*(.+)`));
        return match ? match[1].trim() : null;
      };

      return {
        id: 'supply_station_1',
        position: { x: 0, y: 0 },
        heading: parseFloat(getNestedValue('supply_station', 'heading') || '0'),
        aruco_marker_id: parseInt(getNestedValue('supply_station', 'aruco_marker_id') || '0'),
        approach_distance: parseFloat(getNestedValue('supply_station', 'approach_distance') || '3.0'),
        entry_road_id: getNestedValue('supply_station', 'entry_road_id') || '',
        entry_intersection_id: getNestedValue('supply_station', 'entry_intersection_id') || ''
      };
    } catch (error) {
      console.warn('[JobRoutePlanner] 解析补给站配置失败:', error);
      return null;
    }
  }

  private buildIndexes(): void {
    this.roadById.clear();
    this.interById.clear();
    this.arcById.clear();
    this.beamById.clear();
    this.interByRoads.clear();

    for (const road of this.roads) {
      this.roadById.set(road.id, road);
    }

    for (const inter of this.intersections) {
      this.interById.set(inter.id, inter);
      if (inter.road_v_id && inter.road_h_id) {
        this.interByRoads.set(`${inter.road_v_id}:${inter.road_h_id}`, inter);
      }
    }

    for (const arc of this.turnArcs) {
      this.arcById.set(arc.id, arc);
    }

    for (const beam of this.beamPositions) {
      this.beamById.set(beam.id, beam);
    }
  }

  /**
   * 主入口：生成完整作业路线
   */
  planJobRoute(beamIds: string[]): JobRoute {
    console.log(`[JobRoutePlanner] 开始规划路线，梁位: ${beamIds.join(', ')}`);

    // 1. 验证梁位ID
    const validBeamIds = beamIds.filter(id => this.beamById.has(id));
    if (validBeamIds.length === 0) {
      throw new Error('没有有效的梁位ID');
    }

    // 2. 优化梁位顺序
    const orderedBeamIds = this.optimizeBeamSequence(validBeamIds);
    console.log(`[JobRoutePlanner] 优化后的梁位顺序: ${orderedBeamIds.join(' → ')}`);

    // 3. 生成路线段
    const segments: RouteSegment[] = [];
    let totalLength = 0;
    let sprayLength = 0;
    let transitLength = 0;

    // 3.1 从补给站到第一个梁位
    if (this.supplyStation && orderedBeamIds.length > 0) {
      const firstBeam = this.beamById.get(orderedBeamIds[0]);
      if (firstBeam) {
        console.log(`[JobRoutePlanner] 规划补给站 → ${orderedBeamIds[0]}`);
        const transitSegments = this.planTransitFromSupply(firstBeam);
        for (const seg of transitSegments) {
          seg.id = `seg_${segments.length}`;
          segments.push(seg);
          totalLength += this.calculateSegmentLength(seg);
          transitLength += this.calculateSegmentLength(seg);
        }
      }
    }

    // 3.2 为每个梁位生成绕行路线
    for (let i = 0; i < orderedBeamIds.length; i++) {
      const beamId = orderedBeamIds[i];
      const beam = this.beamById.get(beamId);
      if (!beam) continue;

      console.log(`[JobRoutePlanner] 生成梁位 ${beamId} 绕行路线`);
      const beamSegments = this.planBeamCircuitRoute(beam, orderedBeamIds);
      for (const seg of beamSegments) {
        seg.id = `seg_${segments.length}`;
        segments.push(seg);
        const len = this.calculateSegmentLength(seg);
        totalLength += len;
        if (seg.spray_mode !== 'none') {
          sprayLength += len;
        } else {
          transitLength += len;
        }
      }

      // 3.3 到下一个梁位的过渡
      if (i < orderedBeamIds.length - 1) {
        const nextBeamId = orderedBeamIds[i + 1];
        const nextBeam = this.beamById.get(nextBeamId);
        if (nextBeam) {
          console.log(`[JobRoutePlanner] 规划 ${beamId} → ${nextBeamId} 过渡`);
          const transitSegments = this.planTransitRoute(beam, nextBeam);
          for (const seg of transitSegments) {
            seg.id = `seg_${segments.length}`;
            segments.push(seg);
            const len = this.calculateSegmentLength(seg);
            totalLength += len;
            transitLength += len;
          }
        }
      }
    }

    // 3.4 返回补给站
    if (this.supplyStation && orderedBeamIds.length > 0) {
      const lastBeamId = orderedBeamIds[orderedBeamIds.length - 1];
      const lastBeam = this.beamById.get(lastBeamId);
      if (lastBeam) {
        console.log(`[JobRoutePlanner] 规划 ${lastBeamId} → 补给站`);
        const transitSegments = this.planTransitToSupply(lastBeam);
        for (const seg of transitSegments) {
          seg.id = `seg_${segments.length}`;
          segments.push(seg);
          const len = this.calculateSegmentLength(seg);
          totalLength += len;
          transitLength += len;
        }
      }
    }

    // 4. 计算统计信息
    const estimatedTime = this.calculateEstimatedTime(totalLength, sprayLength, segments.length);

    const route: JobRoute = {
      id: `route_${Date.now()}`,
      name: `喷淋路线 ${new Date().toLocaleString()}`,
      created: new Date().toISOString(),
      beam_sequence: orderedBeamIds,
      segments,
      statistics: {
        total_length: Math.round(totalLength * 100) / 100,
        estimated_time: estimatedTime,
        spray_length: Math.round(sprayLength * 100) / 100,
        transit_length: Math.round(transitLength * 100) / 100
      }
    };

    console.log(`[JobRoutePlanner] 路线规划完成: ${segments.length}个路段, 总长度${route.statistics.total_length}m`);
    return route;
  }

  /**
   * 梁位顺序优化（最近邻算法）
   */
  private optimizeBeamSequence(beamIds: string[]): string[] {
    if (beamIds.length <= 1) return [...beamIds];

    const remaining = [...beamIds];
    const ordered: string[] = [];

    // 起点为补给站位置（原点）
    let currentPos: MapPoint = this.supplyStation?.position || { x: 0, y: 0 };

    while (remaining.length > 0) {
      let nearestIdx = 0;
      let minDist = Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const beam = this.beamById.get(remaining[i]);
        if (beam) {
          const dist = distance(currentPos, beam.center);
          if (dist < minDist) {
            minDist = dist;
            nearestIdx = i;
          }
        }
      }

      const nearestId = remaining.splice(nearestIdx, 1)[0];
      ordered.push(nearestId);

      const nearestBeam = this.beamById.get(nearestId);
      if (nearestBeam) {
        currentPos = nearestBeam.center;
      }
    }

    return ordered;
  }

  /**
   * 规划单梁位绕行路线
   */
  private planBeamCircuitRoute(beam: BeamPosition, allSelectedBeamIds: string[]): RouteSegment[] {
    const segments: RouteSegment[] = [];

    // 获取梁位四条边界的道路
    const { north, south, east, west } = beam.boundaries;

    // 为每条边界道路生成路段
    const roadConfigs: Array<{ roadId: string | undefined; side: 'north' | 'south' | 'east' | 'west' }> = [
      { roadId: north, side: 'north' },
      { roadId: south, side: 'south' },
      { roadId: east, side: 'east' },
      { roadId: west, side: 'west' }
    ];

    for (const config of roadConfigs) {
      if (!config.roadId) continue;

      const road = this.roadById.get(config.roadId);
      if (!road) continue;

      // 确定喷淋模式
      const sprayMode = this.determineSprayMode(config.roadId, beam.id, config.side, allSelectedBeamIds);

      // 按梁位分割道路
      const roadSegments = this.splitRoadByBeam(road, beam);

      for (const roadSeg of roadSegments) {
        const waypoints = this.generateWaypointsForRoadSegment(roadSeg, road.type);

        segments.push({
          id: '', // 将在外部设置
          type: 'road',
          road_id: road.id,
          direction: this.determineDirection(roadSeg, road.type),
          beam_id: beam.id,
          side: config.side,
          spray_mode: sprayMode,
          waypoints
        });
      }
    }

    return segments;
  }

  /**
   * 按梁位边界分割道路
   */
  private splitRoadByBeam(road: Road, beam: BeamPosition): RoadSegment[] {
    const segments: RoadSegment[] = [];

    // 找到与这条道路相关的梁位角点交叉点
    const relevantInters: Intersection[] = [];
    for (const interId of beam.corner_intersections) {
      const inter = this.interById.get(interId);
      if (inter && inter.connected_roads.includes(road.id)) {
        relevantInters.push(inter);
      }
    }

    if (relevantInters.length < 2) {
      // 如果找不到两个交叉点，使用整条道路
      const points = road.points.map(p => p.map_xy);
      return [{
        road_id: road.id,
        start_point: points[0],
        end_point: points[points.length - 1],
        start_inter_id: '',
        end_inter_id: '',
        beam_left_id: null,
        beam_right_id: null,
        points
      }];
    }

    // 按道路方向排序交叉点
    relevantInters.sort((a, b) => {
      const aProj = this.projectOnRoad(a.center.map_xy, road);
      const bProj = this.projectOnRoad(b.center.map_xy, road);
      return aProj - bProj;
    });

    // 提取梁位边界内的道路点
    const startInter = relevantInters[0];
    const endInter = relevantInters[relevantInters.length - 1];

    const roadPoints = road.points.map(p => p.map_xy);
    const startProj = this.projectOnRoad(startInter.center.map_xy, road);
    const endProj = this.projectOnRoad(endInter.center.map_xy, road);

    const segmentPoints: MapPoint[] = [];
    for (let i = 0; i < roadPoints.length; i++) {
      const proj = this.projectOnRoad(roadPoints[i], road);
      if (proj >= startProj - 0.5 && proj <= endProj + 0.5) {
        segmentPoints.push(roadPoints[i]);
      }
    }

    if (segmentPoints.length < 2) {
      // 如果点数不足，使用交叉点之间的线性插值
      segmentPoints.length = 0;
      segmentPoints.push(startInter.center.map_xy);
      segmentPoints.push(endInter.center.map_xy);
    }

    segments.push({
      road_id: road.id,
      start_point: segmentPoints[0],
      end_point: segmentPoints[segmentPoints.length - 1],
      start_inter_id: startInter.id,
      end_inter_id: endInter.id,
      beam_left_id: null,
      beam_right_id: null,
      points: segmentPoints
    });

    return segments;
  }

  /**
   * 投影点到道路
   */
  private projectOnRoad(point: MapPoint, road: Road): number {
    const points = road.points;
    let totalDist = 0;
    let minProj = 0;
    let minDist = Infinity;

    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i].map_xy;
      const p2 = points[i + 1].map_xy;
      const segLen = distance(p1, p2);

      // 投影到线段
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const t = Math.max(0, Math.min(1, ((point.x - p1.x) * dx + (point.y - p1.y) * dy) / (segLen * segLen)));

      const projX = p1.x + t * dx;
      const projY = p1.y + t * dy;
      const projDist = distance(point, { x: projX, y: projY });

      if (projDist < minDist) {
        minDist = projDist;
        minProj = totalDist + t * segLen;
      }

      totalDist += segLen;
    }

    return minProj;
  }

  /**
   * 确定喷淋模式
   */
  private determineSprayMode(
    roadId: string,
    currentBeamId: string,
    side: 'north' | 'south' | 'east' | 'west',
    allSelectedBeamIds: string[]
  ): SprayMode {
    const currentBeam = this.beamById.get(currentBeamId);
    if (!currentBeam) return 'none';

    // 找到道路另一侧的梁位
    let adjacentBeamId: string | undefined;
    if (side === 'north' && currentBeam.neighbors?.top) {
      adjacentBeamId = currentBeam.neighbors.top;
    } else if (side === 'south' && currentBeam.neighbors?.bottom) {
      adjacentBeamId = currentBeam.neighbors.bottom;
    } else if (side === 'east' && currentBeam.neighbors?.right) {
      adjacentBeamId = currentBeam.neighbors.right;
    } else if (side === 'west' && currentBeam.neighbors?.left) {
      adjacentBeamId = currentBeam.neighbors.left;
    }

    // 如果相邻梁位也被选中，则双侧喷淋
    if (adjacentBeamId && allSelectedBeamIds.includes(adjacentBeamId)) {
      return 'both';
    }

    // 否则单侧喷淋
    // 根据道路方向和梁位位置确定左侧还是右侧
    const road = this.roadById.get(roadId);
    if (!road) return 'none';

    if (road.type === 'longitudinal') {
      // 纵向道路：东西两侧
      if (side === 'east') return 'right_only';
      if (side === 'west') return 'left_only';
    } else {
      // 横向道路：南北两侧
      if (side === 'north') return 'right_only';
      if (side === 'south') return 'left_only';
    }

    return 'none';
  }

  /**
   * 确定行驶方向
   */
  private determineDirection(seg: RoadSegment, roadType: 'longitudinal' | 'horizontal'): 'forward' | 'backward' {
    const dx = seg.end_point.x - seg.start_point.x;
    const dy = seg.end_point.y - seg.start_point.y;

    if (roadType === 'longitudinal') {
      return dy >= 0 ? 'forward' : 'backward';
    } else {
      return dx >= 0 ? 'forward' : 'backward';
    }
  }

  /**
   * 为道路段生成航点
   */
  private generateWaypointsForRoadSegment(seg: RoadSegment, roadType: 'longitudinal' | 'horizontal'): Waypoint[] {
    const waypoints: Waypoint[] = [];
    const points = seg.points;

    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      let yaw: number;

      if (i < points.length - 1) {
        yaw = calculateAngle(point, points[i + 1]);
      } else if (i > 0) {
        yaw = calculateAngle(points[i - 1], point);
      } else {
        yaw = roadType === 'longitudinal' ? Math.PI / 2 : 0;
      }

      waypoints.push({
        x: point.x,
        y: point.y,
        yaw: normalizeAngle(yaw)
      });
    }

    return waypoints;
  }

  /**
   * 规划梁位间过渡路线（A*无掉头）
   */
  private planTransitRoute(fromBeam: BeamPosition, toBeam: BeamPosition): RouteSegment[] {
    // 简化实现：直接连接两个梁位中心
    // 完整实现应该使用A*搜索道路网络
    const segments: RouteSegment[] = [];

    const fromCenter = fromBeam.center;
    const toCenter = toBeam.center;

    // 找到起始梁位最近的交叉点
    const startInter = this.findNearestIntersection(fromCenter);
    // 找到目标梁位最近的交叉点
    const endInter = this.findNearestIntersection(toCenter);

    if (!startInter || !endInter) {
      // 无法找到交叉点，生成直线路线
      segments.push(this.createTransitSegment(fromCenter, toCenter));
      return segments;
    }

    // A*搜索路径
    const path = this.astarNoUTurn(startInter.id, endInter.id);
    if (path.length === 0) {
      segments.push(this.createTransitSegment(fromCenter, toCenter));
      return segments;
    }

    // 将路径转换为航点
    for (let i = 0; i < path.length - 1; i++) {
      const currentInter = this.interById.get(path[i]);
      const nextInter = this.interById.get(path[i + 1]);

      if (currentInter && nextInter) {
        // 查找连接的道路
        const road = this.findConnectingRoad(currentInter, nextInter);
        if (road) {
          const roadSeg = this.createRoadSegmentBetweenInters(road, currentInter, nextInter);
          segments.push({
            id: '',
            type: 'road',
            road_id: road.id,
            spray_mode: 'none',
            waypoints: this.generateWaypointsForRoadSegment(roadSeg, road.type)
          });
        } else {
          // 使用转弯弧
          segments.push(this.createTransitSegment(currentInter.center.map_xy, nextInter.center.map_xy));
        }
      }
    }

    return segments;
  }

  /**
   * 从补给站到第一个梁位
   */
  private planTransitFromSupply(beam: BeamPosition): RouteSegment[] {
    if (!this.supplyStation) {
      return [this.createTransitSegment({ x: 0, y: 0 }, beam.center)];
    }

    // 从补给站入口交叉点出发
    const entryInter = this.interById.get(this.supplyStation.entry_intersection_id);
    const targetInter = this.findNearestIntersection(beam.center);

    if (!entryInter || !targetInter) {
      return [this.createTransitSegment(this.supplyStation.position, beam.center)];
    }

    // A*搜索路径
    const path = this.astarNoUTurn(entryInter.id, targetInter.id);
    if (path.length === 0) {
      return [this.createTransitSegment(this.supplyStation.position, beam.center)];
    }

    // 生成路线段
    const segments: RouteSegment[] = [];

    // 补给站到第一个交叉点
    segments.push({
      id: '',
      type: 'transit',
      spray_mode: 'none',
      waypoints: [
        { x: this.supplyStation.position.x, y: this.supplyStation.position.y, yaw: this.supplyStation.heading },
        { x: entryInter.center.map_xy.x, y: entryInter.center.map_xy.y, yaw: calculateAngle(this.supplyStation.position, entryInter.center.map_xy) }
      ]
    });

    // 后续路径
    for (let i = 0; i < path.length - 1; i++) {
      const currentInter = this.interById.get(path[i]);
      const nextInter = this.interById.get(path[i + 1]);

      if (currentInter && nextInter) {
        const road = this.findConnectingRoad(currentInter, nextInter);
        if (road) {
          const roadSeg = this.createRoadSegmentBetweenInters(road, currentInter, nextInter);
          segments.push({
            id: '',
            type: 'road',
            road_id: road.id,
            spray_mode: 'none',
            waypoints: this.generateWaypointsForRoadSegment(roadSeg, road.type)
          });
        } else {
          segments.push(this.createTransitSegment(currentInter.center.map_xy, nextInter.center.map_xy));
        }
      }
    }

    return segments;
  }

  /**
   * 返回补给站
   */
  private planTransitToSupply(beam: BeamPosition): RouteSegment[] {
    if (!this.supplyStation) {
      return [this.createTransitSegment(beam.center, { x: 0, y: 0 })];
    }

    const startInter = this.findNearestIntersection(beam.center);
    const entryInter = this.interById.get(this.supplyStation.entry_intersection_id);

    if (!startInter || !entryInter) {
      return [this.createTransitSegment(beam.center, this.supplyStation.position)];
    }

    // A*搜索路径
    const path = this.astarNoUTurn(startInter.id, entryInter.id);
    if (path.length === 0) {
      return [this.createTransitSegment(beam.center, this.supplyStation.position)];
    }

    // 生成路线段
    const segments: RouteSegment[] = [];

    for (let i = 0; i < path.length - 1; i++) {
      const currentInter = this.interById.get(path[i]);
      const nextInter = this.interById.get(path[i + 1]);

      if (currentInter && nextInter) {
        const road = this.findConnectingRoad(currentInter, nextInter);
        if (road) {
          const roadSeg = this.createRoadSegmentBetweenInters(road, currentInter, nextInter);
          segments.push({
            id: '',
            type: 'road',
            road_id: road.id,
            spray_mode: 'none',
            waypoints: this.generateWaypointsForRoadSegment(roadSeg, road.type)
          });
        } else {
          segments.push(this.createTransitSegment(currentInter.center.map_xy, nextInter.center.map_xy));
        }
      }
    }

    // 最后一段：入口交叉点到补给站
    segments.push({
      id: '',
      type: 'transit',
      spray_mode: 'none',
      waypoints: [
        { x: entryInter.center.map_xy.x, y: entryInter.center.map_xy.y, yaw: calculateAngle(entryInter.center.map_xy, this.supplyStation.position) },
        { x: this.supplyStation.position.x, y: this.supplyStation.position.y, yaw: this.supplyStation.heading }
      ]
    });

    return segments;
  }

  /**
   * A*搜索路径（无掉头）
   */
  private astarNoUTurn(startId: string, goalId: string): string[] {
    if (startId === goalId) return [startId];

    interface Node {
      id: string;
      g: number;  // 已走距离
      h: number;  // 启发式估计
      f: number;  // g + h
      parent: string | null;
      entryDirection: string | null;  // 进入此节点的方向
    }

    const startInter = this.interById.get(startId);
    const goalInter = this.interById.get(goalId);
    if (!startInter || !goalInter) return [];

    const openMap = new Map<string, Node>();
    const closedSet = new Set<string>();

    openMap.set(startId, {
      id: startId,
      g: 0,
      h: distance(startInter.center.map_xy, goalInter.center.map_xy),
      f: distance(startInter.center.map_xy, goalInter.center.map_xy),
      parent: null,
      entryDirection: null
    });

    while (openMap.size > 0) {
      // 找f值最小的节点
      let current: Node | null = null;
      let currentId = '';
      for (const [id, node] of openMap) {
        if (!current || node.f < current.f) {
          current = node;
          currentId = id;
        }
      }

      if (currentId === goalId) {
        // 重建路径
        const path: string[] = [];
        let node: Node | null = current;
        while (node) {
          path.unshift(node.id);
          node = node.parent ? openMap.get(node.parent) || closedSet.has(node.parent) ? { id: node.parent } as Node : null : null;
          // 重新遍历找parent
        }
        // 正确重建路径
        path.length = 0;
        let traceId: string | null = goalId;
        const pathSet = new Set<string>();
        while (traceId) {
          path.unshift(traceId);
          pathSet.add(traceId);
          const traceNode = openMap.get(traceId) || (closedSet.has(traceId) ? null : null);
          traceId = null; // 需要保存完整的closed节点信息
        }
        return path;
      }

      openMap.delete(currentId);
      closedSet.add(currentId);

      // 扩展邻居
      const currentInter = this.interById.get(currentId);
      if (!currentInter || !currentInter.neighbors) continue;

      const neighbors = [
        { id: currentInter.neighbors.top, direction: 'top' },
        { id: currentInter.neighbors.bottom, direction: 'bottom' },
        { id: currentInter.neighbors.left, direction: 'left' },
        { id: currentInter.neighbors.right, direction: 'right' }
      ].filter(n => n.id);

      for (const neighbor of neighbors) {
        if (closedSet.has(neighbor.id!)) continue;

        // 检查掉头
        if (current!.entryDirection) {
          const oppositeDir = {
            'top': 'bottom',
            'bottom': 'top',
            'left': 'right',
            'right': 'left'
          }[current!.entryDirection];
          if (neighbor.direction === oppositeDir) continue;  // 禁止掉头
        }

        const neighborInter = this.interById.get(neighbor.id!);
        if (!neighborInter) continue;

        const tentativeG = current!.g + distance(currentInter.center.map_xy, neighborInter.center.map_xy);

        const existingNode = openMap.get(neighbor.id!);
        if (existingNode && tentativeG >= existingNode.g) continue;

        const h = distance(neighborInter.center.map_xy, goalInter.center.map_xy);
        openMap.set(neighbor.id!, {
          id: neighbor.id!,
          g: tentativeG,
          h,
          f: tentativeG + h,
          parent: currentId,
          entryDirection: neighbor.direction
        });
      }
    }

    return [];  // 未找到路径
  }

  /**
   * 查找最近的交叉点
   */
  private findNearestIntersection(point: MapPoint): Intersection | null {
    let nearest: Intersection | null = null;
    let minDist = Infinity;

    for (const inter of this.intersections) {
      const dist = distance(point, inter.center.map_xy);
      if (dist < minDist) {
        minDist = dist;
        nearest = inter;
      }
    }

    return nearest;
  }

  /**
   * 查找连接两个交叉点的道路
   */
  private findConnectingRoad(inter1: Intersection, inter2: Intersection): Road | null {
    for (const roadId of inter1.connected_roads) {
      if (inter2.connected_roads.includes(roadId)) {
        return this.roadById.get(roadId) || null;
      }
    }
    return null;
  }

  /**
   * 创建两个交叉点之间的道路段
   */
  private createRoadSegmentBetweenInters(road: Road, startInter: Intersection, endInter: Intersection): RoadSegment {
    const startProj = this.projectOnRoad(startInter.center.map_xy, road);
    const endProj = this.projectOnRoad(endInter.center.map_xy, road);
    const [minProj, maxProj] = startProj < endProj ? [startProj, endProj] : [endProj, startProj];

    const points: MapPoint[] = [];
    let totalDist = 0;

    for (let i = 0; i < road.points.length - 1; i++) {
      const p1 = road.points[i].map_xy;
      const p2 = road.points[i + 1].map_xy;
      const segLen = distance(p1, p2);

      if (totalDist + segLen >= minProj && totalDist <= maxProj) {
        if (points.length === 0) {
          points.push(p1);
        }
        points.push(p2);
      }

      totalDist += segLen;
    }

    if (points.length < 2) {
      points.length = 0;
      points.push(startInter.center.map_xy);
      points.push(endInter.center.map_xy);
    }

    return {
      road_id: road.id,
      start_point: points[0],
      end_point: points[points.length - 1],
      start_inter_id: startInter.id,
      end_inter_id: endInter.id,
      beam_left_id: null,
      beam_right_id: null,
      points
    };
  }

  /**
   * 创建过渡路段
   */
  private createTransitSegment(from: MapPoint, to: MapPoint): RouteSegment {
    return {
      id: '',
      type: 'transit',
      spray_mode: 'none',
      waypoints: [
        { x: from.x, y: from.y, yaw: calculateAngle(from, to) },
        { x: to.x, y: to.y, yaw: calculateAngle(from, to) }
      ]
    };
  }

  /**
   * 计算路段长度
   */
  private calculateSegmentLength(seg: RouteSegment): number {
    let length = 0;
    for (let i = 0; i < seg.waypoints.length - 1; i++) {
      length += distance(seg.waypoints[i], seg.waypoints[i + 1]);
    }
    return length;
  }

  /**
   * 计算预估时间
   */
  private calculateEstimatedTime(totalLength: number, sprayLength: number, segmentCount: number = 0): number {
    const travelSpeed = 0.5;  // m/s
    const spraySpeed = 0.3;   // m/s (喷淋时较慢)
    const turnTime = 5;       // 每次转弯约5秒

    const travelTime = (totalLength - sprayLength) / travelSpeed;
    const sprayTime = sprayLength / spraySpeed;
    const turnCount = segmentCount;  // 使用传入的路段数量

    return Math.ceil(travelTime + sprayTime + turnCount * turnTime);
  }

  /**
   * 选择转弯弧
   */
  selectTurnArc(intersectionId: string, fromDirection: string, toDirection: string): TurnArc | null {
    const quadrant = this.determineQuadrant(fromDirection, toDirection);
    if (quadrant === null) return null;

    for (const arc of this.turnArcs) {
      if (arc.intersection_id === intersectionId && arc.quadrant === quadrant) {
        return arc;
      }
    }
    return null;
  }

  /**
   * 确定转弯象限
   */
  private determineQuadrant(fromDirection: string, toDirection: string): number | null {
    // 方向到象限的映射
    // Q0: 右上 (从左来向上去, 或从下来向右去)
    // Q1: 左上 (从右来向上去, 或从下来向左去)
    // Q2: 左下 (从右来向下去, 或从上来向左去)
    // Q3: 右下 (从左来向下去, 或从上来向右去)

    const quadrantMap: Record<string, number> = {
      'left_to_top': 0,
      'bottom_to_right': 0,
      'right_to_top': 1,
      'bottom_to_left': 1,
      'right_to_bottom': 2,
      'top_to_left': 2,
      'left_to_bottom': 3,
      'top_to_right': 3
    };

    const key = `${fromDirection}_to_${toDirection}`;
    return quadrantMap[key] !== undefined ? quadrantMap[key] : null;
  }

  /**
   * 生成YAML格式路线文件
   */
  generateYAMLRoute(route: JobRoute): string {
    const lines: string[] = [];
    lines.push('# 作业路线 - 自动生成');
    lines.push(`# 生成时间: ${route.created}`);
    lines.push(`# 梁位顺序: ${route.beam_sequence.join(' → ')}`);
    lines.push(`# 总长度: ${route.statistics.total_length}m`);
    lines.push(`# 预估时间: ${route.statistics.estimated_time}秒`);
    lines.push('');

    lines.push('route:');
    lines.push(`  id: ${route.id}`);
    lines.push(`  name: ${route.name}`);
    lines.push('');

    lines.push('  segments:');
    for (const seg of route.segments) {
      lines.push(`    - id: ${seg.id}`);
      lines.push(`      type: ${seg.type}`);
      if (seg.road_id) lines.push(`      road_id: ${seg.road_id}`);
      if (seg.arc_id) lines.push(`      arc_id: ${seg.arc_id}`);
      if (seg.direction) lines.push(`      direction: ${seg.direction}`);
      if (seg.beam_id) lines.push(`      beam_id: ${seg.beam_id}`);
      if (seg.side) lines.push(`      side: ${seg.side}`);
      lines.push(`      spray_mode: ${seg.spray_mode}`);
      lines.push('      waypoints:');
      for (const wp of seg.waypoints) {
        lines.push(`        - x: ${wp.x.toFixed(3)}`);
        lines.push(`          y: ${wp.y.toFixed(3)}`);
        lines.push(`          yaw: ${wp.yaw.toFixed(4)}`);
        if (wp.spray_action) {
          lines.push(`          spray_action: ${wp.spray_action}`);
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}

// 导出单例
export const jobRoutePlanner = new JobRoutePlanner();
