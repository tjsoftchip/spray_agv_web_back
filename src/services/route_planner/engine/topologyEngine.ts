/**
 * 拓扑引擎 - 端口有向图
 * 
 * 将十字路口展开为IN/OUT端口节点，道路和弧线作为有向边。
 * 物理隔离掉头：不创建 IN_X -> OUT_X 的内部边。
 */

import {
  DirectedEdge,
  EdgeType,
  PortNode,
  Direction,
  OPPOSITE_DIR,
  RawGeoPoint,
} from './types';

interface RawRoad {
  id: string;
  name: string;
  type: string;
  points: Array<{
    seq: number;
    gps: { latitude: number; longitude: number; altitude: number };
    map_xy: { x: number; y: number };
  }>;
}

interface RawIntersection {
  id: string;
  type: string;
  center: { gps: { latitude: number; longitude: number }; map_xy: { x: number; y: number } };
  connected_roads: string[];
  neighbors?: Record<string, string>;
  road_v_id?: string;
  road_h_id?: string;
}

interface RawTurnArc {
  id: string;
  intersection_id: string;
  quadrant: number;
  radius: number;
  center: { x: number; y: number };
  tangent_points: Array<{ x: number; y: number }>;
  points: Array<{
    seq: number;
    gps: { latitude: number; longitude: number; altitude: number };
    map_xy: { x: number; y: number };
  }>;
}

export class TopologyEngine {
  private nodes = new Map<string, PortNode>();
  private edges = new Map<string, DirectedEdge>();
  private adjacency = new Map<string, DirectedEdge[]>();
  private intersectionMap = new Map<string, RawIntersection>();
  private roadMap = new Map<string, RawRoad>();

  get nodesCount() { return this.nodes.size; }
  get edgesCount() { return this.edges.size; }

  build(
    roads: RawRoad[],
    intersections: RawIntersection[],
    turnArcs: RawTurnArc[],
    supplyIntersectionId: string,
    supplyStationPos?: { x: number; y: number }
  ): void {
    this.nodes.clear();
    this.edges.clear();
    this.adjacency.clear();

    for (const inter of intersections) {
      this.intersectionMap.set(inter.id, inter);
    }
    for (const road of roads) {
      this.roadMap.set(road.id, road);
    }

    for (const inter of intersections) {
      this.createPortNodes(inter);
    }

    this.createExternalEdges(roads, intersections);

    this.createInternalArcEdges(turnArcs);

    this.createStationLinks(supplyIntersectionId, supplyStationPos);

    this.buildAdjacency();

    this.debugLogGraph();

    console.log(`[TopologyEngine] 构建: ${this.nodes.size}个端口节点, ${this.edges.size}条有向边`);
  }

  getNode(nodeId: string): PortNode | undefined {
    return this.nodes.get(nodeId);
  }

  getEdge(edgeId: string): DirectedEdge | undefined {
    return this.edges.get(edgeId);
  }

  getOutEdges(nodeId: string): DirectedEdge[] {
    return this.adjacency.get(nodeId) || [];
  }

  getAllEdges(): DirectedEdge[] {
    return Array.from(this.edges.values());
  }

  getTaskEdges(): DirectedEdge[] {
    return Array.from(this.edges.values()).filter(e => e.taskMode !== 0);
  }

  resetTaskState(): void {
    for (const edge of this.edges.values()) {
      edge.taskMode = 0;
      edge.isCompleted = false;
    }
  }

  getStationOutNodeId(): string {
    return 'SUPPLY_STATION.STATION';
  }

  getStationInNodeId(): string {
    return 'SUPPLY_STATION_RETURN.STATION';
  }

