/**
 * 作业路线规划器
 * 按照 ROUTE_PLANNING_LOGIC.md 设计文档实现
 *
 * 核心功能:
 * 1. 梁位顺序优化（最近邻算法 + 分组优先）
 * 2. 单梁位顺时针绕行路线生成
 * 3. 共享路段喷淋状态管理
 * 4. 梁位间过渡路线规划
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
// 喷淋状态管理器
// ============================================================

interface SharedRoadInfo {
  roadId: string;
  beamIds: string[];
  sprayedSides: 'none' | 'left' | 'right' | 'both';
}

class SprayStatusManager {
  private roadStatus = new Map<string, SharedRoadInfo>();
  private sprayedRoads = new Set<string>();

  /**
   * 注册共享路段
   */
  registerSharedRoad(roadId: string, beamIds: string[]): void {
    if (!this.roadStatus.has(roadId)) {
      this.roadStatus.set(roadId, {
        roadId,
        beamIds,
        sprayedSides: 'none'
      });
    }
  }

  /**
   * 获取喷淋模式
   */
  getSprayMode(roadId: string, currentBeamId: string): SprayMode {
    const sharedInfo = this.roadStatus.get(roadId);

    if (!sharedInfo) {
      // 非共享路段，检查是否已喷淋
      if (this.sprayedRoads.has(roadId)) {
        return 'none';
      }
      this.sprayedRoads.add(roadId);
      return 'right_only';
    }

    // 共享路段
    switch (sharedInfo.sprayedSides) {
      case 'none':
        // 第一次访问，双侧喷淋
        sharedInfo.sprayedSides = 'both';
        this.sprayedRoads.add(roadId);
        return 'both';

      case 'both':
        // 已双侧喷淋，不喷淋
        return 'none';

      default:
        return 'none';
    }
  }

  /**
   * 标记道路已喷淋
   */
  markRoadSprayed(roadId: string): void {
    this.sprayedRoads.add(roadId);
  }

  /**
   * 检查道路是否已喷淋
   */
  isRoadSprayed(roadId: string): boolean {
    return this.sprayedRoads.has(roadId);
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.roadStatus.clear();
    this.sprayedRoads.clear();
  }
}

// ============================================================
// 梁位布局分析
// ============================================================

