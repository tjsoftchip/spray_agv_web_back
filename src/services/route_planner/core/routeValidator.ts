/**
 * 路线验证器 - 验证路线合法性
 */

import { 
  RouteSegment, 
  Waypoint, 
  BeamPosition,
  MapPoint
} from '../types';
import { distance, angleDifference, isUTurn, isReversing } from '../utils';

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  type: string;
  message: string;
  segmentId?: string;
  waypointIndex?: number;
}

export interface ValidationWarning {
  type: string;
  message: string;
  segmentId?: string;
}

export class RouteValidator {
  /**
   * 验证路线完整性
   */
  validate(segments: RouteSegment[], beams?: BeamPosition[]): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // 1. 验证线路连续性
    this.validateContinuity(segments, errors);

    // 2. 验证无倒车
    this.validateNoReversing(segments, errors);

    // 3. 验证无掉头
    this.validateNoUTurn(segments, errors);

    // 4. 验证转弯走预设弧线
    this.validateTurnArcs(segments, errors);

    // 5. 验证喷淋完整性（如果提供了梁位信息）
    if (beams) {
      this.validateSprayCoverage(segments, beams, errors, warnings);
    }

    // 6. 验证yaw角范围
    this.validateYawRange(segments, errors);

    // 7. 验证路段首尾相连
    this.validateSegmentConnections(segments, errors);

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * 验证线路连续性
   */
  private validateContinuity(segments: RouteSegment[], errors: ValidationError[]): void {
    for (let i = 0; i < segments.length - 1; i++) {
      const currentSeg = segments[i];
      const nextSeg = segments[i + 1];

      const endPoint = currentSeg.waypoints[currentSeg.waypoints.length - 1];
      const startPoint = nextSeg.waypoints[0];

      const dist = distance(endPoint, startPoint);
      if (dist > 0.5) {
        errors.push({
          type: 'DISCONTINUITY',
          message: `路段 ${currentSeg.id} → ${nextSeg.id} 不连续，距离: ${dist.toFixed(2)}m`,
          segmentId: currentSeg.id
        });
      }
    }
  }

  /**
   * 验证无倒车
   */
  private validateNoReversing(segments: RouteSegment[], errors: ValidationError[]): void {
    for (let i = 0; i < segments.length - 1; i++) {
      const currentSeg = segments[i];
      const nextSeg = segments[i + 1];

      // 获取当前段最后一个yaw和下一段第一个yaw
      const currentYaw = currentSeg.waypoints[currentSeg.waypoints.length - 1].yaw;
      const nextYaw = nextSeg.waypoints[0].yaw;

      if (isReversing(currentYaw, nextYaw)) {
        errors.push({
          type: 'REVERSING',
          message: `路段 ${currentSeg.id} → ${nextSeg.id} 存在倒车行为`,
          segmentId: currentSeg.id
        });
      }
    }
  }

  /**
   * 验证无掉头
   */
  private validateNoUTurn(segments: RouteSegment[], errors: ValidationError[]): void {
    for (let i = 0; i < segments.length - 1; i++) {
      const currentSeg = segments[i];
      const nextSeg = segments[i + 1];

      const currentYaw = currentSeg.waypoints[currentSeg.waypoints.length - 1].yaw;
      const nextYaw = nextSeg.waypoints[0].yaw;

      if (isUTurn(currentYaw, nextYaw)) {
        errors.push({
          type: 'UTURN',
          message: `路段 ${currentSeg.id} → ${nextSeg.id} 存在掉头行为`,
          segmentId: currentSeg.id
        });
      }
    }
  }

  /**
   * 验证转弯走预设弧线
   */
  private validateTurnArcs(segments: RouteSegment[], errors: ValidationError[]): void {
    for (let i = 0; i < segments.length - 1; i++) {
      const currentSeg = segments[i];
      const nextSeg = segments[i + 1];

      // 检查连续两个直线路段之间是否缺少转弯弧
      if (currentSeg.type === 'road' && nextSeg.type === 'road') {
        const currentYaw = currentSeg.waypoints[currentSeg.waypoints.length - 1].yaw;
        const nextYaw = nextSeg.waypoints[0].yaw;
        const diff = Math.abs(angleDifference(currentYaw, nextYaw));

        // 如果方向变化超过45度但不是转弯弧段，发出警告
        const nextType = (nextSeg as any).type;
        if (diff > Math.PI / 4 && nextType !== 'turn_arc') {
          errors.push({
            type: 'MISSING_TURN_ARC',
            message: `路段 ${currentSeg.id} → ${nextSeg.id} 转弯角度${(diff * 180 / Math.PI).toFixed(1)}°，缺少转弯弧线`,
            segmentId: currentSeg.id
          });
        }
      }
    }
  }

