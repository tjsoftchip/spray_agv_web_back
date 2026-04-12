/**
 * 喷淋状态管理器 - 基于任务的喷淋状态追踪（兼容新版 + 向后兼容）
 */

import { SprayMode, BeamPosition, SprayRequirement, SprayRequirementType } from '../types';

export class SprayStatusManager {
  private taskRequirements: Map<string, SprayRequirement> = new Map();
  private completedTasks: Set<string> = new Set();
  private allBeams: BeamPosition[] = [];
  private selectedBeams = new Set<string>();
  private roadSprayRecord = new Map<string, { beamIds: Set<string>, spraySides: Set<string> }>();

  setAllBeams(beams: BeamPosition[]): void {
    this.allBeams = beams;
  }

  setSelectedBeams(beamIds: string[]): void {
    this.selectedBeams = new Set(beamIds);
  }

  reset(): void {
    this.taskRequirements.clear();
    this.completedTasks.clear();
    this.selectedBeams.clear();
    this.roadSprayRecord.clear();
  }

  setRequirements(requirements: Map<string, SprayRequirement>): void {
    this.taskRequirements = requirements;
  }

  markTaskCompleted(roadId: string): void {
    const req = this.taskRequirements.get(roadId);
    if (req) {
      req.completed = true;
      this.completedTasks.add(roadId);
      console.log(`[SprayStatusManager] 任务完成: ${roadId.slice(0,15)}, type=${req.type}`);
    }
  }

  isTaskCompleted(roadId: string): boolean {
    return this.completedTasks.has(roadId);
  }

  getTasksCount(): number {
    return this.taskRequirements.size;
  }

  getCompletedCount(): number {
    return this.completedTasks.size;
  }

  hasRemainingTasks(): boolean {
    return this.completedTasks.size < this.taskRequirements.size;
  }

  getRemainingTaskRoads(): string[] {
    const remaining: string[] = [];
    for (const [roadId, req] of this.taskRequirements) {
      if (!req.completed) {
        remaining.push(roadId);
      }
    }
    return remaining;
  }

  getSprayModeForTask(roadId: string, currentHeading: number): SprayMode {
    const req = this.taskRequirements.get(roadId);
    if (!req || req.completed) {
      return 'none';
    }

    if (req.type === 'dual') {
      return 'both';
    }

    const targetSide = this.determineSideFromRequirements(req, currentHeading);
    return targetSide;
  }

  getSprayMode(roadId: string, beamId: string, travelDir: string): SprayMode {
    const req = this.taskRequirements.get(roadId);
    if (!req || req.completed) {
      return 'none';
    }

    if (req.type === 'dual') {
      return 'both';
    }

    return 'right_only';
  }

  recordSpray(roadId: string, beamId: string, spraySides: 'left' | 'right' | 'both'): void {
    if (!this.roadSprayRecord.has(roadId)) {
      this.roadSprayRecord.set(roadId, { beamIds: new Set(), spraySides: new Set() });
    }
    const record = this.roadSprayRecord.get(roadId)!;
    record.beamIds.add(beamId);
    record.spraySides.add(spraySides);
  }

  isFullySprayed(roadId: string): boolean {
    if (this.taskRequirements.size > 0) {
      return this.completedTasks.has(roadId);
    }
    return false;
  }

  isSharedRoad(roadId: string): boolean {
    return this.roadSprayRecord.has(roadId) || this.completedTasks.has(roadId);
  }

  private determineSideFromRequirements(req: SprayRequirement, heading: number): SprayMode {
    const sides = Array.from(req.targetSides);
    if (sides.length === 0) return 'right_only';
    
    const normalizedHeading = ((heading % (2 * Math.PI)) + (2 * Math.PI));
    const halfPi = Math.PI / 2;
    
    for (const side of sides) {
      let sideHeading: number;
      if (side === 'right') {
        sideHeading = heading + halfPi;
      } else {
        sideHeading = heading - halfPi;
      }
      
      while (sideHeading < 0) sideHeading += 2 * Math.PI;
      while (sideHeading >= 2 * Math.PI) sideHeading -= 2 * Math.PI;

      const headingDiff = Math.abs(heading - sideHeading);
      if (headingDiff < halfPi || headingDiff > 3 * halfPi) {
        return side === 'right' ? 'right_only' : 'left_only';
      }
    }

    return 'right_only';
  }
}