  private createPortNodes(inter: RawIntersection): void {
    const cx = inter.center.map_xy.x;
    const cy = inter.center.map_xy.y;
    const dirs: Direction[] = ['north', 'south', 'east', 'west'];

    for (const dir of dirs) {
      const hasRoad = this.intersectionHasRoadInDir(inter, dir);
      if (!hasRoad) continue;

      const inNodeId = `${inter.id}.IN_${this.capitalize(dir)}`;
      const outNodeId = `${inter.id}.OUT_${this.capitalize(dir)}`;

      const offset = 0.1;
      let ox = 0, oy = 0;
      switch (dir) {
        case 'north': oy = offset; break;
        case 'south': oy = -offset; break;
        case 'east': ox = offset; break;
        case 'west': ox = -offset; break;
      }

      this.nodes.set(inNodeId, {
        nodeId: inNodeId,
        intersectionId: inter.id,
        port: `IN_${this.capitalize(dir)}` as any,
        position: { x: cx + ox, y: cy + oy },
      });
      this.nodes.set(outNodeId, {
        nodeId: outNodeId,
        intersectionId: inter.id,
        port: `OUT_${this.capitalize(dir)}` as any,
        position: { x: cx - ox, y: cy - oy },
      });
    }
  }

  private intersectionHasRoadInDir(inter: RawIntersection, dir: Direction): boolean {
    if (!inter.neighbors) return true;
    const neighborKey = dir === 'north' ? 'top' : dir === 'south' ? 'bottom' : dir;
    const neighborId = inter.neighbors[neighborKey];
    if (neighborId === undefined) return inter.connected_roads.length > 1;
    return true;
  }

  private createExternalEdges(
    roads: RawRoad[],
    intersections: RawIntersection[]
  ): void {
    for (const road of roads) {
      const connectedInters = intersections.filter(i =>
        i.connected_roads.includes(road.id)
      );

      if (connectedInters.length < 2) continue;

      const pts = road.points.map(p => ({
        latitude: p.gps.latitude,
        longitude: p.gps.longitude,
        x: p.map_xy.x,
        y: p.map_xy.y,
      }));

      const sortedInters = this.sortIntersAlongRoad(connectedInters, pts);

      for (let i = 0; i < sortedInters.length - 1; i++) {
        const fromInter = sortedInters[i];
        const toInter = sortedInters[i + 1];

        const direction = this.inferRoadDirection(fromInter, toInter);
        const oppositeDir = OPPOSITE_DIR[direction] as Direction;

        const forwardEdgeId = `road_${road.id}_${i}_fwd`;
        const backwardEdgeId = `road_${road.id}_${i}_bwd`;

        const segPoints = this.extractSegmentPoints(pts, fromInter, toInter);
        const segLength = this.calculateLength(segPoints);

        const outNodeId = `${fromInter.id}.OUT_${this.capitalize(direction)}`;
        const inNodeId = `${toInter.id}.IN_${this.capitalize(oppositeDir)}`;

        if (this.nodes.has(outNodeId) && this.nodes.has(inNodeId)) {
          this.edges.set(forwardEdgeId, {
            edgeId: forwardEdgeId,
            type: EdgeType.EXTERNAL_ROAD,
            sourceNodeId: outNodeId,
            targetNodeId: inNodeId,
            points: segPoints,
            length: segLength,
            roadId: road.id,
            taskMode: 0,
            isCompleted: false,
          });
        }

        const revPoints = [...segPoints].reverse();
        const outNodeIdRev = `${toInter.id}.OUT_${this.capitalize(oppositeDir)}`;
        const inNodeIdRev = `${fromInter.id}.IN_${this.capitalize(direction)}`;

        if (this.nodes.has(outNodeIdRev) && this.nodes.has(inNodeIdRev)) {
          this.edges.set(backwardEdgeId, {
            edgeId: backwardEdgeId,
            type: EdgeType.EXTERNAL_ROAD,
            sourceNodeId: outNodeIdRev,
            targetNodeId: inNodeIdRev,
            points: revPoints,
            length: segLength,
            roadId: road.id,
            taskMode: 0,
            isCompleted: false,
          });
        }
      }
    }
  }

