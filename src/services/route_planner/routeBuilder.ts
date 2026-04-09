/**
 * 路线构建器 - 核心整合模块
 */

import fs from 'fs';
import path from 'path';
import { 
  BeamPosition, 
  JobRoute, 
  RouteSegment,
  BeamLayout,
  CircuitConfig,
  GpsRoutes,
  SupplyStation
} from './types';
import { LayoutAnalyzer } from './core/layoutAnalyzer';
import { BeamSequencer } from './core/beamSequencer';
import { RouteValidator } from './core/routeValidator';
import { MapQuery } from './core/mapQuery';
import { SprayStatusManager } from './spray/sprayStatusManager';
import { ClockwiseCircuit } from './circuit/clockwiseCircuit';
import { PartialCircuit } from './circuit/partialCircuit';
import { SupplyToFirstTransit } from './transit/supplyToFirst';
import { BeamToBeamTransit } from './transit/beamToBeam';
import { LastBeamToSupplyTransit } from './transit/lastBeamToSupply';
import { ZigzagPlanner } from './zigzag/zigzagPlanner';
import { distance, calculateRoadSegmentLength } from './utils';

export class RouteBuilder {
  // 数据存储
  private roads: any[] = [];
  private intersections: any[] = [];
  private turnArcs: any[] = [];
  private beamPositions: BeamPosition[] = [];
  private supplyStation: SupplyStation | null = null;

  // 模块实例
  private layoutAnalyzer: LayoutAnalyzer;
  private beamSequencer: BeamSequencer;
  private routeValidator: RouteValidator;
  private mapQuery: MapQuery;
  private sprayManager: SprayStatusManager;
  private clockwiseCircuit: ClockwiseCircuit;
  private partialCircuit: PartialCircuit;
  private supplyToFirst: SupplyToFirstTransit;
  private beamToBeam: BeamToBeamTransit;
  private lastBeamToSupply: LastBeamToSupplyTransit;
  private zigzagPlanner: ZigzagPlanner;

  constructor() {
    // 初始化模块
    this.layoutAnalyzer = new LayoutAnalyzer();
    this.beamSequencer = new BeamSequencer(this.layoutAnalyzer);
    this.routeValidator = new RouteValidator();
    this.mapQuery = new MapQuery();
    this.sprayManager = new SprayStatusManager();
    this.clockwiseCircuit = new ClockwiseCircuit(this.mapQuery, this.sprayManager);
    this.partialCircuit = new PartialCircuit(this.mapQuery, this.sprayManager);
    this.supplyToFirst = new SupplyToFirstTransit(this.mapQuery);
    this.beamToBeam = new BeamToBeamTransit(this.mapQuery);
    this.lastBeamToSupply = new LastBeamToSupplyTransit(this.mapQuery);
    this.zigzagPlanner = new ZigzagPlanner(this.mapQuery, this.sprayManager);
  }

