/**
 * GPS建图核心服务
 * 实现文档 web-gps-mapping-design.md 中定义的核心算法
 */

import { GPSPoint, MapPoint, Road, RoadPoint, Intersection, TurnPath, BeamPosition } from '../models/GPSMap';

// UTM转换器（使用现有实现）
import { UTMConverter } from './utmConverter';

const utmConverter = new UTMConverter();

/**
 * 坐标转换服务
 */
export class CoordinateService {
  private origin: { latitude: number; longitude: number; rotation: number };
  private utmOrigin: { zone: number; easting: number; northing: number };

  constructor(origin?: { latitude: number; longitude: number; rotation: number }) {
    this.origin = origin || { latitude: 0, longitude: 0, rotation: 0 };
    if (origin && origin.latitude !== 0) {
      const utm = utmConverter.toUTM(origin.latitude, origin.longitude);
      this.utmOrigin = utm;
    } else {
      this.utmOrigin = { zone: 50, easting: 0, northing: 0 };
    }
  }

  setOrigin(latitude: number, longitude: number, rotation: number = 0) {
    this.origin = { latitude, longitude, rotation };
    this.utmOrigin = utmConverter.toUTM(latitude, longitude);
  }

  getOrigin() {
    return this.origin;
  }

  getUTMOrigin() {
    return this.utmOrigin;
  }

  /**
   * GPS坐标转UTM坐标
   */
  toUTM(latitude: number, longitude: number): { zone: number; easting: number; northing: number } {
    return utmConverter.toUTM(latitude, longitude);
  }

  /**
   * GPS坐标转地图坐标
   */
  gpsToMap(latitude: number, longitude: number): MapPoint {
    const utm = utmConverter.toUTM(latitude, longitude);
    
    // 相对原点偏移
    const dx = utm.easting - this.utmOrigin.easting;
    const dy = utm.northing - this.utmOrigin.northing;
    
    // 应用旋转变换
    const cos = Math.cos(this.origin.rotation);
    const sin = Math.sin(this.origin.rotation);
    
    return {
      x: dx * cos - dy * sin,
      y: dx * sin + dy * cos
    };
  }

  /**
   * 地图坐标转GPS坐标
   */
  mapToGPS(x: number, y: number): GPSPoint {
    // 逆旋转变换
    const cos = Math.cos(-this.origin.rotation);
    const sin = Math.sin(-this.origin.rotation);
    
    const dx = x * cos - y * sin;
    const dy = x * sin + y * cos;
    
    // 加上原点UTM坐标
    const utm = {
      zone: this.utmOrigin.zone,
      easting: this.utmOrigin.easting + dx,
      northing: this.utmOrigin.northing + dy
    };
    
    return utmConverter.toLatLon(utm);
  }
}

/**
 * 交叉点自动识别服务
 * 检测横纵道路的交叉点
 * 
 * V2 改进：
 * 1. 使用线段相交算法替代点对距离算法
 * 2. 支持路线端点延长查找交叉点
 * 3. 支持路线拉直预处理
 */
export class IntersectionDetector {
  private distanceThreshold: number; // 交叉点识别距离阈值（米）
  private extensionDistance: number; // 路线延长距离（米）
  private enableExtension: boolean;  // 是否启用路线延长
  private enableStraighten: boolean; // 是否启用路线拉直

  constructor(distanceThreshold: number = 5.0, extensionDistance: number = 2.0) {
    this.distanceThreshold = distanceThreshold;
    this.extensionDistance = extensionDistance;
    this.enableExtension = true;
    this.enableStraighten = true;
  }

  /**
   * 检测所有交叉点
   */
  detectIntersections(roads: Road[]): Intersection[] {
    const intersections: Intersection[] = [];
    const longitudinalRoads = roads.filter(r => r.type === 'longitudinal');
    const horizontalRoads = roads.filter(r => r.type === 'horizontal');

    // 遍历每条纵向道路和横向道路的组合
    for (const longRoad of longitudinalRoads) {
      for (const horRoad of horizontalRoads) {
        const foundIntersections = this.findAllIntersections(longRoad, horRoad);
        for (const intersection of foundIntersections) {
          // 检查是否已经存在相近的交叉点
          if (!this.isNearExistingIntersection(intersection, intersections)) {
            intersections.push(intersection);
          }
        }
      }
    }

    return intersections;
  }

