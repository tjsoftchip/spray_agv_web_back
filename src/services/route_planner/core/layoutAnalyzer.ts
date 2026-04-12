/**
 * 布局分析器 - 分析梁位布局结构
 */

import { 
  BeamPosition, 
  BeamLayout, 
  MapPoint,
  Road,
  Intersection,
  TurnArc
} from '../types';

export class LayoutAnalyzer {
  private beams: BeamPosition[] = [];
  private rows: Map<string, BeamPosition[]> = new Map();

  /**
   * 分析梁位布局
   */
  analyze(beams: BeamPosition[]): BeamLayout {
    this.beams = beams;
    this.buildRows();
    
    const columnCounts = Array.from(this.rows.values()).map(r => r.length);
    
    const adjacencyMap = this.buildAdjacencyMap(beams);
    
    // 检测是否是实际连续行（不管row字段是什么，只要全部横向相邻）
    let isActualSingleRow = false;
    if (beams.length > 1) {
      // 检查是否所有梁位都在横向相邻链上
      const sorted = [...beams].sort((a, b) => a.center.x - b.center.x);
      isActualSingleRow = true;
      for (let i = 0; i < sorted.length - 1; i++) {
        const neighbors = adjacencyMap.get(sorted[i].id) || [];
        if (!neighbors.includes(sorted[i + 1].id)) {
          isActualSingleRow = false;
          break;
        }
      }
    }

    return {
      beams,
      rowCount: this.rows.size,
      columnCounts,
      isSingleBeam: beams.length === 1,
      isSingleRow: (this.rows.size === 1 || isActualSingleRow) && beams.length > 1,
      isSingleColumn: beams.every(b => (this.rows.get(b.row)?.length ?? 0) === 1),
      isGrid: this.rows.size > 1 && columnCounts.every(c => c > 1),
      adjacencyMap,
      rows: this.rows
    };
  }

  /**
   * 按行分组
   */
  private buildRows(): void {
    this.rows.clear();
    
    for (const beam of this.beams) {
      const rowKey = beam.row;
      if (!this.rows.has(rowKey)) {
        this.rows.set(rowKey, []);
      }
      this.rows.get(rowKey)!.push(beam);
    }
    
    // 每行内按列排序
    for (const [_, rowBeams] of this.rows) {
      rowBeams.sort((a, b) => a.col - b.col);
    }
  }

  /**
   * 构建邻接关系图
   */
  private buildAdjacencyMap(beams: BeamPosition[]): Map<string, string[]> {
    const adjacencyMap = new Map<string, string[]>();
    
    for (const beam of beams) {
      const neighbors: string[] = [];
      const n = beam.neighbors || {};
      
      if (n.left && beams.some(b => b.id === n.left)) neighbors.push(n.left);
      if (n.right && beams.some(b => b.id === n.right)) neighbors.push(n.right);
      if (n.top && beams.some(b => b.id === n.top)) neighbors.push(n.top);
      if (n.bottom && beams.some(b => b.id === n.bottom)) neighbors.push(n.bottom);
      
      adjacencyMap.set(beam.id, neighbors);
    }
    
    return adjacencyMap;
  }

  /**
   * 判断是否为单行布局
   */
  isSingleRow(layout: BeamLayout): boolean {
    return layout.isSingleRow;
  }

  /**
   * 判断是否为单列布局
   */
  isSingleColumn(layout: BeamLayout): boolean {
    return layout.isSingleColumn;
  }

  /**
   * 判断是否为网格布局
   */
  isGrid(layout: BeamLayout): boolean {
    return layout.isGrid;
  }

  /**
   * 判断是否适合S形路线
   * 条件：单行且至少2个梁位
   */
  isZigzagApplicable(layout: BeamLayout): boolean {
    return layout.isSingleRow && layout.beams.length >= 2;
  }

  /**
   * 判断是否适合连续行优化路线
   * 条件：单行且全部连续相邻
   */
  isContinuousRowApplicable(layout: BeamLayout): boolean {
    if (!layout.isSingleRow || layout.beams.length < 2) {
      return false;
    }

    // 检查是否全部连续相邻
    const sorted = [...layout.beams].sort((a, b) => a.center.x - b.center.x);
    for (let i = 0; i < sorted.length - 1; i++) {
      const neighbors = layout.adjacencyMap.get(sorted[i].id) || [];
      if (!neighbors.includes(sorted[i + 1].id)) {
        return false;
      }
    }

    return true;
  }

  /**
   * 获取行中心
   */
  getRowCenter(rowBeams: BeamPosition[]): MapPoint {
    const sumX = rowBeams.reduce((sum, b) => sum + b.center.x, 0);
    const sumY = rowBeams.reduce((sum, b) => sum + b.center.y, 0);
    return { x: sumX / rowBeams.length, y: sumY / rowBeams.length };
  }

  /**
   * 获取所有行
   */
  getRows(): Map<string, BeamPosition[]> {
    return this.rows;
  }

  /**
   * 获取指定行的梁位
   */
  getRowBeams(rowKey: string): BeamPosition[] {
    return this.rows.get(rowKey) || [];
  }

  /**
   * 按行中心距离排序
   */
  sortRowsByDistance(
    rows: Map<string, BeamPosition[]>, 
    referencePoint: MapPoint
  ): Array<[string, BeamPosition[]]> {
    return Array.from(rows.entries()).sort((a, b) => {
      const centerA = this.getRowCenter(a[1]);
      const centerB = this.getRowCenter(b[1]);
      const distA = Math.sqrt(Math.pow(centerA.x - referencePoint.x, 2) + Math.pow(centerA.y - referencePoint.y, 2));
      const distB = Math.sqrt(Math.pow(centerB.x - referencePoint.x, 2) + Math.pow(centerB.y - referencePoint.y, 2));
      return distA - distB;
    });
  }
}