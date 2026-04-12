/**
 * 简化的图搜索核心引擎
 */

import { 
  BeamPosition, 
  Road, 
  Intersection, 
  TurnArc, 
  MapPoint, 
  DrivingState,
  RouteSegment,
  SprayMode,
  SprayRequirement
} from '../types';
import { MapQuery } from './mapQuery';
import { SprayStatusManager } from '../spray/sprayStatusManager';
import { distance, angleDifference, normalizeAngle } from '../utils';

interface SearchResult {
  success: boolean;
  path: MapPoint[];
  sprayMode: SprayMode;
  endState: DrivingState;
}

export class DirectedGraphSearch {
  private mapQuery: MapQuery;
  private sprayManager: SprayStatusManager;
  private taskRoads: string[] = [];
  private allRoads: Map<string, Road> = new Map();

  constructor(mapQuery: MapQuery, sprayManager: SprayStatusManager) {
    this.mapQuery = mapQuery;
    this.sprayManager = sprayManager;
  }

  initializeGraph(taskRoadIds: string[], beams: BeamPosition[]): void {
    console.log(`[DirectedGraphSearch] 初始化图，任务道路数: ${taskRoadIds.length}`);
    this.taskRoads = taskRoadIds;
    this.allRoads = this.mapQuery['roads'] as Map<string, Road>;
  }

  findPathToNextTask(currentState: DrivingState): SearchResult {
    const remainingRoads = this.sprayManager.getRemainingTaskRoads();
    
    if (remainingRoads.length === 0) {
      return { success: false, path: [], sprayMode: 'none', endState: currentState };
    }

    let bestPath: MapPoint[] = [];
    let bestDist = Infinity;
    let bestRoadId: string | null = null;
    let bestEndState = currentState;
    let bestSprayMode: SprayMode = 'none';

    for (const roadId of remainingRoads) {
      const pathResult = this.findPathToRoad(currentState, roadId);
      if (pathResult.success) {
        const dist = this.calculatePathDistance(pathResult.path);
        if (dist < bestDist) {
          bestDist = dist;
          bestPath = pathResult.path;
          bestRoadId = roadId;
          bestEndState = pathResult.endState;
          bestSprayMode = this.sprayManager.getSprayModeForTask(roadId, pathResult.endState.heading);
        }
      }
    }

    if (!bestRoadId || bestPath.length < 2) {
      return { success: false, path: [], sprayMode: 'none', endState: currentState };
    }

    return {
      success: true,
      path: bestPath,
      sprayMode: bestSprayMode,
      endState: bestEndState
    };
  }

  private findPathToRoad(currentState: DrivingState, targetRoadId: string): { success: boolean; path: MapPoint[]; endState: DrivingState } {
    const road = this.allRoads.get(targetRoadId);
    if (!road) {
      return { success: false, path: [], endState: currentState };
    }

    const points = road.points.map(p => p.map_xy);
    let nearestIdx = 0;
    let minDist = Infinity;

    for (let i = 0; i < points.length; i++) {
      const d = distance(currentState.position, points[i]);
      if (d < minDist) {
        minDist = d;
        nearestIdx = i;
      }
    }

    const targetPoint = points[nearestIdx];
    const heading = Math.atan2(targetPoint.y - currentState.position.y, targetPoint.x - currentState.position.x);

    const path = [currentState.position, targetPoint];

    return {
      success: true,
      path: path,
      endState: {
        intersectionId: '',
        position: targetPoint,
        heading: heading
      }
    };
  }

  private calculatePathDistance(path: MapPoint[]): number {
    let dist = 0;
    for (let i = 1; i < path.length; i++) {
      dist += distance(path[i - 1], path[i]);
    }
    return dist;
  }

  planReturnToSupply(currentState: DrivingState, supplyPos: MapPoint, supplyHeading: number): MapPoint[] {
    const path = [currentState.position, supplyPos];
    return path;
  }
}