  private createInternalArcEdges(turnArcs: RawTurnArc[]): void {
    const arcEdgeRegistry = new Set<string>();

    for (const arc of turnArcs) {
      const inter = this.intersectionMap.get(arc.intersection_id);
      if (!inter) continue;

      const cx = inter.center.map_xy.x;
      const cy = inter.center.map_xy.y;

      const firstPt = arc.points[0].map_xy;
      const lastPt = arc.points[arc.points.length - 1].map_xy;

      const entryDir = this.inferDirectionFromOffset(firstPt.x - cx, firstPt.y - cy);
      const exitDir = this.inferDirectionFromOffset(lastPt.x - cx, lastPt.y - cy);

      if (entryDir === exitDir) continue;

      const pts = arc.points.map(p => ({
        latitude: p.gps.latitude,
        longitude: p.gps.longitude,
        x: p.map_xy.x,
        y: p.map_xy.y,
      }));
      const arcLength = this.calculateLength(pts);

      const inNodeId = `${inter.id}.IN_${this.capitalize(entryDir)}`;
      const outNodeId = `${inter.id}.OUT_${this.capitalize(exitDir)}`;

      if (this.nodes.has(inNodeId) && this.nodes.has(outNodeId)) {
        const fwdEdgeId = `arc_${arc.id}_fwd`;
        this.edges.set(fwdEdgeId, {
          edgeId: fwdEdgeId,
          type: EdgeType.INTERNAL_ARC,
          sourceNodeId: inNodeId,
          targetNodeId: outNodeId,
          points: pts,
          length: arcLength,
          arcId: arc.id,
          intersectionId: inter.id,
          taskMode: 0,
          isCompleted: false,
        });
        arcEdgeRegistry.add(`${inter.id}|${entryDir}|${exitDir}`);
      }

      const revPts = [...pts].reverse();
      const revInNodeId = `${inter.id}.IN_${this.capitalize(exitDir)}`;
      const revOutNodeId = `${inter.id}.OUT_${this.capitalize(entryDir)}`;

      if (this.nodes.has(revInNodeId) && this.nodes.has(revOutNodeId)) {
        const bwdEdgeId = `arc_${arc.id}_bwd`;
        this.edges.set(bwdEdgeId, {
          edgeId: bwdEdgeId,
          type: EdgeType.INTERNAL_ARC,
          sourceNodeId: revInNodeId,
          targetNodeId: revOutNodeId,
          points: revPts,
          length: arcLength,
          arcId: arc.id,
          intersectionId: inter.id,
          taskMode: 0,
          isCompleted: false,
        });
        arcEdgeRegistry.add(`${inter.id}|${exitDir}|${entryDir}`);
      }
    }

    for (const arc of turnArcs) {
      const inter = this.intersectionMap.get(arc.intersection_id);
      if (!inter) continue;

      const cx = inter.center.map_xy.x;
      const cy = inter.center.map_xy.y;

      const firstPt = arc.points[0].map_xy;
      const lastPt = arc.points[arc.points.length - 1].map_xy;

      const entryDir = this.inferDirectionFromOffset(firstPt.x - cx, firstPt.y - cy);
      const exitDir = this.inferDirectionFromOffset(lastPt.x - cx, lastPt.y - cy);

      if (entryDir === exitDir) continue;

      const inNode = this.nodes.get(`${inter.id}.IN_${this.capitalize(entryDir)}`);
      if (inNode) {
        inNode.position = { x: firstPt.x, y: firstPt.y };
      }
      const outNode = this.nodes.get(`${inter.id}.OUT_${this.capitalize(exitDir)}`);
      if (outNode) {
        outNode.position = { x: lastPt.x, y: lastPt.y };
      }

      const revInNode = this.nodes.get(`${inter.id}.IN_${this.capitalize(exitDir)}`);
      if (revInNode) {
        revInNode.position = { x: lastPt.x, y: lastPt.y };
      }
      const revOutNode = this.nodes.get(`${inter.id}.OUT_${this.capitalize(entryDir)}`);
      if (revOutNode) {
        revOutNode.position = { x: firstPt.x, y: firstPt.y };
      }
    }

    const dirs: Direction[] = ['north', 'south', 'east', 'west'];
    for (const [interId, inter] of this.intersectionMap) {
      for (const fromDir of dirs) {
        for (const toDir of dirs) {
          const key = `${interId}|${fromDir}|${toDir}`;
          if (arcEdgeRegistry.has(key)) continue;
          this.createCrossTurnEdge(inter, fromDir, toDir);
        }
      }
    }
  }