  /**
   * 找到两条道路的所有交叉点（使用线段相交算法）
   * V2: 支持线段延长和插值计算
   */
  private findAllIntersections(longRoad: Road, horRoad: Road): Intersection[] {
    const intersections: Intersection[] = [];

    // 可选：先对路线进行拉直处理
    const longPoints = this.enableStraighten 
      ? this.straightenRoadPoints(longRoad) 
      : longRoad.points;
    const horPoints = this.enableStraighten 
      ? this.straightenRoadPoints(horRoad) 
      : horRoad.points;

    if (longPoints.length < 2 || horPoints.length < 2) {
      return intersections;
    }

    // 构建线段列表（可选延长）
    const longSegments = this.buildSegments(longPoints, this.enableExtension);
    const horSegments = this.buildSegments(horPoints, this.enableExtension);

    // 遍历所有线段对，检测相交
    for (let i = 0; i < longSegments.length; i++) {
      const longSeg = longSegments[i];
      
      for (let j = 0; j < horSegments.length; j++) {
        const horSeg = horSegments[j];
        
        // 使用线段相交算法
        const intersectionPoint = this.lineSegmentIntersection(
          longSeg.start, longSeg.end,
          horSeg.start, horSeg.end
        );

        if (intersectionPoint) {
          // 插值计算GPS坐标
          const gpsPoint = this.interpolateGPS(
            intersectionPoint,
            longSeg, horSeg
          );

          intersections.push({
            id: `intersection_${longRoad.id}_${horRoad.id}_${i}_${j}`,
            type: 'cross',
            center: {
              gps: gpsPoint,
              mapXy: intersectionPoint
            },
            connectedRoads: [longRoad.id, horRoad.id]
          });
        }
      }
    }

    return intersections;
  }

  /**
   * 线段相交算法
   * 计算两条线段的交点
   */
  private lineSegmentIntersection(
    p1: MapPoint, p2: MapPoint,
    p3: MapPoint, p4: MapPoint
  ): MapPoint | null {
    const d1x = p2.x - p1.x;
    const d1y = p2.y - p1.y;
    const d2x = p4.x - p3.x;
    const d2y = p4.y - p3.y;

    const cross = d1x * d2y - d1y * d2x;

    // 平行或共线
    if (Math.abs(cross) < 1e-10) {
      return null;
    }

    const dx = p3.x - p1.x;
    const dy = p3.y - p1.y;

    const t = (dx * d2y - dy * d2x) / cross;
    const u = (dx * d1y - dy * d1x) / cross;

    // 检查交点是否在两条线段上（包括延长部分）
    // 使用一个小的容差来处理延长的情况
    const tolerance = this.enableExtension ? 0.5 : 0.0;
    
    if (t >= -tolerance && t <= 1 + tolerance && u >= -tolerance && u <= 1 + tolerance) {
      return {
        x: p1.x + t * d1x,
        y: p1.y + t * d1y
      };
    }

    return null;
  }

  /**
   * 构建线段列表（支持端点延长）
   */
  private buildSegments(points: RoadPoint[], extend: boolean): Array<{
    start: MapPoint;
    end: MapPoint;
    startGPS: GPSPoint;
    endGPS: GPSPoint;
    startIndex: number;
    endIndex: number;
  }> {
    const segments: Array<{
      start: MapPoint;
      end: MapPoint;
      startGPS: GPSPoint;
      endGPS: GPSPoint;
      startIndex: number;
      endIndex: number;
    }> = [];

    for (let i = 0; i < points.length - 1; i++) {
      const start = points[i];
      const end = points[i + 1];

      segments.push({
        start: start.mapXy,
        end: end.mapXy,
        startGPS: start.gps,
        endGPS: end.gps,
        startIndex: i,
        endIndex: i + 1
      });
    }

    // 延长路线两端
    if (extend && points.length >= 2) {
      // 延长起点
      const first = points[0];
      const second = points[1];
      const dx = second.mapXy.x - first.mapXy.x;
      const dy = second.mapXy.y - first.mapXy.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      
      if (len > 0) {
        const extendRatio = this.extensionDistance / len;
        segments.unshift({
          start: {
            x: first.mapXy.x - dx * extendRatio,
            y: first.mapXy.y - dy * extendRatio
          },
          end: first.mapXy,
          startGPS: {
            latitude: first.gps.latitude - (second.gps.latitude - first.gps.latitude) * extendRatio,
            longitude: first.gps.longitude - (second.gps.longitude - first.gps.longitude) * extendRatio,
            altitude: first.gps.altitude
          },
          endGPS: first.gps,
          startIndex: -1, // 延长段标记
          endIndex: 0
        });
      }

      // 延长终点
      const last = points[points.length - 1];
      const secondLast = points[points.length - 2];
      const dx2 = last.mapXy.x - secondLast.mapXy.x;
      const dy2 = last.mapXy.y - secondLast.mapXy.y;
      const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
      
      if (len2 > 0) {
        const extendRatio2 = this.extensionDistance / len2;
        segments.push({
          start: last.mapXy,
          end: {
            x: last.mapXy.x + dx2 * extendRatio2,
            y: last.mapXy.y + dy2 * extendRatio2
          },
          startGPS: last.gps,
          endGPS: {
            latitude: last.gps.latitude + (last.gps.latitude - secondLast.gps.latitude) * extendRatio2,
            longitude: last.gps.longitude + (last.gps.longitude - secondLast.gps.longitude) * extendRatio2,
            altitude: last.gps.altitude
          },
          startIndex: points.length - 1,
          endIndex: -1 // 延长段标记
        });
      }
    }

    return segments;
  }

