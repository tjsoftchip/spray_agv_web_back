/**
 * 任务分析器 - 接收梁位ID，对拓扑图中的外部边打标
 *
 * 核心逻辑：同一路段的fwd/bwd边属于同一个taskGroup，只需覆盖一个方向即可完成任务。
 * 非共享路段：一个方向是LEFT，另一个是RIGHT，覆盖任一方向即可。
 * 共享路段（两个梁位共享）：两个方向都是BOTH，覆盖任一方向即可。
 */

import { DirectedEdge, SprayMode, EdgeType, Direction } from './types';

interface BeamPosition {
  id: string;
  center: { x: number; y: number };
  boundaries: { north: string; south: string; east: string; west: string };
  corner_intersections: string[];
  neighbors?: { top?: string; bottom?: string; left?: string; right?: string };
}

interface BeamRoadRef {
  beamId: string;
  side: string;
  cornerInterIds: Set<string>;
}

export class TaskAnalyzer {
  tagEdges(edges: DirectedEdge[], beams: BeamPosition[]): void {
    const roadToBeams = new Map<string, BeamRoadRef[]>();

    for (const beam of beams) {
      const cornerSet = new Set(beam.corner_intersections);
      for (const [side, roadId] of Object.entries(beam.boundaries)) {
        if (!roadId) continue;
        if (!roadToBeams.has(roadId)) {
          roadToBeams.set(roadId, []);
        }
        roadToBeams.get(roadId)!.push({
          beamId: beam.id,
          side,
          cornerInterIds: cornerSet,
        });
      }
    }

    for (const edge of edges) {
      if (edge.type !== EdgeType.EXTERNAL_ROAD) continue;
      if (!edge.roadId) continue;

      const beamInfos = roadToBeams.get(edge.roadId);
      if (!beamInfos || beamInfos.length === 0) {
        edge.taskMode = SprayMode.OFF;
        continue;
      }

      const edgeInterIds = this.extractEdgeInterIds(edge);

      const matchingBeams = beamInfos.filter(info =>
        this.edgeBelongsToBeam(edgeInterIds, info.cornerInterIds)
      );

      if (matchingBeams.length === 0) {
        edge.taskMode = SprayMode.OFF;
        continue;
      }

      if (matchingBeams.length >= 2) {
        edge.taskMode = SprayMode.BOTH;
      } else {
        const side = matchingBeams[0].side;
        const travelDir = this.inferEdgeDirection(edge);
        if (!travelDir) {
          edge.taskMode = SprayMode.RIGHT;
        } else {
          const crossProduct = this.computeCrossProduct(side, travelDir);
          edge.taskMode = crossProduct > 0 ? SprayMode.LEFT : SprayMode.RIGHT;
        }
      }

      edge.taskGroupId = this.makeTaskGroupId(edge);
    }

    const groups = new Set<string>();
    let taskEdgeCount = 0;
    for (const edge of edges) {
      if (edge.taskGroupId) {
        groups.add(edge.taskGroupId);
        taskEdgeCount++;
      }
    }
    const bothCount = edges.filter(e => e.taskMode === SprayMode.BOTH).length;
    console.log(`[TaskAnalyzer] 打标完成: ${taskEdgeCount}条任务边, ${groups.size}个任务组, 其中${bothCount}条双侧喷淋`);
  }

  private extractEdgeInterIds(edge: DirectedEdge): Set<string> {
    const ids = new Set<string>();
    for (const nodeId of [edge.sourceNodeId, edge.targetNodeId]) {
      const interId = nodeId.split('.')[0];
      if (interId && interId.startsWith('inter_')) {
        ids.add(interId);
      }
    }
    return ids;
  }

  private edgeBelongsToBeam(edgeInterIds: Set<string>, cornerInterIds: Set<string>): boolean {
    if (edgeInterIds.size < 2) return true;
    for (const id of edgeInterIds) {
      if (!cornerInterIds.has(id)) return false;
    }
    return true;
  }

  private makeTaskGroupId(edge: DirectedEdge): string {
    const srcInter = edge.sourceNodeId.split('.')[0];
    const tgtInter = edge.targetNodeId.split('.')[0];
    const sorted = [srcInter, tgtInter].sort();
    return `tg_${edge.roadId}_${sorted.join('_')}`;
  }

  private inferEdgeDirection(edge: DirectedEdge): Direction | null {
    if (edge.points.length < 2) return null;
    const first = edge.points[0];
    const last = edge.points[edge.points.length - 1];
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      return dx > 0 ? 'east' : 'west';
    }
    return dy > 0 ? 'north' : 'south';
  }

  private computeCrossProduct(side: string, travelDir: Direction): number {
    let roadDirX = 0, roadDirY = 0;
    switch (travelDir) {
      case 'north': roadDirY = 1; break;
      case 'south': roadDirY = -1; break;
      case 'east': roadDirX = 1; break;
      case 'west': roadDirX = -1; break;
    }

    let sprayDirX = 0, sprayDirY = 0;
    switch (side) {
      case 'north': sprayDirY = -1; break;
      case 'south': sprayDirY = 1; break;
      case 'east': sprayDirX = -1; break;
      case 'west': sprayDirX = 1; break;
    }

    return roadDirX * sprayDirY - roadDirY * sprayDirX;
  }
}
