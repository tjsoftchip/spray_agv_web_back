/**
 * 喷淋状态管理器（重构版）
 * 显式记录喷淋状态，支持跨阶段连续性
 */

import { SprayMode, BeamPosition } from '../types';

interface SprayRecord {
  beamIds: Set<string>;
  spraySides: Set<'left' | 'right' | 'both'>;
}

export class SprayStatusManager {
  // 道路喷淋记录：roadId -> { 被哪些梁位访问, 喷淋了哪些侧 }
  private roadSprayRecord = new Map<string, SprayRecord>();
  
  // 当前选中的梁位ID集合
  private selectedBeams = new Set<string>();
  
  // 已完全喷淋的边界道路集合
  private fullySprayedRoads = new Set<string>();
  
  // 所有梁位数据（用于判断边界道路）
  private allBeams: BeamPosition[] = [];

  /**
   * 设置所有梁位数据（用于边界判断）
   */
  setAllBeams(beams: BeamPosition[]): void {
    this.allBeams = beams;
  }

  /**
   * 设置当前选中的梁位
   */
  setSelectedBeams(beamIds: string[]): void {
    this.selectedBeams = new Set(beamIds);
  }

  /**
   * 重置状态（开始新任务时调用）
   */
  reset(): void {
    this.roadSprayRecord.clear();
    this.selectedBeams.clear();
    this.fullySprayedRoads.clear();
  }

  /**
   * 显式记录道路被喷淋
   * @param roadId 道路ID
   * @param beamId 访问的梁位ID
   * @param spraySides 喷淋了哪一侧（'left' | 'right' | 'both'）
   */
  recordSpray(roadId: string, beamId: string, spraySides: 'left' | 'right' | 'both'): void {
    if (!this.roadSprayRecord.has(roadId)) {
      this.roadSprayRecord.set(roadId, {
        beamIds: new Set(),
        spraySides: new Set(),
      });
    }
    
    const record = this.roadSprayRecord.get(roadId)!;
    record.beamIds.add(beamId);
    record.spraySides.add(spraySides);
    
    // 注意：对于共享边界道路，每个梁位都需要喷淋双侧
    // 不要在这里标记为完全喷淋，让 getSprayMode 来判断
    // 如果是 'both' 模式，后续梁位仍需要喷淋双侧
    
    console.log(`[SprayStatusManager] 记录喷淋: road=${roadId.slice(0,15)}, beam=${beamId}, sides=${spraySides}, 已喷淋梁位=${Array.from(record.beamIds).join(',')}`);
  }

  /**
   * 获取喷淋模式
   * @param roadId 道路ID
   * @param beamId 当前梁位ID
   * @param travelDir 行驶方向
   */
  getSprayMode(roadId: string, beamId: string, travelDir: string): SprayMode {
    const record = this.roadSprayRecord.get(roadId);
    
    // 判断是否为边界道路（需要双侧喷淋）
    // 边界道路：两个梁位分居道路两侧（东西相邻）
    const isBoundary = this.isBoundaryRoad(roadId, beamId);
    
    // 检查当前梁位是否已喷过
    if (record && record.beamIds.has(beamId)) {
      console.log(`[SprayStatusManager] 梁位 ${beamId} 已喷过此道路，跳过`);
      return 'none';
    }
    
    // 边界道路的喷淋逻辑：
    // - 每个梁位只喷自己这一侧（不是双侧）
    // - 第一个梁位喷右侧（或左侧，取决于行驶方向）
    // - 第二个梁位喷另一侧
    // 这样两次访问就能覆盖双侧
    if (isBoundary) {
      // 确定喷哪一侧：根据行驶方向
      // 如果道路在车辆右侧，喷右侧；如果在左侧，喷左侧
      const spraySide = this.getSpraySideForBoundary(roadId, beamId, travelDir);
      console.log(`[SprayStatusManager] 边界道路 ${roadId.slice(0,15)}, 梁位 ${beamId}, 喷淋侧: ${spraySide}, 行驶方向: ${travelDir}`);
      return spraySide;
    }
    
    // 非边界道路：只喷右侧
    return 'right_only';
  }