  /**
   * 路线拉直处理（使用直线拟合）
   */
  private straightenRoadPoints(road: Road): RoadPoint[] {
    const points = road.points;
    if (points.length < 3) {
      return points;
    }

    // 使用最小二乘法拟合直线
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (const pt of points) {
      sumX += pt.mapXy.x;
      sumY += pt.mapXy.y;
      sumXY += pt.mapXy.x * pt.mapXy.y;
      sumX2 += pt.mapXy.x * pt.mapXy.x;
    }

    const n = points.length;
    const meanX = sumX / n;
    const meanY = sumY / n;

    // 计算直线方向
    let dirX = 1, dirY = 0;
    if (road.type === 'longitudinal') {
      // 纵向道路：主要沿Y轴方向
      dirX = 0;
      dirY = 1;
    } else {
      // 横向道路：主要沿X轴方向
      dirX = 1;
      dirY = 0;
    }

    // 计算投影点（简化：直接投影到主轴）
    const straightenedPoints: RoadPoint[] = points.map((pt, idx) => {
      if (road.type === 'longitudinal') {
        // 纵向：保持Y，X取平均
        return {
          ...pt,
          mapXy: {
            x: meanX,
            y: pt.mapXy.y
          }
        };
      } else {
        // 横向：保持X，Y取平均
        return {
          ...pt,
          mapXy: {
            x: pt.mapXy.x,
            y: meanY
          }
        };
      }
    });

    return straightenedPoints;
  }

  /**
   * 插值计算GPS坐标
   */
  private interpolateGPS(
    mapPoint: MapPoint,
    longSeg: { startGPS: GPSPoint; endGPS: GPSPoint; start: MapPoint; end: MapPoint },
    horSeg: { startGPS: GPSPoint; endGPS: GPSPoint; start: MapPoint; end: MapPoint }
  ): GPSPoint {
    // 从纵向线段插值
    const longT = this.calculateInterpolationFactor(mapPoint, longSeg.start, longSeg.end);
    const longGPS = this.interpolateGPSPoint(longSeg.startGPS, longSeg.endGPS, longT);

    // 从横向线段插值
    const horT = this.calculateInterpolationFactor(mapPoint, horSeg.start, horSeg.end);
    const horGPS = this.interpolateGPSPoint(horSeg.startGPS, horSeg.endGPS, horT);

    // 取两者的平均值
    return {
      latitude: (longGPS.latitude + horGPS.latitude) / 2,
      longitude: (longGPS.longitude + horGPS.longitude) / 2,
      altitude: (longGPS.altitude + horGPS.altitude) / 2
    };
  }

  /**
   * 计算插值因子
   */
  private calculateInterpolationFactor(point: MapPoint, start: MapPoint, end: MapPoint): number {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len2 = dx * dx + dy * dy;
    
    if (len2 < 1e-10) return 0;
    
    return ((point.x - start.x) * dx + (point.y - start.y) * dy) / len2;
  }

  /**
   * 插值GPS点
   */
  private interpolateGPSPoint(start: GPSPoint, end: GPSPoint, t: number): GPSPoint {
    return {
      latitude: start.latitude + t * (end.latitude - start.latitude),
      longitude: start.longitude + t * (end.longitude - start.longitude),
      altitude: start.altitude + t * (end.altitude - start.altitude)
    };
  }

  /**
   * 检查是否接近已存在的交叉点
   */
  private isNearExistingIntersection(
    newIntersection: Intersection,
    existingIntersections: Intersection[]
  ): boolean {
    for (const existing of existingIntersections) {
      const dist = this.distance(
        newIntersection.center.mapXy,
        existing.center.mapXy
      );
      if (dist < this.distanceThreshold * 2) {
        return true;
      }
    }
    return false;
  }

  private distance(p1: MapPoint, p2: MapPoint): number {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
  }
}

/**
 * 梁位自动识别与编号服务
 * 根据交叉点围成的区域自动生成梁位
 */
export class BeamPositionGenerator {
  private coordinateService: CoordinateService;

  constructor(coordinateService: CoordinateService) {
    this.coordinateService = coordinateService;
  }

