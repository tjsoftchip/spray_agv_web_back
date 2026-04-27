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

    // 第1遍：计算基础喷淋模式
    const baseModes: SprayMode[] = [];
    for (const edge of edges) {
      const isFirstVisit = !!edge.taskGroupId && !completedTaskGroups.has(edge.taskGroupId);
      baseModes.push(this.determineSprayMode(edge, isFirstVisit));
      if (isFirstVisit && edge.taskGroupId) {
        completedTaskGroups.add(edge.taskGroupId);
      }
    }

    // 第2遍：圆弧继承相邻喷淋段的模式
    const finalModes = [...baseModes];
    for (let i = 0; i < edges.length; i++) {
      if (edges[i].type === EdgeType.INTERNAL_ARC && finalModes[i] === SprayMode.OFF) {
        // 优先用下一段的模式（确保进入下个梁区时喷淋已就位）
        const nextMode = i < edges.length - 1 ? baseModes[i + 1] : SprayMode.OFF;
        const prevMode = i > 0 ? finalModes[i - 1] : SprayMode.OFF;
        if (nextMode !== SprayMode.OFF) {
          finalModes[i] = nextMode;
        } else if (prevMode !== SprayMode.OFF) {
          finalModes[i] = prevMode;
        }
      }
    }

    // 直线入口补偿：第一个喷淋段的前一段如果不是圆弧，也设为喷淋
    const firstSprayIdx = finalModes.findIndex(m => m !== SprayMode.OFF);
    if (firstSprayIdx > 0 && edges[firstSprayIdx - 1].type !== EdgeType.INTERNAL_ARC) {
      finalModes[firstSprayIdx - 1] = finalModes[firstSprayIdx];
    }

    // 第3遍：用调整后的模式生成轨迹点
    for (let i = 0; i < edges.length; i++) {
      const sprayMode = finalModes[i];

      for (let j = 0; j < edges[i].points.length; j++) {
        const pt = edges[i].points[j];
        let yaw = 0;
        if (j < edges[i].points.length - 1) {
          const next = edges[i].points[j + 1];
          yaw = Math.atan2(next.y - pt.y, next.x - pt.x);
        } else if (j > 0) {
          const prev = edges[i].points[j - 1];
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

      totalLength += edges[i].length;
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