  private createCrossTurnEdge(
    inter: RawIntersection,
    fromDir: Direction,
    toDir: Direction
  ): void {
    const isUturn = fromDir === toDir;
    if (isUturn) return;

    const isStraight = fromDir === OPPOSITE_DIR[toDir];
    const prefix = isUturn ? 'uturn' : isStraight ? 'straight' : 'cross';
    const edgeId = `${prefix}_${inter.id}_${fromDir}_to_${toDir}`;
    if (this.edges.has(edgeId)) return;

    const inNodeId = `${inter.id}.IN_${this.capitalize(fromDir)}`;
    const outNodeId = `${inter.id}.OUT_${this.capitalize(toDir)}`;

    if (!this.nodes.has(inNodeId) || !this.nodes.has(outNodeId)) return;

    const inNode = this.nodes.get(inNodeId)!;
    const outNode = this.nodes.get(outNodeId)!;
    const cx = inter.center.map_xy.x;
    const cy = inter.center.map_xy.y;
    const centerPoint: RawGeoPoint = {
      latitude: inter.center.gps.latitude,
      longitude: inter.center.gps.longitude,
      x: cx,
      y: cy,
    };

    const points: RawGeoPoint[] = [
      { latitude: inter.center.gps.latitude, longitude: inter.center.gps.longitude, x: inNode.position.x, y: inNode.position.y },
      centerPoint,
      { latitude: inter.center.gps.latitude, longitude: inter.center.gps.longitude, x: outNode.position.x, y: outNode.position.y },
    ];

    // 实际路径长度：先沿入方向到中心，再从中心沿出方向
    // 入口到中心 ≈ R(4.5m), 中心到出口 ≈ R(4.5m)
    // 直行: 2R = 9m, 左/右转: πR/2 + R ≈ 11.6m, 斜穿: ~7m
    const R = 4.5;
    const fromOffset = { north: { x: 0, y: R }, south: { x: 0, y: -R }, east: { x: R, y: 0 }, west: { x: -R, y: 0 } };
    const inReal = { x: cx + fromOffset[fromDir].x, y: cy + fromOffset[fromDir].y };
    const outReal = { x: cx + fromOffset[toDir].x, y: cy + fromOffset[toDir].y };

    let pathLength: number;
    if (isUturn) {
      pathLength = Math.PI * R;
    } else if (isStraight) {
      pathLength = 2 * R;
    } else {
      const angle1 = Math.atan2(inReal.y - cy, inReal.x - cx);
      const angle2 = Math.atan2(outReal.y - cy, outReal.x - cx);
      let angleDiff = Math.abs(angle2 - angle1);
      if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
      pathLength = R * angleDiff;
    }

    this.edges.set(edgeId, {
      edgeId,
      type: EdgeType.INTERNAL_ARC,
      sourceNodeId: inNodeId,
      targetNodeId: outNodeId,
      points,
      length: pathLength,
      intersectionId: inter.id,
      taskMode: 0,
      isCompleted: false,
    });
  }