  /**
   * 验证喷淋完整性（含双侧喷淋）
   */
  private validateSprayCoverage(
    segments: RouteSegment[], 
    beams: BeamPosition[],
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    const coveredBoundaries = new Map<string, Set<string>>();
    const dualSprayRoads = new Set<string>();
    
    for (const seg of segments) {
      if (seg.spray_mode === 'both') {
        if (seg.road_id) {
          dualSprayRoads.add(seg.road_id);
        }
      }
      
      if (seg.spray_mode !== 'none') {
        if (!coveredBoundaries.has(seg.beam_id || 'unknown')) {
          coveredBoundaries.set(seg.beam_id || 'unknown', new Set());
        }
        if (seg.side) {
          coveredBoundaries.get(seg.beam_id || 'unknown')!.add(seg.side);
        }
      }
    }

    if (dualSprayRoads.size > 0) {
      console.log(`[RouteValidator] 检测到 ${dualSprayRoads.size} 条共享边使用双侧喷淋`);
    }

    const expectedSides = ['west', 'north', 'east', 'south'];
    for (const beam of beams) {
      const covered = coveredBoundaries.get(beam.id) || new Set();
      const missing = expectedSides.filter(s => !covered.has(s));
      
      if (missing.length > 0) {
        warnings.push({
          type: 'INCOMPLETE_SPRAY',
          message: `梁位 ${beam.id} 缺少边界喷淋: ${missing.join(', ')}`,
        });
      }
    }
  }

  /**
   * 验证yaw角范围
   */
  private validateYawRange(segments: RouteSegment[], errors: ValidationError[]): void {
    for (const seg of segments) {
      for (let i = 0; i < seg.waypoints.length; i++) {
        const wp = seg.waypoints[i];
        if (wp.yaw < 0 || wp.yaw >= 2 * Math.PI) {
          errors.push({
            type: 'INVALID_YAW',
            message: `路段 ${seg.id} 航点 ${i} yaw角未归一化: ${wp.yaw.toFixed(4)}`,
            segmentId: seg.id,
            waypointIndex: i
          });
        }
      }
    }
  }

  /**
   * 验证路段首尾相连
   */
  private validateSegmentConnections(segments: RouteSegment[], errors: ValidationError[]): void {
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      const nextSeg = segments[i + 1];
      
      const segEnd = seg.waypoints[seg.waypoints.length - 1];
      const nextStart = nextSeg.waypoints[0];
      
      const dist = distance(segEnd, nextStart);
      if (dist > 0.3) {
        errors.push({
          type: 'GAP',
          message: `路段间隙: ${seg.id} 终点 (${segEnd.x.toFixed(2)}, ${segEnd.y.toFixed(2)}) 与 ${nextSeg.id} 起点 (${nextStart.x.toFixed(2)}, ${nextStart.y.toFixed(2)}) 距离 ${dist.toFixed(3)}m`,
          segmentId: seg.id
        });
      }
    }
  }

  /**
   * 计算路线总长度
   */
  calculateTotalLength(segments: RouteSegment[]): number {
    let length = 0;
    for (const seg of segments) {
      for (let i = 0; i < seg.waypoints.length - 1; i++) {
        length += distance(seg.waypoints[i], seg.waypoints[i + 1]);
      }
    }
    return length;
  }

  /**
   * 计算喷淋长度
   */
  calculateSprayLength(segments: RouteSegment[]): number {
    let length = 0;
    for (const seg of segments) {
      if (seg.spray_mode !== 'none') {
        for (let i = 0; i < seg.waypoints.length - 1; i++) {
          length += distance(seg.waypoints[i], seg.waypoints[i + 1]);
        }
      }
    }
    return length;
  }
}