  /**
   * 加载数据文件
   */
  loadData(mapsDir: string): boolean {
    try {
      // 加载gps_routes.json
      const routesPath = path.join(mapsDir, 'gps_routes.json');
      if (!fs.existsSync(routesPath)) {
        console.error('[RouteBuilder] gps_routes.json 不存在');
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

      // 加载gps_origin.yaml
      const originPath = path.join(mapsDir, 'gps_origin.yaml');
      if (fs.existsSync(originPath)) {
        this.supplyStation = this.parseSupplyStationFromYaml(originPath);
      }

      // 初始化MapQuery
      this.mapQuery.initialize(
        this.roads, 
        this.intersections, 
        this.turnArcs, 
        this.beamPositions
      );

      console.log(`[RouteBuilder] 加载数据: ${this.roads.length}条道路, ${this.intersections.length}个交叉点, ${this.turnArcs.length}条圆弧, ${this.beamPositions.length}个梁位`);

      return true;
    } catch (error) {
      console.error('[RouteBuilder] 加载数据失败:', error);
      return false;
    }
  }

  /**
   * 解析补给站配置
   */
  private parseSupplyStationFromYaml(yamlPath: string): SupplyStation | null {
    try {
      const content = fs.readFileSync(yamlPath, 'utf-8');
      
      const supplyStationMatch = content.match(/supply_station:\s*\n((?:\s{2,}\S.*\n?)*)/);
      if (!supplyStationMatch) {
        console.warn('[RouteBuilder] 未找到 supply_station 配置块');
        return null;
      }

      const block = supplyStationMatch[1];
      
      const headingMatch = block.match(/^\s+heading:\s*([\d.]+)/m);
      const heading = headingMatch ? parseFloat(headingMatch[1]) : 0;

      const positionMatch = block.match(/position:\s*\n\s+x:\s*([\d.-]+)\s*\n\s+y:\s*([\d.-]+)/);
      const x = positionMatch ? parseFloat(positionMatch[1]) : 0;
      const y = positionMatch ? parseFloat(positionMatch[2]) : 0;

      const idMatch = block.match(/^\s+id:\s*(\S+)/m);
      const arucoMatch = block.match(/^\s+aruco_marker_id:\s*(\d+)/m);
      const approachMatch = block.match(/^\s+approach_distance:\s*([\d.]+)/m);
      const entryRoadMatch = block.match(/^\s+entry_road_id:\s*(\S+)/m);
      const entryInterMatch = block.match(/^\s+entry_intersection_id:\s*(\S+)/m);

      return {
        id: idMatch ? idMatch[1] : 'supply_station_1',
        position: { x, y },
        heading,
        aruco_marker_id: arucoMatch ? parseInt(arucoMatch[1]) : 0,
        approach_distance: approachMatch ? parseFloat(approachMatch[1]) : 3.0,
        entry_road_id: entryRoadMatch ? entryRoadMatch[1] : '',
        entry_intersection_id: entryInterMatch ? entryInterMatch[1] : ''
      };
    } catch (error) {
      console.warn('[RouteBuilder] 解析补给站配置失败:', error);
      return null;
    }
  }

  /**
   * 构建作业路线
   */
  buildRoute(beamIds: string[]): JobRoute {
    console.log(`[RouteBuilder] 开始规划路线，梁位: ${beamIds.join(', ')}`);

    // 1. 验证梁位ID
    const validBeamIds = beamIds.filter(id => this.beamPositions.some(b => b.id === id));
    if (validBeamIds.length === 0) {
      throw new Error('没有有效的梁位ID');
    }

    const beams = validBeamIds.map(id => this.beamPositions.find(b => b.id === id)!);

    // 2. 分析梁位布局
    const layout = this.layoutAnalyzer.analyze(beams);
    console.log(`[RouteBuilder] 布局分析: ${layout.rowCount}行, 单行=${layout.isSingleRow}, 单列=${layout.isSingleColumn}`);

    // 3. 确定补给站位置
    const supplyPos = this.supplyStation?.position || { x: 0, y: 0 };
    const supplyHeading = this.supplyStation?.heading || 0;

    // 4. 确定梁位访问顺序
    const orderedBeams = this.beamSequencer.optimize(beams, supplyPos, layout);
    console.log(`[RouteBuilder] 访问顺序: ${orderedBeams.map(b => b.id).join(' → ')}`);

    // 5. 初始化喷淋状态
    this.sprayManager.reset();
    this.sprayManager.setSelectedBeams(validBeamIds);
    this.sprayManager.setAllBeams(this.beamPositions);

    // 6. 选择策略并构建路线
    let segments: RouteSegment[];
    
    if (this.zigzagPlanner.isApplicable(layout)) {
      // S形路线
      console.log(`[RouteBuilder] 使用S形路线策略`);
      segments = this.zigzagPlanner.plan(orderedBeams, supplyPos, supplyHeading);
    } else {
      // 逐个绕行
      console.log(`[RouteBuilder] 使用逐个绕行策略`);
      segments = this.buildSequentialRoute(orderedBeams, supplyPos, supplyHeading);
    }

    // 7. 验证路线
    const validation = this.routeValidator.validate(segments, beams);
    if (!validation.isValid) {
      console.warn('[RouteBuilder] 路线验证失败:');
      validation.errors.forEach(e => console.warn(`  - ${e.type}: ${e.message}`));
    }
    validation.warnings.forEach(w => console.log(`  - ${w.type}: ${w.message}`));

    // 8. 计算统计信息
    const totalLength = this.routeValidator.calculateTotalLength(segments);
    const sprayLength = this.routeValidator.calculateSprayLength(segments);
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
        transit_length: Math.round((totalLength - sprayLength) * 100) / 100
      }
    };

