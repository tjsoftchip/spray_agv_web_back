/**
 * 轨迹生成器 - 将边链表转为带喷淋状态的轨迹点序列
 */

import {
  DirectedEdge,
  TrajectoryPoint,
  SprayMode,
  EdgeType,
  RouteResponseData,
} from './types';

export class TrajectoryBuilder {
  build(edges: DirectedEdge[]): RouteResponseData {
    const trajectory: TrajectoryPoint[] = [];
    let seq = 0;
    let totalLength = 0;
    const completedTaskGroups = new Set<string>();

    for (const edge of edges) {
      const isFirstVisit = !!edge.taskGroupId && !completedTaskGroups.has(edge.taskGroupId);
      const sprayMode = this.determineSprayMode(edge, isFirstVisit);

      for (let i = 0; i < edge.points.length; i++) {
        const pt = edge.points[i];
        let yaw = 0;
        if (i < edge.points.length - 1) {
          const next = edge.points[i + 1];
          yaw = Math.atan2(next.y - pt.y, next.x - pt.x);
        } else if (i > 0) {
          const prev = edge.points[i - 1];
          yaw = Math.atan2(pt.y - prev.y, pt.x - prev.x);
        }
        if (yaw < 0) yaw += 2 * Math.PI;

        trajectory.push({
          seq: seq++,
          latitude: pt.latitude,
          longitude: pt.longitude,
          x: pt.x,
          y: pt.y,
          yaw: Math.round(yaw * 10000) / 10000,
          spray_mode: sprayMode,
        });
      }

      totalLength += edge.length;

      if (isFirstVisit && edge.taskGroupId) {
        completedTaskGroups.add(edge.taskGroupId);
      }
    }

    const estimatedTime = Math.ceil(totalLength / 0.4 + trajectory.length * 0.1);

    console.log(`[TrajectoryBuilder] 生成轨迹: ${trajectory.length}个点, ${totalLength.toFixed(1)}m, 预估${estimatedTime}秒`);

    return {
      total_length_meters: Math.round(totalLength * 100) / 100,
      estimated_time_seconds: estimatedTime,
      trajectory,
      segments: edges,
    };
  }

  private determineSprayMode(
    edge: DirectedEdge,
    isFirstVisit: boolean
  ): SprayMode {
    if (edge.type === EdgeType.INTERNAL_ARC || edge.type === EdgeType.STATION_LINK) {
      return SprayMode.OFF;
    }

    if (!edge.taskGroupId) {
      return edge.taskMode !== SprayMode.OFF ? edge.taskMode : SprayMode.OFF;
    }

    if (!isFirstVisit) {
      return SprayMode.OFF;
    }

    return edge.taskMode;
  }
}