  /**
   * 根据交叉点自动生成梁位
   * 算法：横纵交错的四个交叉点包围的区域就是梁位
   */
  generateBeamPositions(
    intersections: Intersection[],
    roads: Road[]
  ): BeamPosition[] {
    const beamPositions: BeamPosition[] = [];
    
    // 按位置对交叉点分组
    const sortedIntersections = this.sortIntersectionsByGrid(intersections, roads);
    
    if (sortedIntersections.rows === 0 || sortedIntersections.cols === 0) {
      return beamPositions;
    }

    // 获取网格行列数
    const rows = sortedIntersections.rows;
    const cols = sortedIntersections.cols;
    const grid = sortedIntersections.grid;

    // 行标签（A, B, C...）
    const rowLabels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

    // 遍历网格，每个网格单元对应一个梁位
    for (let row = 0; row < rows - 1; row++) {
      for (let col = 0; col < cols - 1; col++) {
        // 四个角的交叉点
        const topLeft = grid[row][col];
        const topRight = grid[row][col + 1];
        const bottomLeft = grid[row + 1][col];
        const bottomRight = grid[row + 1][col + 1];

        if (topLeft && topRight && bottomLeft && bottomRight) {
          // 计算梁位中心（四个交叉点的中心）
          const centerX = (topLeft.center.mapXy.x + topRight.center.mapXy.x +
                          bottomLeft.center.mapXy.x + bottomRight.center.mapXy.x) / 4;
          const centerY = (topLeft.center.mapXy.y + topRight.center.mapXy.y +
                          bottomLeft.center.mapXy.y + bottomRight.center.mapXy.y) / 4;

          // 查找对应的道路边界
          const boundaries = this.findBoundaries(roads, 
            [topLeft, topRight, bottomLeft, bottomRight], row, col, rows - 1, cols - 1);

          const beamPosition: BeamPosition = {
            id: `beam_${rowLabels[row]}${col + 1}`,
            name: `${rowLabels[row]}${col + 1}`,
            row: rowLabels[row],
            col: col + 1,
            center: { x: centerX, y: centerY },
            boundaries,
            crossPoints: [topLeft.id, topRight.id, bottomLeft.id, bottomRight.id]
          };

          beamPositions.push(beamPosition);
        }
      }
    }

    return beamPositions;
  }

  /**
   * 将交叉点按网格位置排序
   */
  private sortIntersectionsByGrid(
    intersections: Intersection[],
    roads: Road[]
  ): { rows: number; cols: number; grid: (Intersection | null)[][] } {
    if (intersections.length === 0) {
      return { rows: 0, cols: 0, grid: [] };
    }

    // 按X坐标分组（列）
    const sortedByX = [...intersections].sort((a, b) => 
      a.center.mapXy.x - b.center.mapXy.x
    );

    // 使用聚类算法确定列数
    const columnGroups = this.clusterByCoordinate(sortedByX, 'x');
    const cols = columnGroups.length;

    // 按Y坐标分组（行）
    const sortedByY = [...intersections].sort((a, b) => 
      a.center.mapXy.y - b.center.mapXy.y
    );

    // 使用聚类算法确定行数
    const rowGroups = this.clusterByCoordinate(sortedByY, 'y');
    const rows = rowGroups.length;

    // 创建网格
    const grid: (Intersection | null)[][] = [];
    for (let r = 0; r < rows; r++) {
      grid[r] = [];
      for (let c = 0; c < cols; c++) {
        grid[r][c] = null;
      }
    }

    // 填充网格
    for (const intersection of intersections) {
      const rowIndex = this.findGroupIndex(intersection, rowGroups, 'y');
      const colIndex = this.findGroupIndex(intersection, columnGroups, 'x');
      
      if (rowIndex >= 0 && rowIndex < rows && colIndex >= 0 && colIndex < cols) {
        grid[rowIndex][colIndex] = intersection;
      }
    }

    return { rows, cols, grid };
  }

  /**
   * 按坐标聚类
   */
  private clusterByCoordinate(
    intersections: Intersection[],
    coord: 'x' | 'y'
  ): Intersection[][] {
    const groups: Intersection[][] = [];
    const threshold = 10; // 聚类阈值（米）

    for (const intersection of intersections) {
      const value = intersection.center.mapXy[coord];
      
      let foundGroup = false;
      for (const group of groups) {
        const groupValue = group[0].center.mapXy[coord];
        if (Math.abs(value - groupValue) < threshold) {
          group.push(intersection);
          foundGroup = true;
          break;
        }
      }
      
      if (!foundGroup) {
        groups.push([intersection]);
      }
    }

    // 按坐标排序
    groups.sort((a, b) => 
      a[0].center.mapXy[coord] - b[0].center.mapXy[coord]
    );

    return groups;
  }

  /**
   * 查找交叉点所属的组索引
   */
  private findGroupIndex(
    intersection: Intersection,
    groups: Intersection[][],
    coord: 'x' | 'y'
  ): number {
    for (let i = 0; i < groups.length; i++) {
      if (groups[i].includes(intersection)) {
        return i;
      }
    }
    return -1;
  }

  /**
   * 查找梁位的边界道路
   */
  private findBoundaries(
    roads: Road[],
    crossPoints: Intersection[],
    row: number,
    col: number,
    maxRow: number,
    maxCol: number
  ): BeamPosition['boundaries'] {
    const boundaries: BeamPosition['boundaries'] = {};

    // 查找连接每个交叉点的道路
    for (const road of roads) {
      for (const cp of crossPoints) {
        if (cp.connectedRoads.includes(road.id)) {
          // 根据道路类型确定边界
          if (road.type === 'horizontal') {
            // 横向道路可能是北边或南边
            const roadY = road.points[0]?.mapXy.y || 0;
            const center = (crossPoints[0].center.mapXy.y + crossPoints[3].center.mapXy.y) / 2;
            if (roadY > center) {
              boundaries.north = road.id;
            } else {
              boundaries.south = road.id;
            }
          } else {
            // 纵向道路可能是东边或西边
            const roadX = road.points[0]?.mapXy.x || 0;
            const center = (crossPoints[0].center.mapXy.x + crossPoints[3].center.mapXy.x) / 2;
            if (roadX > center) {
              boundaries.east = road.id;
            } else {
              boundaries.west = road.id;
            }
          }
        }
      }
    }

    return boundaries;
  }
}