    console.log(`[RouteBuilder] 路线规划完成: ${segments.length}个路段, 总长度${route.statistics.total_length}m, 喷淋${route.statistics.spray_length}m`);
    return route;
  }

  /**
   * 构建逐个绕行路线
   */
  private buildSequentialRoute(
    beams: BeamPosition[],
    supplyPos: { x: number; y: number },
    supplyHeading: number
  ): RouteSegment[] {
    const segments: RouteSegment[] = [];
    let currentPos = supplyPos;
    let currentYaw = supplyHeading;

    // 1. 补给站 -> 第一个梁位
    const firstSegments = this.supplyToFirst.plan(beams[0], supplyPos, supplyHeading);
    for (const seg of firstSegments) {
      seg.id = `seg_${segments.length}`;
      segments.push(seg);
    }
    
    if (firstSegments.length > 0) {
      const lastWp = firstSegments[firstSegments.length - 1].waypoints[
        firstSegments[firstSegments.length - 1].waypoints.length - 1
      ];
      currentPos = { x: lastWp.x, y: lastWp.y };
      currentYaw = lastWp.yaw;
    }

    // 2. 逐个梁位绕行 + 过渡
    for (let i = 0; i < beams.length; i++) {
      const beam = beams[i];
      const isLastBeam = (i === beams.length - 1);
      
      console.log(`[RouteBuilder] 生成梁位 ${beam.id} 顺时针绕行${isLastBeam ? ' (最后梁位)' : ''}`);

      // 规划绕行
      const config: CircuitConfig = {
        direction: 'clockwise',
        boundaryCount: 4,
        skipBoundaries: []
      };
      
      const circuitSegments = this.clockwiseCircuit.plan(
        beam, 
        currentPos, 
        config,
        isLastBeam,
        beams
      );
      
      for (const seg of circuitSegments) {
        seg.id = `seg_${segments.length}`;
        segments.push(seg);
      }

      // 更新当前位置
      if (circuitSegments.length > 0) {
        const lastSeg = circuitSegments[circuitSegments.length - 1];
        const lastWp = lastSeg.waypoints[lastSeg.waypoints.length - 1];
        currentPos = { x: lastWp.x, y: lastWp.y };
        currentYaw = lastWp.yaw;
        console.log(`[RouteBuilder] 绕行结束位置: (${currentPos.x.toFixed(2)}, ${currentPos.y.toFixed(2)}), yaw: ${currentYaw.toFixed(4)}`);
      }

      // 规划到下一个梁位的过渡
      if (i < beams.length - 1) {
        const transitSegments = this.beamToBeam.plan(
          currentPos,
          currentYaw,
          beam,
          beams[i + 1]
        );
        
        for (const seg of transitSegments) {
          seg.id = `seg_${segments.length}`;
          segments.push(seg);
        }

        // 更新当前位置
        if (transitSegments.length > 0) {
          const lastWp = transitSegments[transitSegments.length - 1].waypoints[
            transitSegments[transitSegments.length - 1].waypoints.length - 1
          ];
          currentPos = { x: lastWp.x, y: lastWp.y };
          currentYaw = lastWp.yaw;
        }
      }
    }

    // 3. 最后梁位 -> 补给站
    const returnSegments = this.lastBeamToSupply.plan(
      beams[beams.length - 1],
      supplyPos,
      currentPos,
      currentYaw
    );
    
    for (const seg of returnSegments) {
      seg.id = `seg_${segments.length}`;
      segments.push(seg);
    }

    return segments;
  }

  /**
   * 计算预估时间
   */
  private calculateEstimatedTime(totalLength: number, sprayLength: number, segmentCount: number): number {
    const travelSpeed = 0.5;
    const spraySpeed = 0.3;
    const turnTime = 5;

    const travelTime = (totalLength - sprayLength) / travelSpeed;
    const sprayTime = sprayLength / spraySpeed;

    return Math.ceil(travelTime + sprayTime + segmentCount * turnTime);
  }

  /**
   * 生成YAML格式路线
   */
  generateYAML(route: JobRoute): string {
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