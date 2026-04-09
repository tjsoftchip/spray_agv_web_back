/**
 * 梁位顺序优化器 - 确定梁位访问顺序
 */

import { 
  BeamPosition, 
  BeamLayout, 
  MapPoint
} from '../types';
import { LayoutAnalyzer } from './layoutAnalyzer';
import { distance } from '../utils';

export class BeamSequencer {
  private layoutAnalyzer: LayoutAnalyzer;

  constructor(layoutAnalyzer: LayoutAnalyzer) {
    this.layoutAnalyzer = layoutAnalyzer;
  }

  /**
   * 确定梁位访问顺序
   */
  optimize(beams: BeamPosition[], supplyStation: MapPoint, layout: BeamLayout): BeamPosition[] {
    if (layout.isSingleBeam) {
      return beams;
    }

    if (layout.isSingleRow) {
      return this.optimizeSingleRow(beams, supplyStation);
    }

    if (layout.isSingleColumn) {
      return this.optimizeSingleColumn(beams, supplyStation);
    }

    // 多行多列：行优先策略
    return this.optimizeGrid(beams, supplyStation, layout);
  }

  /**
   * 单行优化：根据补给站位置决定遍历方向
   */
  private optimizeSingleRow(beams: BeamPosition[], supplyStation: MapPoint): BeamPosition[] {
    const sorted = [...beams].sort((a, b) => a.col - b.col);

    const rowCenterY = beams[0].center.y;
    const supplyX = supplyStation.x;
    const minX = Math.min(...beams.map(b => b.center.x));
    const maxX = Math.max(...beams.map(b => b.center.x));
    const supplyOnLeft = supplyX <= (minX + maxX) / 2;

    // 补给站在左侧，从左到右；补给站在右侧，从右到左
    if (supplyOnLeft) {
      return sorted;
    } else {
      return sorted.reverse();
    }
  }

  /**
   * 单列优化：从近到远
   */
  private optimizeSingleColumn(beams: BeamPosition[], supplyStation: MapPoint): BeamPosition[] {
    const supplyY = supplyStation.y;
    const sorted = [...beams].sort((a, b) => {
      const distA = Math.abs(a.center.y - supplyY);
      const distB = Math.abs(b.center.y - supplyY);
      return distA - distB;
    });
    return sorted;
  }

  /**
   * 多行多列优化：行优先策略
   */
  private optimizeGrid(beams: BeamPosition[], supplyStation: MapPoint, layout: BeamLayout): BeamPosition[] {
    const ordered: BeamPosition[] = [];
    const rows = layout.rows;

    // 按行中心距离补给站的远近排序
    const sortedRows = this.layoutAnalyzer.sortRowsByDistance(rows, supplyStation);

    for (const [_, rowBeams] of sortedRows) {
      // 根据补给站位置决定行内遍历方向
      const direction = this.determineRowDirection(rowBeams, supplyStation);
      if (direction === 'east-to-west') {
        ordered.push(...[...rowBeams].reverse());
      } else {
        ordered.push(...rowBeams);
      }
    }

    return ordered;
  }

  /**
   * 判断行内遍历方向
   */
  private determineRowDirection(rowBeams: BeamPosition[], supplyStation: MapPoint): 'west-to-east' | 'east-to-west' {
    const minX = Math.min(...rowBeams.map(b => b.center.x));
    const maxX = Math.max(...rowBeams.map(b => b.center.x));
    const supplyX = supplyStation.x;

    return supplyX <= (minX + maxX) / 2 ? 'west-to-east' : 'east-to-west';
  }

  /**
   * 计算梁位到补给站的距离
   */
  distanceToSupply(beam: BeamPosition, supplyPos: MapPoint): number {
    return distance(beam.center, supplyPos);
  }

  /**
   * 获取最近的梁位
   */
  findNearestBeam(beams: BeamPosition[], fromPos: MapPoint): BeamPosition {
    let nearest = beams[0];
    let minDist = distance(fromPos, beams[0].center);

    for (const beam of beams) {
      const dist = distance(fromPos, beam.center);
      if (dist < minDist) {
        minDist = dist;
        nearest = beam;
      }
    }

    return nearest;
  }
}