/**
 * 转弯路径生成服务
 * 为阿克曼转向车辆生成平滑的转弯路径
 */
export class TurnPathGenerator {
  private minTurnRadius: number; // 最小转弯半径（米）

  constructor(minTurnRadius: number = 4.5) {
    this.minTurnRadius = minTurnRadius;
  }

  /**
   * 生成所有转弯路径
   */
  generateTurnPaths(
    intersections: Intersection[],
    roads: Road[]
  ): TurnPath[] {
    const turnPaths: TurnPath[] = [];

    for (const intersection of intersections) {
      const connectedRoads = intersection.connectedRoads;
      
      // 为每对连接道路生成转弯路径
      for (let i = 0; i < connectedRoads.length; i++) {
        for (let j = 0; j < connectedRoads.length; j++) {
          if (i !== j) {
            const fromRoad = roads.find(r => r.id === connectedRoads[i]);
            const toRoad = roads.find(r => r.id === connectedRoads[j]);
            
            if (fromRoad && toRoad) {
              const turnPath = this.generateSingleTurnPath(
                intersection,
                fromRoad,
                toRoad
              );
              if (turnPath) {
                turnPaths.push(turnPath);
              }
            }
          }
        }
      }
    }

    return turnPaths;
  }

  /**
   * 生成单个转弯路径
   */
  private generateSingleTurnPath(
    intersection: Intersection,
    fromRoad: Road,
    toRoad: Road
  ): TurnPath | null {
    // 确定转弯方向
    const direction = this.determineTurnDirection(fromRoad, toRoad, intersection);
    
    // 计算转弯半径
    const radius = this.calculateTurnRadius(direction);
    
    // 生成圆弧路径点
    const points = this.generateArcPoints(
      intersection.center,
      fromRoad,
      toRoad,
      radius,
      direction
    );

    return {
      id: `turn_${intersection.id}_${fromRoad.id}_${toRoad.id}`,
      intersectionId: intersection.id,
      fromRoad: fromRoad.id,
      toRoad: toRoad.id,
      direction,
      radius,
      points
    };
  }

  /**
   * 确定转弯方向
   */
  private determineTurnDirection(
    fromRoad: Road,
    toRoad: Road,
    intersection: Intersection
  ): 'left' | 'right' | 'straight' | 'uturn' {
    // 如果同类型道路，可能是直行或掉头
    if (fromRoad.type === toRoad.type) {
      // 判断是直行还是掉头
      const fromDir = this.getRoadDirection(fromRoad, intersection);
      const toDir = this.getRoadDirection(toRoad, intersection);
      const angleDiff = Math.abs(fromDir - toDir);
      
      if (angleDiff < Math.PI / 4) {
        return 'straight';
      } else {
        return 'uturn';
      }
    }

    // 不同类型道路，计算转弯方向
    const fromDir = this.getRoadDirection(fromRoad, intersection);
    const toDir = this.getRoadDirection(toRoad, intersection);
    
    // 计算角度差（归一化到 -π ~ π）
    let angleDiff = toDir - fromDir;
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
    
    if (angleDiff > 0) {
      return 'left';
    } else {
      return 'right';
    }
  }

  /**
   * 获取道路在交叉点处的方向
   */
  private getRoadDirection(road: Road, intersection: Intersection): number {
    // 找到最近的道路点
    let nearestPoint = road.points[0];
    let minDist = Infinity;
    
    for (const pt of road.points) {
      const dist = Math.sqrt(
        Math.pow(pt.mapXy.x - intersection.center.mapXy.x, 2) +
        Math.pow(pt.mapXy.y - intersection.center.mapXy.y, 2)
      );
      if (dist < minDist) {
        minDist = dist;
        nearestPoint = pt;
      }
    }
    
    // 计算方向
    const dx = nearestPoint.mapXy.x - intersection.center.mapXy.x;
    const dy = nearestPoint.mapXy.y - intersection.center.mapXy.y;
    return Math.atan2(dy, dx);
  }

  /**
   * 根据转弯方向计算转弯半径
   */
  private calculateTurnRadius(direction: string): number {
    switch (direction) {
      case 'left':
        return this.minTurnRadius * 1.0;
      case 'right':
        return this.minTurnRadius * 1.2; // 右转半径稍大
      case 'uturn':
        return this.minTurnRadius * 1.5;
      default:
        return this.minTurnRadius;
    }
  }

