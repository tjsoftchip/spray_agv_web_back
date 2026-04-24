/**
 * 路线构建器 - 基于端口有向图+欧拉路由引擎
 */

import fs from 'fs';
import path from 'path';
import { 
  BeamPosition, 
  JobRoute, 
  RouteSegment,
  GpsRoutes,
  SprayMode as OldSprayMode,
} from './types';
import { TopologyEngine } from './engine/topologyEngine';
import { TaskAnalyzer } from './engine/taskAnalyzer';
import { EulerianRouter } from './engine/eulerianRouter';
import { TrajectoryBuilder } from './engine/trajectoryBuilder';
import { SprayMode, DirectedEdge, EdgeType, RouteResponseData } from './engine/types';

export class RouteBuilder {
  private roads: any[] = [];
  private intersections: any[] = [];
  private turnArcs: any[] = [];
  private beamPositions: BeamPosition[] = [];

  private topology: TopologyEngine;
  private taskAnalyzer: TaskAnalyzer;
  private trajectoryBuilder: TrajectoryBuilder;

  constructor() {
    this.topology = new TopologyEngine();
    this.taskAnalyzer = new TaskAnalyzer();
    this.trajectoryBuilder = new TrajectoryBuilder();
  }

  loadData(mapsDir: string): boolean {
    try {
      const routesPath = path.join(mapsDir, 'gps_routes.json');
      if (!fs.existsSync(routesPath)) {
        console.error('[RouteBuilder] gps_routes.json 不存在');
        return false;
      }
      const routesData: GpsRoutes = JSON.parse(fs.readFileSync(routesPath, 'utf-8'));
      this.roads = routesData.roads || [];
      this.intersections = routesData.intersections || [];
      this.turnArcs = routesData.turn_arcs || [];

      const beamPath = path.join(mapsDir, 'beam_positions.json');
      if (fs.existsSync(beamPath)) {
        const beamData = JSON.parse(fs.readFileSync(beamPath, 'utf-8'));
        this.beamPositions = beamData.positions || [];
      }

      const supplyInterId = this.findSWIntersection();
      const supplyStationPos = this.loadSupplyStationPos(mapsDir);

      this.topology.build(this.roads, this.intersections, this.turnArcs, supplyInterId, supplyStationPos);

      console.log(`[RouteBuilder] 加载数据: ${this.roads.length}条道路, ${this.intersections.length}个交叉点, ${this.turnArcs.length}条圆弧, ${this.beamPositions.length}个梁位`);
      console.log(`[RouteBuilder] 拓扑图: ${this.topology.nodesCount}个端口节点, ${this.topology.edgesCount}条有向边`);
      return true;
    } catch (error) {
      console.error('[RouteBuilder] 加载数据失败:', error);
      return false;
    }
  }

  buildRoute(beamIds: string[]): JobRoute {
    console.log(`[RouteBuilder] 开始规划路线，梁位: ${beamIds.join(', ')}`);

    const validBeamIds = beamIds.filter(id => this.beamPositions.some(b => b.id === id));
    if (validBeamIds.length === 0) {
      throw new Error('没有有效的梁位ID');
    }

    const beams = validBeamIds.map(id => this.beamPositions.find(b => b.id === id)!);

    this.topology.resetTaskState();
    this.taskAnalyzer.tagEdges(this.topology.getAllEdges(), beams);

    const router = new EulerianRouter(this.topology);
    const edgePath = router.solve();

    const routeData = this.trajectoryBuilder.build(edgePath);

    const segments = this.convertToSegments(edgePath, routeData);

    const totalLength = routeData.total_length_meters;
    const sprayLength = this.calculateSprayLength(segments);
    const estimatedTime = routeData.estimated_time_seconds;

    const route: JobRoute = {
      id: `route_${Date.now()}`,
      name: `喷淋路线 ${new Date().toLocaleString()}`,
      created: new Date().toISOString(),
      beam_sequence: validBeamIds,
      segments,
      statistics: {
        total_length: totalLength,
        estimated_time: estimatedTime,
        spray_length: sprayLength,
        transit_length: Math.round((totalLength - sprayLength) * 100) / 100
      }
    };

    console.log(`[RouteBuilder] 路线规划完成: ${segments.length}个路段, 总长度${route.statistics.total_length}m`);
    return route;
  }

