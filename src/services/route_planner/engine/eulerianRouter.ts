/**
 * 欧拉路由器 - 基于A*的启发式搜索
 *
 * 状态: (currentNodeId, unfinishedTaskGroupSet)
 * 代价: F = G + H
 * G: 已行驶长度 + 转弯惩罚
 * H: 剩余任务组中未覆盖边长度之和的50%
 */

import { DirectedEdge, EdgeType, SprayMode, TURN_PENALTY, STRAIGHT_PENALTY } from './types';
import { TopologyEngine } from './topologyEngine';

interface SearchState {
  nodeId: string;
  unfinishedKey: string;
  g: number;
  path: DirectedEdge[];
}

export class EulerianRouter {
  private topology: TopologyEngine;
  private maxIterations = 50000;

  constructor(topology: TopologyEngine) {
    this.topology = topology;
  }

  solve(): DirectedEdge[] {
    const taskEdges = this.topology.getTaskEdges();
    if (taskEdges.length === 0) {
      console.warn('[EulerianRouter] 无任务边');
      return [];
    }

    const taskGroupIds = new Set<string>();
    for (const edge of taskEdges) {
      if (edge.taskGroupId) {
        taskGroupIds.add(edge.taskGroupId);
      }
    }

    const startNodeId = this.topology.getStationOutNodeId();
    const endNodeId = this.topology.getStationInNodeId();

    console.log(`[EulerianRouter] 开始搜索: ${taskGroupIds.size}个任务组(${taskEdges.length}条任务边), 起点=${startNodeId}`);

    const initialKey = this.makeKey(taskGroupIds);
    const startState: SearchState = {
      nodeId: startNodeId,
      unfinishedKey: initialKey,
      g: 0,
      path: [],
    };

    const best = this.astar(startState, endNodeId, taskGroupIds);

    if (!best) {
      console.error('[EulerianRouter] 搜索失败：无法找到覆盖所有任务组的路径');
      return this.greedyFallback(taskGroupIds, startNodeId, endNodeId);
    }

    const coveredGroups = new Set<string>();
    for (const e of best.path) {
      if (e.taskGroupId) coveredGroups.add(e.taskGroupId);
    }
    console.log(`[EulerianRouter] 搜索完成: ${best.path.length}条边, ${coveredGroups.size}/${taskGroupIds.size}任务组, 长度${best.g.toFixed(1)}m`);

    return best.path;
  }

  private astar(
    start: SearchState,
    endNodeId: string,
    taskGroupIds: Set<string>
  ): SearchState | null {
    const open: SearchState[] = [start];
    const gScore = new Map<string, number>();

    let iterations = 0;
    while (open.length > 0 && iterations < this.maxIterations) {
      iterations++;

      let bestIdx = 0;
      let bestF = Infinity;
      for (let i = 0; i < open.length; i++) {
        const f = open[i].g + this.heuristic(open[i], taskGroupIds);
        if (f < bestF) {
          bestF = f;
          bestIdx = i;
        }
      }
      const current = open.splice(bestIdx, 1)[0];

      const stateKey = `${current.nodeId}|${current.unfinishedKey}`;
      const prevG = gScore.get(stateKey);
      if (prevG !== undefined && prevG <= current.g) continue;
      gScore.set(stateKey, current.g);

      const remaining = this.parseKey(current.unfinishedKey);
      if (remaining.size === 0) {
        const routeToReturn = this.bfsFind(current.nodeId, endNodeId);
        if (routeToReturn.length > 0 || current.nodeId === endNodeId) {
          current.path.push(...routeToReturn);
          current.g += routeToReturn.reduce((s, e) => s + e.length, 0);
          return current;
        }
      }

      const outEdges = this.topology.getOutEdges(current.nodeId);
      for (const edge of outEdges) {
        const newRemaining = new Set(remaining);
        if (edge.taskGroupId && remaining.has(edge.taskGroupId)) {
          newRemaining.delete(edge.taskGroupId);
        }

        const penalty = this.getTurnPenalty(edge);

        const newG = current.g + edge.length + penalty;
        const newKey = this.makeKey(newRemaining);

        const nextState: SearchState = {
          nodeId: edge.targetNodeId,
          unfinishedKey: newKey,
          g: newG,
          path: [...current.path, edge],
        };

        const nextKey = `${nextState.nodeId}|${nextState.unfinishedKey}`;
        const nextG = gScore.get(nextKey);
        if (nextG === undefined || nextG > newG) {
          open.push(nextState);
        }
      }

      if (open.length > 5000) {
        open.sort((a, b) => (a.g + this.heuristic(a, taskGroupIds)) - (b.g + this.heuristic(b, taskGroupIds)));
        open.length = 2000;
      }
    }

    console.warn(`[EulerianRouter] A*搜索耗尽迭代 (${iterations})`);
    return null;
  }