  /**
   * 生成圆弧路径点
   */
  private generateArcPoints(
    center: { gps: GPSPoint; mapXy: MapPoint },
    fromRoad: Road,
    toRoad: Road,
    radius: number,
    direction: string
  ): TurnPath['points'] {
    const points: TurnPath['points'] = [];
    
    if (direction === 'straight') {
      // 直行：直接生成直线路径
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        points.push({
          seq: i,
          gps: {
            latitude: center.gps.latitude,
            longitude: center.gps.longitude,
            altitude: center.gps.altitude
          },
          mapXy: { x: center.mapXy.x, y: center.mapXy.y }
        });
      }
      return points;
    }

    // 计算圆弧
    const startAngle = this.getRoadDirection(fromRoad, { center } as any);
    let endAngle = this.getRoadDirection(toRoad, { center } as any);
    
    // 归一化角度
    if (direction === 'left') {
      while (endAngle < startAngle) endAngle += 2 * Math.PI;
    } else {
      while (endAngle > startAngle) endAngle -= 2 * Math.PI;
    }

    // 生成圆弧点
    const numPoints = 20;
    for (let i = 0; i <= numPoints; i++) {
      const t = i / numPoints;
      const angle = startAngle + (endAngle - startAngle) * t;
      
      const x = center.mapXy.x + radius * Math.cos(angle);
      const y = center.mapXy.y + radius * Math.sin(angle);
      
      // 简化的GPS转换（实际应该使用坐标服务）
      const lat = center.gps.latitude + y / 111000;
      const lon = center.gps.longitude + x / (111000 * Math.cos(center.gps.latitude * Math.PI / 180));
      
      points.push({
        seq: i,
        gps: {
          latitude: lat,
          longitude: lon,
          altitude: center.gps.altitude
        },
        mapXy: { x, y }
      });
    }

    return points;
  }
}

/**
 * 地图文件生成服务
 * 生成PGM、YAML、JSON等地图文件
 */
export class MapFileGenerator {
  private coordinateService: CoordinateService;

  constructor(coordinateService: CoordinateService) {
    this.coordinateService = coordinateService;
  }

  /**
   * 生成PGM地图（灰度图）
   */
  generatePGMMap(
    roads: Road[],
    intersections: Intersection[],
    beamPositions: BeamPosition[],
    resolution: number = 0.05 // 5cm per pixel
  ): { pgm: Buffer; width: number; height: number; origin: { x: number; y: number } } {
    // 计算地图边界
    const bounds = this.calculateMapBounds(roads, beamPositions);
    
    // 计算像素尺寸
    const width = Math.ceil((bounds.maxX - bounds.minX) / resolution) + 100; // 加边距
    const height = Math.ceil((bounds.maxY - bounds.minY) / resolution) + 100;
    
    // 初始化灰度数组（默认未知区域）
    const grayArray: number[] = new Array(width * height).fill(205); // 205 = 未知区域
    
    // 绘制禁区（灰度0）
    this.drawKeepoutZones(grayArray, width, height, roads, resolution, bounds);
    
    // 绘制首选路网（灰度254）
    this.drawPreferredNetwork(grayArray, width, height, roads, resolution, bounds);
    
    // 绘制高代价区（灰度150）
    this.drawHighCostZones(grayArray, width, height, roads, resolution, bounds);
    
    // 转换为PGM格式
    const pgm = this.createPGMBuffer(grayArray, width, height);
    
    return {
      pgm,
      width,
      height,
      origin: {
        x: bounds.minX - 50 * resolution,
        y: bounds.minY - 50 * resolution
      }
    };
  }

  /**
   * 计算地图边界
   */
  private calculateMapBounds(
    roads: Road[],
    beamPositions: BeamPosition[]
  ): { minX: number; maxX: number; minY: number; maxY: number } {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (const road of roads) {
      for (const pt of road.points) {
        minX = Math.min(minX, pt.mapXy.x);
        maxX = Math.max(maxX, pt.mapXy.x);
        minY = Math.min(minY, pt.mapXy.y);
        maxY = Math.max(maxY, pt.mapXy.y);
      }
    }

    for (const beam of beamPositions) {
      minX = Math.min(minX, beam.center.x - 5);
      maxX = Math.max(maxX, beam.center.x + 5);
      minY = Math.min(minY, beam.center.y - 5);
      maxY = Math.max(maxY, beam.center.y + 5);
    }

    return { minX, maxX, minY, maxY };
  }

  /**
   * 绘制禁区
   */
  private drawKeepoutZones(
    grayArray: number[],
    width: number,
    height: number,
    roads: Road[],
    resolution: number,
    bounds: { minX: number; minY: number }
  ): void {
    for (const road of roads) {
      const keepout = road.params.keepoutDistance;
      
      for (const pt of road.points) {
        // 道路两侧的禁区
        const perpX = road.type === 'longitudinal' ? 1 : 0;
        const perpY = road.type === 'horizontal' ? 1 : 0;
        
        // 左侧禁区
        for (let d = road.params.channelWidth / 2; d < road.params.channelWidth / 2 + keepout; d += resolution) {
          const x = pt.mapXy.x - perpX * d;
          const y = pt.mapXy.y - perpY * d;
          this.setPixel(grayArray, width, height, x, y, resolution, bounds, 0);
        }
        
        // 右侧禁区
        for (let d = road.params.channelWidth / 2; d < road.params.channelWidth / 2 + keepout; d += resolution) {
          const x = pt.mapXy.x + perpX * d;
          const y = pt.mapXy.y + perpY * d;
          this.setPixel(grayArray, width, height, x, y, resolution, bounds, 0);
        }
      }
    }
  }