interface BeamLayout {
  beams: BeamPosition[];
  rowCount: number;
  columnCounts: number[];
  isSingleBeam: boolean;
  isSingleRow: boolean;
  isSingleColumn: boolean;
  isGrid: boolean;
  adjacencyMap: Map<string, string[]>;
  rows: Map<string, BeamPosition[]>;
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

/**
 * 根据行驶方向计算yaw角
 * yaw = 0 朝北, π/2 朝东, π 朝南, -π/2 朝西
 */
function directionToYaw(direction: 'north' | 'south' | 'east' | 'west'): number {
  switch (direction) {
    case 'north': return 0;
    case 'east': return Math.PI / 2;
    case 'south': return Math.PI;
    case 'west': return -Math.PI / 2;
  }
}

/**
 * 根据两点计算yaw角（转换为北向为0的坐标系）
 */
function calculateYawFromPoints(from: MapPoint, to: MapPoint): number {
  // atan2(dx, dy) 转换为北向坐标系
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.atan2(dx, dy);  // 北向为0，东向为π/2
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
  private interByRoads: Map<string, Intersection> = new Map();

  // 喷淋状态管理
  private sprayManager: SprayStatusManager;

  constructor() {
    this.sprayManager = new SprayStatusManager();
  }

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

    const beams = validBeamIds.map(id => this.beamById.get(id)!);

    // 2. 分析梁位布局
    const layout = this.analyzeLayout(beams);
    console.log(`[JobRoutePlanner] 布局分析: ${layout.rowCount}行, 单行=${layout.isSingleRow}, 单列=${layout.isSingleColumn}`);

    // 3. 确定梁位访问顺序
    const supplyPos = this.supplyStation?.position || { x: 0, y: 0 };
    const orderedBeams = this.optimizeBeamSequence(beams, supplyPos, layout);
    console.log(`[JobRoutePlanner] 访问顺序: ${orderedBeams.map(b => b.id).join(' → ')}`);

    // 4. 初始化喷淋状态管理器
    this.sprayManager.reset();
    this.registerSharedRoads(orderedBeams);

    // 5. 生成路线段
    const segments: RouteSegment[] = [];
    let totalLength = 0;
    let sprayLength = 0;
    let transitLength = 0;
    let currentPos = supplyPos;

    // 5.1 从补给站到第一个梁位
    if (orderedBeams.length > 0) {
      const firstBeam = orderedBeams[0];
      const startPoint = this.getCircuitStartPoint(firstBeam, supplyPos);

      console.log(`[JobRoutePlanner] 规划补给站 → ${firstBeam.id}`);
      const transitSegments = this.planTransitSegment(currentPos, startPoint);
      for (const seg of transitSegments) {
        seg.id = `seg_${segments.length}`;
        segments.push(seg);
        const len = this.calculateSegmentLength(seg);
        totalLength += len;
        transitLength += len;
      }
      currentPos = startPoint;
    }

    // 5.2 逐个梁位规划
    for (let i = 0; i < orderedBeams.length; i++) {
      const beam = orderedBeams[i];
      console.log(`[JobRoutePlanner] 生成梁位 ${beam.id} 顺时针绕行路线`);

      // 规划顺时针绕行
      const circuitSegments = this.planClockwiseCircuit(beam, currentPos);
      for (const seg of circuitSegments) {
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

      // 更新当前位置为绕行终点（西南角）
      currentPos = this.getCircuitEndPoint(beam);

      // 规划到下一个梁位的过渡
      if (i < orderedBeams.length - 1) {
        const nextBeam = orderedBeams[i + 1];
        const nextStartPoint = this.getCircuitStartPoint(nextBeam, currentPos);
        console.log(`[JobRoutePlanner] 规划过渡 ${beam.id} → ${nextBeam.id}`);

        const transitSegments = this.planTransitSegment(currentPos, nextStartPoint);
        for (const seg of transitSegments) {
          seg.id = `seg_${segments.length}`;
          segments.push(seg);
          const len = this.calculateSegmentLength(seg);
          totalLength += len;
          transitLength += len;
        }
        currentPos = nextStartPoint;
      }
    }

    // 5.3 返回补给站
    if (orderedBeams.length > 0) {
      console.log(`[JobRoutePlanner] 规划返回补给站`);
      const transitSegments = this.planTransitSegment(currentPos, supplyPos);
      for (const seg of transitSegments) {
        seg.id = `seg_${segments.length}`;
        segments.push(seg);
        const len = this.calculateSegmentLength(seg);
        totalLength += len;
        transitLength += len;
      }
    }

    // 6. 验证路线连续性
    this.validateRoute(segments);

    // 7. 计算统计信息
    const estimatedTime = this.calculateEstimatedTime(totalLength, sprayLength, segments.length);

    const route: JobRoute = {
      id: `route_${Date.now()}`,
      name: `喷淋路线 ${new Date().toLocaleString()}`,
      created: new Date().toISOString(),
      beam_sequence: orderedBeams.map(b => b.id),
      segments,
      statistics: {
        total_length: Math.round(totalLength * 100) / 100,
        estimated_time: estimatedTime,
        spray_length: Math.round(sprayLength * 100) / 100,
        transit_length: Math.round(transitLength * 100) / 100
      }
    };

    console.log(`[JobRoutePlanner] 路线规划完成: ${segments.length}个路段, 总长度${route.statistics.total_length}m, 喷淋${route.statistics.spray_length}m`);
    return route;
  }

  /**
   * 分析梁位布局
   */
  private analyzeLayout(beams: BeamPosition[]): BeamLayout {
    const rows = new Map<string, BeamPosition[]>();

    for (const beam of beams) {
      const rowKey = beam.row;
      if (!rows.has(rowKey)) {
        rows.set(rowKey, []);
      }
      rows.get(rowKey)!.push(beam);
    }

    // 每行内按列排序
    for (const [_, rowBeams] of rows) {
      rowBeams.sort((a, b) => a.col - b.col);
    }

    // 构建邻接关系
    const adjacencyMap = new Map<string, string[]>();
    for (const beam of beams) {
      const neighbors: string[] = [];
      if (beam.neighbors?.left && beams.some(b => b.id === beam.neighbors!.left)) {
        neighbors.push(beam.neighbors.left);
      }
      if (beam.neighbors?.right && beams.some(b => b.id === beam.neighbors!.right)) {
        neighbors.push(beam.neighbors.right);
      }
      if (beam.neighbors?.top && beams.some(b => b.id === beam.neighbors!.top)) {
        neighbors.push(beam.neighbors.top);
      }
      if (beam.neighbors?.bottom && beams.some(b => b.id === beam.neighbors!.bottom)) {
        neighbors.push(beam.neighbors.bottom);
      }
      adjacencyMap.set(beam.id, neighbors);
    }

    const columnCounts = Array.from(rows.values()).map(r => r.length);

    return {
      beams,
      rowCount: rows.size,
      columnCounts,
      isSingleBeam: beams.length === 1,
      isSingleRow: rows.size === 1 && beams.length > 1,
      isSingleColumn: beams.every(b => (rows.get(b.row)?.length ?? 0) === 1),
      isGrid: rows.size > 1 && columnCounts.every(c => c > 1),
      adjacencyMap,
      rows
    };
  }

  /**
   * 确定梁位访问顺序
   */
  private optimizeBeamSequence(
    beams: BeamPosition[],
    supplyStation: MapPoint,
    layout: BeamLayout
  ): BeamPosition[] {
    if (layout.isSingleBeam) {
      return beams;
    }

    if (layout.isSingleRow) {
      return this.optimizeSingleRow(beams, supplyStation);
    }

    if (layout.isSingleColumn) {
      return this.optimizeSingleColumn(beams, supplyStation);
    }

    // 多行多列：行优先策略
    return this.optimizeGrid(beams, supplyStation, layout);
  }

  /**
   * 单行优化：根据补给站位置决定遍历方向
   */
  private optimizeSingleRow(beams: BeamPosition[], supplyStation: MapPoint): BeamPosition[] {
    // 按列排序
    const sorted = [...beams].sort((a, b) => a.col - b.col);

    // 计算行中心
    const rowCenterY = beams[0].center.y;

    // 判断补给站在行左侧还是右侧
    const supplyX = supplyStation.x;
    const minX = Math.min(...beams.map(b => b.center.x));
    const maxX = Math.max(...beams.map(b => b.center.x));
    const supplyOnLeft = supplyX <= (minX + maxX) / 2;

    // 如果补给站在右侧，从右向左遍历
    if (supplyOnLeft) {
      return sorted;
    } else {
      return sorted.reverse();
    }
  }

  /**
   * 单列优化：从近到远
   */
  private optimizeSingleColumn(beams: BeamPosition[], supplyStation: MapPoint): BeamPosition[] {
    const supplyY = supplyStation.y;
    const sorted = [...beams].sort((a, b) => {
      const distA = Math.abs(a.center.y - supplyY);
      const distB = Math.abs(b.center.y - supplyY);
      return distA - distB;
    });
    return sorted;
  }

  /**
   * 多行多列优化：行优先策略
   */
  private optimizeGrid(
    beams: BeamPosition[],
    supplyStation: MapPoint,
    layout: BeamLayout
  ): BeamPosition[] {
    const rows = layout.rows;
    const ordered: BeamPosition[] = [];

    // 按行中心距离补给站的远近排序
    const sortedRows = Array.from(rows.entries())
      .sort((a, b) => {
        const centerA = this.getRowCenter(a[1]);
        const centerB = this.getRowCenter(b[1]);
        const distA = distance(centerA, supplyStation);
        const distB = distance(centerB, supplyStation);
        return distA - distB;
      });

    for (const [_, rowBeams] of sortedRows) {
      // 根据补给站位置决定行内遍历方向
      const direction = this.determineRowDirection(rowBeams, supplyStation);
      if (direction === 'east-to-west') {
        ordered.push(...[...rowBeams].reverse());
      } else {
        ordered.push(...rowBeams);
      }
    }

    return ordered;
  }

  private getRowCenter(rowBeams: BeamPosition[]): MapPoint {
    const sumX = rowBeams.reduce((sum, b) => sum + b.center.x, 0);
    const sumY = rowBeams.reduce((sum, b) => sum + b.center.y, 0);
    return { x: sumX / rowBeams.length, y: sumY / rowBeams.length };
  }

  private determineRowDirection(rowBeams: BeamPosition[], supplyStation: MapPoint): 'west-to-east' | 'east-to-west' {
    const minX = Math.min(...rowBeams.map(b => b.center.x));
    const maxX = Math.max(...rowBeams.map(b => b.center.x));
    const supplyX = supplyStation.x;

    return supplyX <= (minX + maxX) / 2 ? 'west-to-east' : 'east-to-west';
  }

  /**
   * 注册共享路段
   */
  private registerSharedRoads(beams: BeamPosition[]): void {
    for (const beam of beams) {
      // 检查每个边界的相邻梁位
      const neighbors = beam.neighbors || {};

      // 东边界（右侧相邻）
      if (neighbors.right && beams.some(b => b.id === neighbors.right)) {
        const sharedRoadId = beam.boundaries.east;
        this.sprayManager.registerSharedRoad(sharedRoadId, [beam.id, neighbors.right]);
      }

      // 西边界（左侧相邻）
      if (neighbors.left && beams.some(b => b.id === neighbors.left)) {
        const sharedRoadId = beam.boundaries.west;
        this.sprayManager.registerSharedRoad(sharedRoadId, [beam.id, neighbors.left]);
      }

      // 北边界（上方相邻）
      if (neighbors.top && beams.some(b => b.id === neighbors.top)) {
        const sharedRoadId = beam.boundaries.north;
        this.sprayManager.registerSharedRoad(sharedRoadId, [beam.id, neighbors.top]);
      }

      // 南边界（下方相邻）
      if (neighbors.bottom && beams.some(b => b.id === neighbors.bottom)) {
        const sharedRoadId = beam.boundaries.south;
        this.sprayManager.registerSharedRoad(sharedRoadId, [beam.id, neighbors.bottom]);
      }
    }
  }

  /**
   * 获取梁位绕行起点（西南角附近）
   */
  private getCircuitStartPoint(beam: BeamPosition, fromPos: MapPoint): MapPoint {
    // 根据补给站位置选择最近角落
    const corners = this.getBeamCorners(beam);

    let nearestCorner = corners.sw;
    let minDist = distance(fromPos, corners.sw);

    if (distance(fromPos, corners.nw) < minDist) {
      minDist = distance(fromPos, corners.nw);
      nearestCorner = corners.nw;
    }
    if (distance(fromPos, corners.ne) < minDist) {
      minDist = distance(fromPos, corners.ne);
      nearestCorner = corners.ne;
    }
    if (distance(fromPos, corners.se) < minDist) {
      nearestCorner = corners.se;
    }

    return nearestCorner;
  }

  /**
   * 获取梁位绕行终点（西南角）
   */
  private getCircuitEndPoint(beam: BeamPosition): MapPoint {
    const corners = this.getBeamCorners(beam);
    return corners.sw;
  }

  /**
   * 获取梁位四个角
   */
  private getBeamCorners(beam: BeamPosition): { nw: MapPoint; ne: MapPoint; sw: MapPoint; se: MapPoint } {
    const corners = { nw: { x: 0, y: 0 }, ne: { x: 0, y: 0 }, sw: { x: 0, y: 0 }, se: { x: 0, y: 0 } };

    // 从corner_intersections获取角点坐标
    const interIds = beam.corner_intersections;
    if (interIds && interIds.length >= 4) {
      // 假设顺序为：西北、东北、西南、东南
      const nwInter = this.interById.get(interIds[0]);
      const neInter = this.interById.get(interIds[1]);
      const swInter = this.interById.get(interIds[2]);
      const seInter = this.interById.get(interIds[3]);

      if (nwInter) corners.nw = nwInter.center.map_xy;
      if (neInter) corners.ne = neInter.center.map_xy;
      if (swInter) corners.sw = swInter.center.map_xy;
      if (seInter) corners.se = seInter.center.map_xy;
    }

    return corners;
  }

  /**
   * 规划顺时针绕行路线
   * 顺时针顺序：西(向北) → 北(向东) → 东(向南) → 南(向西)
   */
  private planClockwiseCircuit(beam: BeamPosition, startPos: MapPoint): RouteSegment[] {
    const segments: RouteSegment[] = [];

    // 确定起始边界
    const startBoundary = this.findNearestBoundary(beam, startPos);
    console.log(`[planClockwiseCircuit] 梁位 ${beam.id}, 起始边界: ${startBoundary}`);

    // 顺时针顺序
    const clockwiseOrder: Array<'west' | 'north' | 'east' | 'south'> = ['west', 'north', 'east', 'south'];
    const startIndex = clockwiseOrder.indexOf(startBoundary);
    const orderedBoundaries: Array<'west' | 'north' | 'east' | 'south'> = [];
    for (let i = 0; i < 4; i++) {
      orderedBoundaries.push(clockwiseOrder[(startIndex + i) % 4]);
    }

    console.log(`[planClockwiseCircuit] 绕行顺序: ${orderedBoundaries.join(' → ')}`);

    let lastEndPoint: MapPoint | null = null;
    let lastEndInter: Intersection | null = null;

    for (let i = 0; i < orderedBoundaries.length; i++) {
      const boundary = orderedBoundaries[i];
      const roadId = beam.boundaries[boundary];

      if (!roadId) {
        console.warn(`[planClockwiseCircuit] 梁位 ${beam.id} 缺少 ${boundary} 边界道路`);
        continue;
      }

      const road = this.roadById.get(roadId);
      if (!road) {
        console.warn(`[planClockwiseCircuit] 道路 ${roadId} 不存在`);
        continue;
      }

      // 获取梁位边界内的道路段
      const roadSegment = this.getBeamBoundarySegment(road, beam);
      if (!roadSegment) {
        console.warn(`[planClockwiseCircuit] 无法获取道路段`);
        continue;
      }

      // 确定行驶方向
      const direction = this.getClockwiseDirection(boundary, road);

      // 排序道路点
      const roadPoints = direction === 'forward'
        ? [...roadSegment.points]
        : [...roadSegment.points].reverse();

      // 生成转弯弧
      if (lastEndPoint && lastEndInter) {
        const turnArc = this.generateTurnArcSegment(
          lastEndPoint,
          lastEndInter,
          roadPoints[0],
          boundary
        );
        if (turnArc) {
          turnArc.id = `seg_${segments.length}`;
          segments.push(turnArc);
        }
      }

      // 获取喷淋模式
      const sprayMode = this.sprayManager.getSprayMode(roadId, beam.id);
      console.log(`[planClockwiseCircuit] 边界 ${boundary}, 道路 ${roadId}, 喷淋模式: ${sprayMode}`);

      // 生成航点
      const waypoints = this.generateWaypointsWithYaw(roadPoints);

      segments.push({
        id: `seg_${segments.length}`,
        type: 'road',
        road_id: road.id,
        direction,
        beam_id: beam.id,
        side: boundary,
        spray_mode: sprayMode,
        waypoints
      });

      lastEndPoint = roadPoints[roadPoints.length - 1];
      lastEndInter = this.findEndIntersection(road, roadPoints, beam);
    }

    // 最后的转弯弧（从最后一条边界回到起点）
    if (lastEndPoint && lastEndInter) {
      const firstBoundary = orderedBoundaries[0];
      const firstRoadId = beam.boundaries[firstBoundary];
      const firstRoad = firstRoadId ? this.roadById.get(firstRoadId) : null;

      if (firstRoad) {
        const firstSegment = this.getBeamBoundarySegment(firstRoad, beam);
        if (firstSegment) {
          const firstDirection = this.getClockwiseDirection(firstBoundary, firstRoad);
          const firstPoints = firstDirection === 'forward'
            ? [...firstSegment.points]
            : [...firstSegment.points].reverse();

          const turnArc = this.generateTurnArcSegment(
            lastEndPoint,
            lastEndInter,
            firstPoints[0],
            firstBoundary
          );
          if (turnArc) {
            turnArc.id = `seg_${segments.length}`;
            segments.push(turnArc);
          }
        }
      }
    }

    return segments;
  }

  /**
   * 找到离补给站最近的梁位边界
   */
  private findNearestBoundary(beam: BeamPosition, supplyPos: MapPoint): 'north' | 'south' | 'east' | 'west' {
    const dx = supplyPos.x - beam.center.x;
    const dy = supplyPos.y - beam.center.y;

    console.log(`[findNearestBoundary] 补给站相对梁位: dx=${dx.toFixed(2)}, dy=${dy.toFixed(2)}`);

    // 根据象限确定起始边界
    // 顺时针绕行，从最近的边界开始
    if (dx <= 0 && dy <= 0) {
      return 'west';   // 西南角，从西边界开始
    } else if (dx > 0 && dy <= 0) {
      return 'south';  // 东南角，从南边界开始
    } else if (dx > 0 && dy > 0) {
      return 'east';   // 东北角，从东边界开始
    } else {
      return 'north';  // 西北角，从北边界开始
    }
  }

  /**
   * 获取顺时针绕行时的行驶方向
   */
  private getClockwiseDirection(boundary: 'north' | 'south' | 'east' | 'west', road: Road): 'forward' | 'backward' {
    const points = road.points;
    if (points.length < 2) return 'forward';

    const startPoint = points[0].map_xy;
    const endPoint = points[points.length - 1].map_xy;
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;

    // 顺时针绕行方向：
    // - 西边界：向北行驶
    // - 北边界：向东行驶
    // - 东边界：向南行驶
    // - 南边界：向西行驶

    if (boundary === 'west') {
      // 向北：如果道路forward是向北则forward，否则backward
      return dy > 0 ? 'forward' : 'backward';
    } else if (boundary === 'north') {
      // 向东：如果道路forward是向东则forward，否则backward
      return dx > 0 ? 'forward' : 'backward';
    } else if (boundary === 'east') {
      // 向南：如果道路forward是向南则forward，否则backward
      return dy < 0 ? 'forward' : 'backward';
    } else {
      // 南边界：向西
      return dx < 0 ? 'forward' : 'backward';
    }
  }

  /**
   * 获取梁位边界内的道路段
   */
  private getBeamBoundarySegment(road: Road, beam: BeamPosition): RoadSegment | null {
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
      return {
        road_id: road.id,
        start_point: points[0],
        end_point: points[points.length - 1],
        start_inter_id: '',
        end_inter_id: '',
        beam_left_id: null,
        beam_right_id: null,
        points
      };
    }

    // 按道路方向排序交叉点
    relevantInters.sort((a, b) => {
      const aProj = this.projectOnRoad(a.center.map_xy, road);
      const bProj = this.projectOnRoad(b.center.map_xy, road);
      return aProj - bProj;
    });

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
   * 生成带yaw角的航点
   */
  private generateWaypointsWithYaw(points: MapPoint[]): Waypoint[] {
    const waypoints: Waypoint[] = [];

    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      let yaw: number;

      if (i < points.length - 1) {
        yaw = calculateYawFromPoints(point, points[i + 1]);
      } else if (i > 0) {
        yaw = calculateYawFromPoints(points[i - 1], point);
      } else {
        yaw = 0;
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
   * 生成转弯弧路段
   */
  private generateTurnArcSegment(
    fromPoint: MapPoint,
    fromInter: Intersection,
    toPoint: MapPoint,
    toBoundary: 'north' | 'south' | 'east' | 'west'
  ): RouteSegment | null {
    // 查找对应的转弯弧
    for (const arc of this.turnArcs) {
      if (arc.intersection_id === fromInter.id) {
        // 使用转弯弧的点生成航点
        const waypoints: Waypoint[] = arc.points.map(p => ({
          x: p.map_xy.x,
          y: p.map_xy.y,
          yaw: 0
        }));

        // 计算yaw角
        for (let i = 0; i < waypoints.length; i++) {
          if (i < waypoints.length - 1) {
            waypoints[i].yaw = normalizeAngle(calculateYawFromPoints(
              { x: waypoints[i].x, y: waypoints[i].y },
              { x: waypoints[i + 1].x, y: waypoints[i + 1].y }
            ));
          } else {
            waypoints[i].yaw = waypoints[i - 1].yaw;
          }
        }

        return {
          id: '',
          type: 'turn_arc',
          arc_id: arc.id,
          spray_mode: 'none',
          waypoints
        };
      }
    }

    // 没找到转弯弧，生成直连
    return this.createTransitSegment(fromPoint, toPoint);
  }

  /**
   * 找到道路终点的交叉点
   */
  private findEndIntersection(road: Road, points: MapPoint[], beam: BeamPosition): Intersection | null {
    const endPoint = points[points.length - 1];

    for (const interId of beam.corner_intersections) {
      const inter = this.interById.get(interId);
      if (inter && inter.connected_roads.includes(road.id)) {
        const dist = distance(endPoint, inter.center.map_xy);
        if (dist < 2.0) {
          return inter;
        }
      }
    }

    return null;
  }

  /**
   * 规划过渡路段（两点之间）
   */
  private planTransitSegment(from: MapPoint, to: MapPoint): RouteSegment[] {
    // 简单实现：直线连接
    // 完整实现应该使用A*搜索道路网络
    return [this.createTransitSegment(from, to)];
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
   * 创建过渡路段
   */
  private createTransitSegment(from: MapPoint, to: MapPoint): RouteSegment {
    return {
      id: '',
      type: 'transit',
      spray_mode: 'none',
      waypoints: [
        { x: from.x, y: from.y, yaw: calculateYawFromPoints(from, to) },
        { x: to.x, y: to.y, yaw: calculateYawFromPoints(from, to) }
      ]
    };
  }

  /**
   * 验证路线连续性
   */
  private validateRoute(segments: RouteSegment[]): void {
    for (let i = 0; i < segments.length - 1; i++) {
      const currentSeg = segments[i];
      const nextSeg = segments[i + 1];

      const endPoint = currentSeg.waypoints[currentSeg.waypoints.length - 1];
      const startPoint = nextSeg.waypoints[0];

      const dist = distance(endPoint, startPoint);
      if (dist > 0.5) {
        console.warn(`[validateRoute] 路段 ${i} 到 ${i + 1} 不连续，距离: ${dist.toFixed(2)}m`);
      }
    }
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
  private calculateEstimatedTime(totalLength: number, sprayLength: number, segmentCount: number): number {
    const travelSpeed = 0.5;  // m/s
    const spraySpeed = 0.3;   // m/s (喷淋时较慢)
    const turnTime = 5;       // 每次转弯约5秒

    const travelTime = (totalLength - sprayLength) / travelSpeed;
    const sprayTime = sprayLength / spraySpeed;

    return Math.ceil(travelTime + sprayTime + segmentCount * turnTime);
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
