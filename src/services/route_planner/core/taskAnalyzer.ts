/**
 * 任务分析器 - 分析选中梁位，提取需要喷淋的路段任务
 */

import { 
  BeamPosition, 
  SprayRequirement,
  SprayRequirementType,
  Road,
  Intersection
} from '../types';

export interface TaskAnalysisResult {
  requirements: Map<string, SprayRequirement>;
  taskRoads: string[];
  beams: BeamPosition[];
}

export class TaskAnalyzer {
  private allBeams: BeamPosition[] = [];
  private selectedBeamIds: Set<string> = new Set();

  /**
   * 设置所有梁位数据
   */
  setBeams(beams: BeamPosition[]): void {
    this.allBeams = beams;
  }

  /**
   * 设置选中的梁位
   */
  setSelectedBeams(beamIds: string[]): void {
    this.selectedBeamIds = new Set(beamIds);
  }

  /**
   * 分析选中的梁位，生成喷淋任务列表
   */
  analyze(): TaskAnalysisResult {
    const requirements = new Map<string, SprayRequirement>();
    const beams = this.allBeams.filter(b => this.selectedBeamIds.has(b.id));
    const taskRoads: string[] = [];

    console.log(`[TaskAnalyzer] 分析 ${beams.length} 个选中梁位`);

    for (const beam of beams) {
      const boundaries = beam.boundaries;
      const sides: Array<keyof typeof boundaries> = ['north', 'south', 'east', 'west'];

      for (const side of sides) {
        const roadId = boundaries[side];
        if (!roadId) continue;

        if (!requirements.has(roadId)) {
          requirements.set(roadId, {
            roadId,
            type: 'single',
            beams: [beam.id],
            targetSides: new Set(),
            completed: false
          });
          taskRoads.push(roadId);
        }

        const req = requirements.get(roadId)!;
        
        if (!req.beams.includes(beam.id)) {
          req.beams.push(beam.id);
        }

        const isDual = this.checkIfDualSide(roadId, side, beam.id);
        if (isDual && req.type === 'single') {
          req.type = 'dual';
          console.log(`[TaskAnalyzer] 道路 ${roadId.slice(0,15)} 为双侧喷淋(dual)`);
        }

        const sideDirection = this.getSideDirection(side);
        req.targetSides.add(sideDirection);
      }
    }

    console.log(`[TaskAnalyzer] 分析完成: ${requirements.size} 条任务道路`);
    for (const [roadId, req] of requirements) {
      console.log(`[TaskAnalyzer]   ${roadId.slice(0,15)}: ${req.type}, 梁位=${req.beams.join(',')}, 侧=${Array.from(req.targetSides).join(',')}`);
    }

    return { requirements, taskRoads, beams };
  }

  /**
   * 获取边界对应的喷淋侧
   */
  private getSideDirection(boundary: 'north' | 'south' | 'east' | 'west'): 'left' | 'right' {
    switch (boundary) {
      case 'north': return 'right';
      case 'south': return 'left';
      case 'east': return 'right';
      case 'west': return 'left';
    }
  }

  /**
   * 检查道路是否需要双侧喷淋
   * 只有当道路两侧都有梁位时才需要双侧喷淋
   * 单行相邻梁位（东西/南北）各喷单侧，不是双侧
   */
  private checkIfDualSide(roadId: string, side: 'north'|'south'|'east'|'west', currentBeamId: string): boolean {
    const currentBeam = this.allBeams.find(b => b.id === currentBeamId);
    if (!currentBeam) return false;

    const currentPos = currentBeam.center;
    let targetPos: { x: number; y: number } | null = null;

    switch (side) {
      case 'north': targetPos = { x: currentPos.x, y: currentPos.y + 2 }; break;
      case 'south': targetPos = { x: currentPos.x, y: currentPos.y - 2 }; break;
      case 'east': targetPos = { x: currentPos.x + 2, y: currentPos.y }; break;
      case 'west': targetPos = { x: currentPos.x - 2, y: currentPos.y }; break;
    }

    if (!targetPos) return false;

    let hasBeamOnBothSides = false;
    for (const beam of this.allBeams) {
      if (!this.selectedBeamIds.has(beam.id) || beam.id === currentBeamId) continue;

      const beamPos = beam.center;
      const isOnSameRoad = 
        (side === 'north' || side === 'south') && Math.abs(beamPos.x - currentPos.x) < 2 &&
        (side === 'north' && beamPos.y > currentPos.y || side === 'south' && beamPos.y < currentPos.y) ||
        (side === 'east' || side === 'west') && Math.abs(beamPos.y - currentPos.y) < 2 &&
        (side === 'east' && beamPos.x > currentPos.x || side === 'west' && beamPos.x < currentPos.x);

      if (isOnSameRoad) {
        hasBeamOnBothSides = true;
        break;
      }
    }

    return hasBeamOnBothSides;
  }

  /**
   * 检查道路是否为共享边界（两个选中梁位之间）
   */
  isSharedBoundary(roadId: string): boolean {
    const beam = this.allBeams.find(b => 
      b.boundaries.north === roadId ||
      b.boundaries.south === roadId ||
      b.boundaries.east === roadId ||
      b.boundaries.west === roadId
    );
    if (!beam || !beam.neighbors) return false;

    const neighbors = Object.values(beam.neighbors).filter(Boolean);
    return neighbors.some(nid => this.selectedBeamIds.has(nid));
  }
}