  private convertToSegments(edgePath: DirectedEdge[], routeData: RouteResponseData): RouteSegment[] {
    const segments: RouteSegment[] = [];
    const completedTaskGroups = new Set<string>();

    for (const edge of edgePath) {
      // 双端截断：节点位置可能被圆弧更新到道路中间，
      // 需要把 points 截断到精确匹配 sourceNode/targetNode 的位置
      let points = this.truncateEdgePoints(edge);

      // 转弯弧航点下采样至约 0.5m 间距，避免过密导致 RPP 来回跳动
      if (edge.type === EdgeType.INTERNAL_ARC) {
        points = this.downsamplePoints(points, 0.5);
      }

      const waypoints = points.map((pt, idx, arr) => {
        let yaw = 0;
        if (idx < arr.length - 1) {
          const next = arr[idx + 1];
          yaw = Math.atan2(next.y - pt.y, next.x - pt.x);
        } else if (idx > 0) {
          const prev = arr[idx - 1];
          yaw = Math.atan2(pt.y - prev.y, pt.x - prev.x);
        }
        if (yaw < 0) yaw += 2 * Math.PI;
        return { x: pt.x, y: pt.y, yaw };
      });

      const isFirstVisit = !!edge.taskGroupId && !completedTaskGroups.has(edge.taskGroupId);
      const sprayMode = this.determineSegmentSprayMode(edge, isFirstVisit);

      const seg: RouteSegment = {
        id: `seg_${segments.length}`,
        type: edge.type === 'EXTERNAL_ROAD' ? 'road' : edge.type === 'INTERNAL_ARC' ? 'turn_arc' : 'transit',
        spray_mode: sprayMode,
        waypoints,
      };

      if (edge.roadId) {
        seg.road_id = edge.roadId;
      }
      if (edge.arcId) {
        seg.arc_id = edge.arcId;
      }

      segments.push(seg);

      if (isFirstVisit && edge.taskGroupId) {
        completedTaskGroups.add(edge.taskGroupId);
      }
    }

    return segments;
  }

  /**
   * 截断边的 points，使其精确从 sourceNode 位置开始、到 targetNode 位置结束。
   * 修复圆弧端点更新节点位置后，道路边仍包含完整交叉点间航点的问题。
   */
  private truncateEdgePoints(edge: DirectedEdge): Array<{ x: number; y: number; latitude: number; longitude: number }> {
    const raw = edge.points;
    if (raw.length < 2) return raw;

    const srcNode = this.topology.getNode(edge.sourceNodeId);
    const tgtNode = this.topology.getNode(edge.targetNodeId);

    // 没有节点位置信息时，返回原始点
    if (!srcNode || !tgtNode) return raw;

    const srcPos = srcNode.position;
    const tgtPos = tgtNode.position;

    // 找到离 source 最近的点
    let startIdx = 0;
    let startMinDist = Infinity;
    for (let i = 0; i < raw.length; i++) {
      const d = Math.hypot(raw[i].x - srcPos.x, raw[i].y - srcPos.y);
      if (d < startMinDist) {
        startMinDist = d;
        startIdx = i;
      }
    }

    // 找到离 target 最近的点
    let endIdx = raw.length - 1;
    let endMinDist = Infinity;
    for (let i = 0; i < raw.length; i++) {
      const d = Math.hypot(raw[i].x - tgtPos.x, raw[i].y - tgtPos.y);
      if (d < endMinDist) {
        endMinDist = d;
        endIdx = i;
      }
    }

    // 确保 start <= end；如果 start > end，说明这条边的 points 方向
    // 和 source->target 方向相反（理论上 extractSegmentPoints 已处理），
    // 此时交换并用反转后的点
    if (startIdx > endIdx) {
      const tmp = startIdx;
      startIdx = endIdx;
      endIdx = tmp;
    }

    // 截断，确保至少保留 2 个点
    let truncated = raw.slice(startIdx, endIdx + 1);
    if (truncated.length < 2) {
      truncated = raw;
    }

    return truncated;
  }