  private createStationLinks(supplyIntersectionId: string, supplyStationPos?: { x: number; y: number }): void {
    const supplyInter = this.intersectionMap.get(supplyIntersectionId);
    if (!supplyInter) {
      console.error(`[TopologyEngine] 补给站交叉点 ${supplyIntersectionId} 不存在`);
      return;
    }

    const supplyPos = supplyStationPos || { x: 0, y: 0 };

    this.nodes.set('SUPPLY_STATION.STATION', {
      nodeId: 'SUPPLY_STATION.STATION',
      intersectionId: 'SUPPLY_STATION',
      port: 'STATION',
      position: supplyPos,
    });

    this.nodes.set('SUPPLY_STATION_RETURN.STATION', {
      nodeId: 'SUPPLY_STATION_RETURN.STATION',
      intersectionId: 'SUPPLY_STATION',
      port: 'STATION',
      position: supplyPos,
    });

    const dx = supplyPos.x - supplyInter.center.map_xy.x;
    const dy = supplyPos.y - supplyInter.center.map_xy.y;
    let stationDir: Direction;
    if (Math.abs(dx) > Math.abs(dy)) {
      stationDir = dx > 0 ? 'east' : 'west';
    } else {
      stationDir = dy > 0 ? 'north' : 'south';
    }
    const dirCap = this.capitalize(stationDir);

    const outEdgeId = 'station_depart';
    const inNodeId = `${supplyIntersectionId}.IN_${dirCap}`;
    if (this.nodes.has(inNodeId)) {
      const interPos = this.nodes.get(inNodeId)!.position;
      this.edges.set(outEdgeId, {
        edgeId: outEdgeId,
        type: EdgeType.STATION_LINK,
        sourceNodeId: 'SUPPLY_STATION.STATION',
        targetNodeId: inNodeId,
        points: [
          { latitude: 0, longitude: 0, x: supplyPos.x, y: supplyPos.y },
          { latitude: 0, longitude: 0, x: interPos.x, y: interPos.y },
        ],
        length: this.dist(supplyPos, interPos),
        taskMode: 0,
        isCompleted: false,
      });
    } else {
      console.warn(`[TopologyEngine] 补给站入口节点 ${inNodeId} 不存在`);
    }

    const returnEdgeId = 'station_return';
    const outNodeId = `${supplyIntersectionId}.OUT_${dirCap}`;
    if (this.nodes.has(outNodeId)) {
      const interPos = this.nodes.get(outNodeId)!.position;
      this.edges.set(returnEdgeId, {
        edgeId: returnEdgeId,
        type: EdgeType.STATION_LINK,
        sourceNodeId: outNodeId,
        targetNodeId: 'SUPPLY_STATION_RETURN.STATION',
        points: [
          { latitude: 0, longitude: 0, x: interPos.x, y: interPos.y },
          { latitude: 0, longitude: 0, x: supplyPos.x, y: supplyPos.y },
        ],
        length: this.dist(interPos, supplyPos),
        taskMode: 0,
        isCompleted: false,
      });
    } else {
      console.warn(`[TopologyEngine] 补给站出口节点 ${outNodeId} 不存在`);
    }

    const returnFromInEdgeId = 'station_return_from_in';
    if (this.nodes.has(inNodeId)) {
      const inPos = this.nodes.get(inNodeId)!.position;
      this.edges.set(returnFromInEdgeId, {
        edgeId: returnFromInEdgeId,
        type: EdgeType.STATION_LINK,
        sourceNodeId: inNodeId,
        targetNodeId: 'SUPPLY_STATION_RETURN.STATION',
        points: [
          { latitude: 0, longitude: 0, x: inPos.x, y: inPos.y },
          { latitude: 0, longitude: 0, x: supplyPos.x, y: supplyPos.y },
        ],
        length: this.dist(inPos, supplyPos),
        taskMode: 0,
        isCompleted: false,
      });
    }

    console.log(`[TopologyEngine] 补给站连接: ${supplyIntersectionId}, 方向=${dirCap}`);
  }

  private buildAdjacency(): void {
    for (const edge of this.edges.values()) {
      if (!this.adjacency.has(edge.sourceNodeId)) {
        this.adjacency.set(edge.sourceNodeId, []);
      }
      this.adjacency.get(edge.sourceNodeId)!.push(edge);
    }
  }