  /**
   * 获取边界道路的喷淋侧
   */
  private getSpraySideForBoundary(roadId: string, beamId: string, travelDir: string): SprayMode {
    // 找到当前梁位，确定道路相对于梁位的位置
    const currentBeam = this.allBeams.find(b => b.id === beamId);
    if (!currentBeam) return 'right_only';
    
    // 判断道路是当前梁位的哪个边界
    if (currentBeam.boundaries.east === roadId) {
      // 道路在梁位东侧
      // 顺时针绕行时，从北向南走（travelDir=south），道路在左侧 → 喷左侧
      // 逆时针时，从南向北走（travelDir=north），道路在右侧 → 喷右侧
      // 但这里是顺时针，我们看east boundary的实际行驶方向
      if (travelDir === 'south') return 'left_only';  // 从北向南，道路在左
      if (travelDir === 'north') return 'right_only'; // 从南向北，道路在右
    } else if (currentBeam.boundaries.west === roadId) {
      // 道路在梁位西侧
      // 顺时针绕行时，从南向北走（travelDir=north），道路在左侧 → 喷左侧
      // 从北向南走（travelDir=south），道路在右侧 → 喷右侧
      if (travelDir === 'north') return 'left_only';  // 从南向北，道路在左
      if (travelDir === 'south') return 'right_only'; // 从北向南，道路在右
    } else if (currentBeam.boundaries.north === roadId) {
      // 道路在梁位北侧
      if (travelDir === 'east') return 'right_only';  // 从西向东，道路在右
      if (travelDir === 'west') return 'left_only';   // 从东向西，道路在左
    } else if (currentBeam.boundaries.south === roadId) {
      // 道路在梁位南侧
      if (travelDir === 'west') return 'right_only';  // 从东向西，道路在右
      if (travelDir === 'east') return 'left_only';   // 从西向东，道路在左
    }
    
    return 'right_only';
  }

  /**
   * 记录边界道路（用于判断是否为边界道路）
   * @param roadId 道路ID
   * @param leftBeamId 左侧梁位ID
   * @param rightBeamId 右侧梁位ID
   */
  registerBoundaryRoad(roadId: string, leftBeamId: string, rightBeamId: string): void {
    // 边界道路信息存储在选中梁位关系中，这里只需要标记
    // 实际的边界判断在 isBoundaryRoad 中动态计算
    console.log(`[SprayStatusManager] 注册边界道路: ${roadId.slice(0,15)}, left=${leftBeamId}, right=${rightBeamId}`);
  }

  /**
   * 判断是否为边界道路
   * 边界道路：两个梁位分居道路两侧（如 AB_21.east = BC_21.west）
   * 需要两个梁位都在选中的梁位列表中
   */
  private isBoundaryRoad(roadId: string, beamId: string): boolean {
    // 找到当前梁位
    const currentBeam = this.allBeams.find(b => b.id === beamId);
    if (!currentBeam) return false;
    
    // 检查道路是否为此梁位的边界
    let neighborBeamId: string | undefined;
    
    if (currentBeam.boundaries.north === roadId && currentBeam.neighbors?.top) {
      neighborBeamId = currentBeam.neighbors.top;
    } else if (currentBeam.boundaries.south === roadId && currentBeam.neighbors?.bottom) {
      neighborBeamId = currentBeam.neighbors.bottom;
    } else if (currentBeam.boundaries.east === roadId && currentBeam.neighbors?.right) {
      neighborBeamId = currentBeam.neighbors.right;
    } else if (currentBeam.boundaries.west === roadId && currentBeam.neighbors?.left) {
      neighborBeamId = currentBeam.neighbors.left;
    }
    
    // 如果有邻居，且邻居也在选中的梁位列表中，则为边界道路
    if (neighborBeamId && this.selectedBeams.has(neighborBeamId)) {
      return true;
    }
    
    return false;
  }

  /**
   * 检查道路是否为共享道路
   */
  isSharedRoad(roadId: string): boolean {
    return this.roadSprayRecord.has(roadId);
  }

  /**
   * 检查道路是否已完全喷淋
   */
  isFullySprayed(roadId: string): boolean {
    return this.fullySprayedRoads.has(roadId);
  }

  /**
   * 获取道路的喷淋记录
   */
  getRecord(roadId: string): SprayRecord | undefined {
    return this.roadSprayRecord.get(roadId);
  }

  /**
   * 标记道路为完全喷淋
   */
  markFullySprayed(roadId: string): void {
    this.fullySprayedRoads.add(roadId);
  }

  /**
   * 检查特定梁位是否已喷淋过该道路
   */
  hasBeamSprayed(roadId: string, beamId: string): boolean {
    const record = this.roadSprayRecord.get(roadId);
    return record ? record.beamIds.has(beamId) : false;
  }
}