  private greedyFallback(
    taskGroupIds: Set<string>,
    startNodeId: string,
    endNodeId: string
  ): DirectedEdge[] {
    console.log('[EulerianRouter] 使用贪心回退策略');
    const path: DirectedEdge[] = [];
    const remaining = new Set(taskGroupIds);
    let currentNodeId = startNodeId;

    while (remaining.size > 0) {
      const nearestTask = this.findNearestTaskEdge(currentNodeId, remaining);
      if (!nearestTask) {
        console.warn('[EulerianRouter] 无法到达剩余任务组');
        break;
      }

      const routeToTask = this.findRouteToEdge(currentNodeId, nearestTask);
      if (routeToTask.length === 0) {
        console.warn(`[EulerianRouter] 无法到达任务边 ${nearestTask.edgeId}`);
        if (nearestTask.taskGroupId) remaining.delete(nearestTask.taskGroupId);
        continue;
      }

      path.push(...routeToTask);
      if (nearestTask.taskGroupId) remaining.delete(nearestTask.taskGroupId);
      currentNodeId = nearestTask.targetNodeId;
    }

    const routeToReturn = this.findRouteToNode(currentNodeId, endNodeId);
    path.push(...routeToReturn);

    return path;
  }

  private findNearestTaskEdge(fromNodeId: string, remaining: Set<string>): DirectedEdge | null {
    const fromNode = this.topology.getNode(fromNodeId);
    if (!fromNode) return null;

    let bestEdge: DirectedEdge | null = null;
    let bestDist = Infinity;

    for (const groupId of remaining) {
      const edges = this.topology.getAllEdges().filter(e => e.taskGroupId === groupId);
      for (const edge of edges) {
        const sourceNode = this.topology.getNode(edge.sourceNodeId);
        if (!sourceNode) continue;
        const dist = Math.abs(fromNode.position.x - sourceNode.position.x) + Math.abs(fromNode.position.y - sourceNode.position.y);
        if (dist < bestDist) {
          bestDist = dist;
          bestEdge = edge;
        }
      }
    }

    return bestEdge;
  }

  private findRouteToEdge(fromNodeId: string, targetEdge: DirectedEdge): DirectedEdge[] {
    return this.bfsFind(fromNodeId, targetEdge.sourceNodeId);
  }

  private findRouteToNode(fromNodeId: string, targetNodeId: string): DirectedEdge[] {
    return this.bfsFind(fromNodeId, targetNodeId);
  }

  private bfsFind(fromNodeId: string, targetNodeId: string): DirectedEdge[] {
    if (fromNodeId === targetNodeId) return [];
    const visited = new Set<string>();
    const queue: Array<{ nodeId: string; path: DirectedEdge[] }> = [{ nodeId: fromNodeId, path: [] }];

    while (queue.length > 0) {
      const { nodeId, path } = queue.shift()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      if (nodeId === targetNodeId) return path;

      for (const edge of this.topology.getOutEdges(nodeId)) {
        if (!visited.has(edge.targetNodeId)) {
          queue.push({ nodeId: edge.targetNodeId, path: [...path, edge] });
        }
      }
    }

    return [];
  }

  private heuristic(state: SearchState, taskGroupIds: Set<string>): number {
    const remaining = this.parseKey(state.unfinishedKey);
    if (remaining.size === 0) return 0;

    const node = this.topology.getNode(state.nodeId);
    if (!node) return 999;

    let minDist = Infinity;
    let remainingLength = 0;
    const seenGroups = new Set<string>();

    for (const edge of this.topology.getAllEdges()) {
      if (!edge.taskGroupId || !remaining.has(edge.taskGroupId)) continue;
      if (seenGroups.has(edge.taskGroupId)) continue;
      seenGroups.add(edge.taskGroupId);
      remainingLength += edge.length;

      const sourceNode = this.topology.getNode(edge.sourceNodeId);
      if (sourceNode) {
        const dist = Math.abs(node.position.x - sourceNode.position.x) + Math.abs(node.position.y - sourceNode.position.y);
        if (dist < minDist) minDist = dist;
      }
    }

    return minDist * 0.5 + remainingLength * 0.5;
  }

  private getTurnPenalty(edge: DirectedEdge): number {
    if (edge.type !== EdgeType.INTERNAL_ARC) return STRAIGHT_PENALTY;
    if (edge.edgeId.startsWith('uturn_')) return TURN_PENALTY * 50;
    if (edge.edgeId.startsWith('straight_')) return TURN_PENALTY * 2;
    if (edge.edgeId.startsWith('cross_')) return TURN_PENALTY * 2;
    return TURN_PENALTY;
  }

  private makeKey(ids: Set<string>): string {
    return Array.from(ids).sort().join(',');
  }

  private parseKey(key: string): Set<string> {
    if (!key) return new Set();
    return new Set(key.split(',').filter(Boolean));
  }
}