  /**
   * 对航点序列进行下采样，确保相邻点间距不小于 minSpacing。
   * 用于减少转弯弧的航点密度，避免 RPP 控制器因 lookahead 在过密点之间跳动而产生 S 弯。
   */
  private downsamplePoints(
    points: Array<{ x: number; y: number; latitude: number; longitude: number }>,
    minSpacing: number
  ): Array<{ x: number; y: number; latitude: number; longitude: number }> {
    if (points.length < 3) return points;

    const result = [points[0]];
    let last = points[0];

    for (let i = 1; i < points.length - 1; i++) {
      const d = Math.hypot(points[i].x - last.x, points[i].y - last.y);
      if (d >= minSpacing) {
        result.push(points[i]);
        last = points[i];
      }
    }

    // 始终保留最后一个点
    const lastPoint = points[points.length - 1];
    const dLast = Math.hypot(lastPoint.x - last.x, lastPoint.y - last.y);
    if (dLast >= minSpacing * 0.5 || result.length < 2) {
      result.push(lastPoint);
    } else if (result.length >= 2) {
      // 用最后一个点替换 result 中最后一个中间点，保证终点精确
      result[result.length - 1] = lastPoint;
    }

    return result;
  }

  private determineSegmentSprayMode(edge: DirectedEdge, isFirstVisit: boolean): OldSprayMode {
    if (edge.type === EdgeType.INTERNAL_ARC || edge.type === EdgeType.STATION_LINK) {
      return 'none';
    }

    if (!edge.taskGroupId) {
      return this.convertSprayMode(edge.taskMode);
    }

    if (!isFirstVisit) {
      return 'none';
    }

    return this.convertSprayMode(edge.taskMode);
  }

  private convertSprayMode(mode: SprayMode): OldSprayMode {
    switch (mode) {
      case SprayMode.LEFT: return 'left_only';
      case SprayMode.RIGHT: return 'right_only';
      case SprayMode.BOTH: return 'both';
      default: return 'none';
    }
  }

  private calculateSprayLength(segments: RouteSegment[]): number {
    let total = 0;
    for (const seg of segments) {
      if (seg.spray_mode !== 'none') {
        for (let i = 1; i < seg.waypoints.length; i++) {
          const dx = seg.waypoints[i].x - seg.waypoints[i - 1].x;
          const dy = seg.waypoints[i].y - seg.waypoints[i - 1].y;
          total += Math.sqrt(dx * dx + dy * dy);
        }
      }
    }
    return Math.round(total * 100) / 100;
  }

  private findSWIntersection(): string {
    let bestScore = Infinity;
    let swInterId = this.intersections[0]?.id || 'inter_A_2';

    for (const inter of this.intersections) {
      const cx = inter.center.map_xy.x;
      const cy = inter.center.map_xy.y;
      const score = cx + cy;
      if (score < bestScore) {
        bestScore = score;
        swInterId = inter.id;
      }
    }

    console.log(`[RouteBuilder] SW交叉点: ${swInterId}`);
    return swInterId;
  }

  private loadSupplyStationPos(mapsDir: string): { x: number; y: number } | undefined {
    const originPath = path.join(mapsDir, 'gps_origin.yaml');
    if (!fs.existsSync(originPath)) return undefined;

    try {
      const content = fs.readFileSync(originPath, 'utf-8');
      const xMatch = content.match(/x:\s*([\d.-]+)/);
      const yMatch = content.match(/y:\s*([\d.-]+)/);
      if (xMatch && yMatch) {
        const pos = { x: parseFloat(xMatch[1]), y: parseFloat(yMatch[1]) };
        console.log(`[RouteBuilder] 补给站位置: (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)})`);
        return pos;
      }
    } catch {
      // ignore
    }
    return undefined;
  }

  generateYAML(route: JobRoute): string {
    const lines: string[] = [];
    lines.push('# 作业路线 - 基于端口有向图引擎自动生成');
    lines.push(`# 生成时间: ${route.created}`);
    lines.push(`# 梁位顺序: ${route.beam_sequence.join(' → ')}`);
    lines.push(`# 总长度: ${route.statistics.total_length}m`);
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
      lines.push(`      spray_mode: ${seg.spray_mode}`);
      lines.push('      waypoints:');
      for (const wp of seg.waypoints) {
        lines.push(`        - x: ${wp.x.toFixed(3)}`);
        lines.push(`          y: ${wp.y.toFixed(3)}`);
        lines.push(`          yaw: ${wp.yaw.toFixed(4)}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