  /**
   * 绘制首选路网
   */
  private drawPreferredNetwork(
    grayArray: number[],
    width: number,
    height: number,
    roads: Road[],
    resolution: number,
    bounds: { minX: number; minY: number }
  ): void {
    for (const road of roads) {
      const halfPreferred = road.params.preferredWidth / 2;
      
      for (const pt of road.points) {
        // 首选路网宽度
        for (let d = -halfPreferred; d <= halfPreferred; d += resolution) {
          const x = road.type === 'longitudinal' ? pt.mapXy.x : pt.mapXy.x + d;
          const y = road.type === 'horizontal' ? pt.mapXy.y : pt.mapXy.y + d;
          this.setPixel(grayArray, width, height, x, y, resolution, bounds, 254);
        }
      }
    }
  }

  /**
   * 绘制高代价区
   */
  private drawHighCostZones(
    grayArray: number[],
    width: number,
    height: number,
    roads: Road[],
    resolution: number,
    bounds: { minX: number; minY: number }
  ): void {
    for (const road of roads) {
      const halfChannel = road.params.channelWidth / 2;
      const halfPreferred = road.params.preferredWidth / 2;
      
      for (const pt of road.points) {
        // 首选路网和通道边缘之间的高代价区
        for (let d = halfPreferred; d < halfChannel; d += resolution) {
          // 左侧高代价区
          const x1 = road.type === 'longitudinal' ? pt.mapXy.x : pt.mapXy.x - d;
          const y1 = road.type === 'horizontal' ? pt.mapXy.y : pt.mapXy.y - d;
          this.setPixel(grayArray, width, height, x1, y1, resolution, bounds, 150);
          
          // 右侧高代价区
          const x2 = road.type === 'longitudinal' ? pt.mapXy.x : pt.mapXy.x + d;
          const y2 = road.type === 'horizontal' ? pt.mapXy.y : pt.mapXy.y + d;
          this.setPixel(grayArray, width, height, x2, y2, resolution, bounds, 150);
        }
      }
    }
  }

  /**
   * 设置像素值
   */
  private setPixel(
    grayArray: number[],
    width: number,
    height: number,
    x: number,
    y: number,
    resolution: number,
    bounds: { minX: number; minY: number },
    value: number
  ): void {
    const px = Math.floor((x - bounds.minX) / resolution) + 50;
    const py = height - Math.floor((y - bounds.minY) / resolution) - 50;
    
    if (px >= 0 && px < width && py >= 0 && py < height) {
      grayArray[py * width + px] = value;
    }
  }

  /**
   * 创建PGM格式Buffer
   */
  private createPGMBuffer(grayArray: number[], width: number, height: number): Buffer {
    const header = `P5\n${width} ${height}\n255\n`;
    const headerBuffer = Buffer.from(header, 'ascii');
    const dataBuffer = Buffer.from(grayArray);
    return Buffer.concat([headerBuffer, dataBuffer]);
  }

  /**
   * 生成YAML配置文件
   */
  generateYAMLConfig(
    pgmFile: string,
    resolution: number,
    origin: { x: number; y: number }
  ): string {
    return `image: ${pgmFile}
resolution: ${resolution}
origin: [${origin.x.toFixed(2)}, ${origin.y.toFixed(2)}, 0.0]
negate: 0
occupied_thresh: 0.65
free_thresh: 0.196
mode: scale
`;
  }

  /**
   * 生成gps_routes.json
   */
  generateGPSRoutesJSON(
    origin: { gps: GPSPoint; utm: { zone: number; easting: number; northing: number } },
    roads: Road[],
    intersections: Intersection[],
    turnPaths: TurnPath[]
  ): object {
    return {
      version: '1.0',
      origin: {
        gps: {
          lat: origin.gps.latitude,
          lon: origin.gps.longitude
        },
        utm: origin.utm
      },
      roads: roads.map(road => ({
        id: road.id,
        name: road.name,
        type: road.type,
        params: road.params,
        points: road.points.map(pt => ({
          seq: pt.seq,
          gps: { lat: pt.gps.latitude, lon: pt.gps.longitude },
          map_xy: pt.mapXy
        }))
      })),
      intersections: intersections.map(int => ({
        id: int.id,
        type: int.type,
        center: {
          gps: { lat: int.center.gps.latitude, lon: int.center.gps.longitude },
          map_xy: int.center.mapXy
        },
        connected_roads: int.connectedRoads
      })),
      turn_paths: turnPaths.map(tp => ({
        id: tp.id,
        intersection_id: tp.intersectionId,
        from_road: tp.fromRoad,
        to_road: tp.toRoad,
        direction: tp.direction,
        radius: tp.radius,
        points: tp.points.map(pt => ({
          seq: pt.seq,
          gps: { lat: pt.gps.latitude, lon: pt.gps.longitude },
          map_xy: pt.mapXy
        }))
      }))
    };
  }