  private debugLogGraph(): void {
    const nodeIds = Array.from(this.nodes.keys()).sort();
    for (const nid of nodeIds) {
      const out = this.adjacency.get(nid) || [];
      const edgeDescs = out.map(e => {
        const tag = e.taskMode !== 0 ? `[T${e.taskMode}]` : '';
        return `${e.edgeId}→${e.targetNodeId}${tag}`;
      });
      console.log(`[TopologyGraph] ${nid} => [${edgeDescs.join(', ')}]`);
    }

    const orphans = nodeIds.filter(nid => !this.adjacency.has(nid) || this.adjacency.get(nid)!.length === 0);
    if (orphans.length > 0) {
      console.warn(`[TopologyGraph] 无出边的节点: ${orphans.join(', ')}`);
    }
  }

  private inferRoadDirection(fromInter: RawIntersection, toInter: RawIntersection): Direction {
    const dx = toInter.center.map_xy.x - fromInter.center.map_xy.x;
    const dy = toInter.center.map_xy.y - fromInter.center.map_xy.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      return dx > 0 ? 'east' : 'west';
    }
    return dy > 0 ? 'north' : 'south';
  }

  private sortIntersAlongRoad(inters: RawIntersection[], roadPts: RawGeoPoint[]): RawIntersection[] {
    return [...inters].sort((a, b) => {
      const projA = this.projectOnRoad(a.center.map_xy, roadPts);
      const projB = this.projectOnRoad(b.center.map_xy, roadPts);
      return projA - projB;
    });
  }

  private projectOnRoad(point: { x: number; y: number }, roadPts: RawGeoPoint[]): number {
    let totalDist = 0;
    let minProj = 0;
    let minDist = Infinity;

    for (let i = 0; i < roadPts.length - 1; i++) {
      const a = roadPts[i];
      const b = roadPts[i + 1];
      const segLen = this.dist(a, b);
      if (segLen < 0.001) continue;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (segLen * segLen)));
      const projDist = this.dist(point, { x: a.x + t * dx, y: a.y + t * dy });

      if (projDist < minDist) {
        minDist = projDist;
        minProj = totalDist + t * segLen;
      }
      totalDist += segLen;
    }
    return minProj;
  }

  private extractSegmentPoints(
    roadPts: RawGeoPoint[],
    fromInter: RawIntersection,
    toInter: RawIntersection
  ): RawGeoPoint[] {
    const fromProj = this.projectOnRoad(fromInter.center.map_xy, roadPts);
    const toProj = this.projectOnRoad(toInter.center.map_xy, roadPts);

    let totalDist = 0;
    const projMap: Array<{ proj: number; idx: number }> = [];
    for (let i = 0; i < roadPts.length; i++) {
      if (i > 0) {
        totalDist += this.dist(roadPts[i - 1], roadPts[i]);
      }
      projMap.push({ proj: totalDist, idx: i });
    }

    const minProj = Math.min(fromProj, toProj);
    const maxProj = Math.max(fromProj, toProj);

    const result: RawGeoPoint[] = [];
    for (const pm of projMap) {
      if (pm.proj >= minProj - 0.5 && pm.proj <= maxProj + 0.5) {
        result.push(roadPts[pm.idx]);
      }
    }

    if (result.length < 2) {
      result.length = 0;
      result.push({ latitude: 0, longitude: 0, x: fromInter.center.map_xy.x, y: fromInter.center.map_xy.y });
      result.push({ latitude: 0, longitude: 0, x: toInter.center.map_xy.x, y: toInter.center.map_xy.y });
    }

    if (fromProj > toProj) {
      result.reverse();
    }

    return result;
  }

  private calculateLength(points: RawGeoPoint[]): number {
    let len = 0;
    for (let i = 1; i < points.length; i++) {
      len += this.dist(points[i - 1], points[i]);
    }
    return len;
  }

  private dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  }

  private inferDirectionFromOffset(dx: number, dy: number): Direction {
    if (Math.abs(dx) > Math.abs(dy)) {
      return dx > 0 ? 'east' : 'west';
    }
    return dy > 0 ? 'north' : 'south';
  }

  private capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
}