  /**
   * 生成beam_positions.json
   */
  generateBeamPositionsJSON(beamPositions: BeamPosition[]): object {
    return {
      version: '1.0',
      positions: beamPositions.map(bp => ({
        id: bp.id,
        name: bp.name,
        row: bp.row,
        col: bp.col,
        center: bp.center,
        boundaries: bp.boundaries,
        cross_points: bp.crossPoints
      }))
    };
  }
}

/**
 * 喷淋状态判断服务
 * 根据相邻梁位自动判断喷淋状态
 */
export class SprayModeDecider {
  /**
   * 判断两个梁位是否相邻
   */
  areAdjacent(beam1: BeamPosition, beam2: BeamPosition): boolean {
    // 同行相邻（列差1）
    if (beam1.row === beam2.row && Math.abs(beam1.col - beam2.col) === 1) {
      return true;
    }
    // 同列相邻（行相邻）
    const rowLabels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const row1Idx = rowLabels.indexOf(beam1.row);
    const row2Idx = rowLabels.indexOf(beam2.row);
    if (beam1.col === beam2.col && Math.abs(row1Idx - row2Idx) === 1) {
      return true;
    }
    return false;
  }

  /**
   * 获取两个相邻梁位之间的道路
   */
  getSharedRoad(beam1: BeamPosition, beam2: BeamPosition): string | null {
    // 同行相邻：共享东侧/西侧道路
    if (beam1.row === beam2.row) {
      if (beam2.col === beam1.col + 1) {
        return beam1.boundaries.east ?? beam2.boundaries.west ?? null;
      } else if (beam1.col === beam2.col + 1) {
        return beam1.boundaries.west ?? beam2.boundaries.east ?? null;
      }
    }
    
    // 同列相邻：共享北侧/南侧道路
    const rowLabels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const row1Idx = rowLabels.indexOf(beam1.row);
    const row2Idx = rowLabels.indexOf(beam2.row);
    if (beam1.col === beam2.col) {
      if (row2Idx === row1Idx + 1) {
        return beam1.boundaries.south ?? beam2.boundaries.north ?? null;
      } else if (row1Idx === row2Idx + 1) {
        return beam1.boundaries.north ?? beam2.boundaries.south ?? null;
      }
    }
    
    return null;
  }

  /**
   * 判断道路的喷淋状态
   * @param roadId 道路ID
   * @param selectedBeamIds 用户选择的梁位ID列表
   * @param allBeamPositions 所有梁位
   */
  determineSprayMode(
    roadId: string,
    selectedBeamIds: string[],
    allBeamPositions: BeamPosition[]
  ): 'none' | 'both' | 'left_only' | 'right_only' {
    // 找到这条道路两侧的梁位
    const leftBeam = allBeamPositions.find(bp => 
      bp.boundaries.east === roadId && selectedBeamIds.includes(bp.id)
    );
    const rightBeam = allBeamPositions.find(bp => 
      bp.boundaries.west === roadId && selectedBeamIds.includes(bp.id)
    );
    const northBeam = allBeamPositions.find(bp => 
      bp.boundaries.south === roadId && selectedBeamIds.includes(bp.id)
    );
    const southBeam = allBeamPositions.find(bp => 
      bp.boundaries.north === roadId && selectedBeamIds.includes(bp.id)
    );

    const hasLeft = !!leftBeam || !!northBeam;
    const hasRight = !!rightBeam || !!southBeam;

    if (hasLeft && hasRight) {
      return 'both'; // 共享道路，双侧喷淋
    } else if (hasLeft) {
      return 'left_only';
    } else if (hasRight) {
      return 'right_only';
    } else {
      return 'none';
    }
  }

  /**
   * 生成作业线路的喷淋配置
   */
  generateSprayConfig(
    orderedBeamIds: string[],
    allBeamPositions: BeamPosition[],
    roads: Road[]
  ): Array<{ roadId: string; sprayMode: 'none' | 'both' | 'left_only' | 'right_only' }> {
    const config: Array<{ roadId: string; sprayMode: 'none' | 'both' | 'left_only' | 'right_only' }> = [];

    for (const road of roads) {
      const sprayMode = this.determineSprayMode(road.id, orderedBeamIds, allBeamPositions);
      config.push({
        roadId: road.id,
        sprayMode
      });
    }

    return config;
  }
}

// 导出所有服务
export default {
  CoordinateService,
  IntersectionDetector,
  BeamPositionGenerator,
  TurnPathGenerator,
  MapFileGenerator,
  SprayModeDecider
};
