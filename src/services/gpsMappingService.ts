/**
 * GPS建图核心服务
 * 实现文档 web-gps-mapping-design.md 中定义的核心算法
 * 
 * V3.0 更新：
 * - 使用膨胀法生成地图
 * - 十字路口4圆弧转弯算法
 * - 直行线路自动生成
 */

import { GPSPoint, MapPoint, Road, RoadPoint, Intersection, TurnPath, BeamPosition, TurnArc, TurnArcPoint, StraightPath, StraightPathPoint, MapStatistics } from '../models/GPSMap';

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
 * V3 改进：
 * 1. 使用线段相交算法替代点对距离算法
 * 2. 支持路线端点延长查找交叉点
 * 3. 支持路线拉直预处理
 * 4. 支持无限延长模式：两条接近的垂直路线自动延长到相交
 * 5. 增大延长容差，支持更大的延长距离
 */
export class IntersectionDetector {
  private distanceThreshold: number; // 交叉点识别距离阈值（米）
  private extensionDistance: number; // 路线延长距离（米）
  private enableExtension: boolean;  // 是否启用路线延长
  private enableStraighten: boolean; // 是否启用路线拉直
  private enableInfiniteExtension: boolean; // 是否启用无限延长模式
  private maxExtensionDistance: number; // 最大延长距离（米）
  private extensionTolerance: number; // 延长容差比例

  constructor(distanceThreshold: number = 5.0, extensionDistance: number = 10.0) {
    this.distanceThreshold = distanceThreshold;
    this.extensionDistance = extensionDistance;
    this.enableExtension = true;
    this.enableStraighten = true;
    this.enableInfiniteExtension = true; // 默认启用无限延长
    this.maxExtensionDistance = 50.0; // 最大延长50米
    this.extensionTolerance = 2.0; // 延长容差200%（线段长度的2倍）
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
   * V3: 增加端点接近检测，支持无限延长模式
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

    // V3新增：无限延长模式 - 检测两条路线是否可以通过延长相交
    if (this.enableInfiniteExtension && intersections.length === 0) {
      const extendedIntersection = this.findExtendedIntersection(
        longPoints, horPoints, longRoad.id, horRoad.id
      );
      if (extendedIntersection) {
        intersections.push(extendedIntersection);
      }
    }

    return intersections;
  }

  /**
   * V3新增：检测两条路线是否可以通过延长相交
   * 用于处理两条接近的垂直路线，它们的端点很接近但没有实际相交
   */
  private findExtendedIntersection(
    longPoints: RoadPoint[],
    horPoints: RoadPoint[],
    longRoadId: string,
    horRoadId: string
  ): Intersection | null {
    // 获取纵向路线的首尾点（用于计算直线方向）
    const longFirst = longPoints[0];
    const longLast = longPoints[longPoints.length - 1];
    
    // 获取横向路线的首尾点
    const horFirst = horPoints[0];
    const horLast = horPoints[horPoints.length - 1];

    // 计算纵向路线的直线方向（使用首尾点）
    const longDir = {
      x: longLast.mapXy.x - longFirst.mapXy.x,
      y: longLast.mapXy.y - longFirst.mapXy.y
    };
    const longLen = Math.sqrt(longDir.x * longDir.x + longDir.y * longDir.y);
    if (longLen < 0.1) return null;
    longDir.x /= longLen;
    longDir.y /= longLen;

    // 计算横向路线的直线方向
    const horDir = {
      x: horLast.mapXy.x - horFirst.mapXy.x,
      y: horLast.mapXy.y - horFirst.mapXy.y
    };
    const horLen = Math.sqrt(horDir.x * horDir.x + horDir.y * horDir.y);
    if (horLen < 0.1) return null;
    horDir.x /= horLen;
    horDir.y /= horLen;

    // 使用无限长直线计算交点
    const intersection = this.lineLineIntersection(
      longFirst.mapXy, longDir,
      horFirst.mapXy, horDir
    );

    if (!intersection) return null;

    // 检查交点到两条路线的距离是否在合理范围内
    const distToLong = this.distanceToLine(intersection, longFirst.mapXy, longLast.mapXy);
    const distToHor = this.distanceToLine(intersection, horFirst.mapXy, horLast.mapXy);

    // 如果交点距离两条路线都在允许范围内，则接受
    const maxDist = Math.min(this.maxExtensionDistance, this.distanceThreshold * 2);
    if (distToLong <= maxDist && distToHor <= maxDist) {
      // 检查交点是否在路线的延长范围内
      const longProj = this.projectPointToLine(intersection, longFirst.mapXy, longLast.mapXy);
      const horProj = this.projectPointToLine(intersection, horFirst.mapXy, horLast.mapXy);

      // 交点投影必须在路线延长范围内
      const longExtendOk = longProj.t >= -this.extensionTolerance && longProj.t <= 1 + this.extensionTolerance;
      const horExtendOk = horProj.t >= -this.extensionTolerance && horProj.t <= 1 + this.extensionTolerance;

      if (longExtendOk && horExtendOk) {
        // 插值计算GPS坐标
        const gpsPoint = this.interpolateExtendedGPS(
          intersection,
          longFirst, longLast,
          horFirst, horLast
        );

        return {
          id: `intersection_extended_${longRoadId}_${horRoadId}`,
          type: 'cross',
          center: {
            gps: gpsPoint,
            mapXy: intersection
          },
          connectedRoads: [longRoadId, horRoadId]
        };
      }
    }

    return null;
  }

  /**
   * 计算两条无限长直线的交点
   */
  private lineLineIntersection(
    p1: MapPoint, d1: { x: number; y: number },
    p2: MapPoint, d2: { x: number; y: number }
  ): MapPoint | null {
    const cross = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(cross) < 1e-10) return null; // 平行

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const t = (dx * d2.y - dy * d2.x) / cross;

    return {
      x: p1.x + t * d1.x,
      y: p1.y + t * d1.y
    };
  }

  /**
   * 计算点到线段的距离
   */
  private distanceToLine(point: MapPoint, lineStart: MapPoint, lineEnd: MapPoint): number {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const len2 = dx * dx + dy * dy;
    
    if (len2 < 1e-10) {
      return Math.sqrt(
        Math.pow(point.x - lineStart.x, 2) +
        Math.pow(point.y - lineStart.y, 2)
      );
    }

    const t = Math.max(0, Math.min(1, 
      ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / len2
    ));

    const projX = lineStart.x + t * dx;
    const projY = lineStart.y + t * dy;

    return Math.sqrt(
      Math.pow(point.x - projX, 2) +
      Math.pow(point.y - projY, 2)
    );
  }

  /**
   * 投影点到线段，返回投影点和参数t
   */
  private projectPointToLine(point: MapPoint, lineStart: MapPoint, lineEnd: MapPoint): { point: MapPoint; t: number } {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const len2 = dx * dx + dy * dy;
    
    if (len2 < 1e-10) {
      return { point: lineStart, t: 0 };
    }

    const t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / len2;
    return {
      point: {
        x: lineStart.x + t * dx,
        y: lineStart.y + t * dy
      },
      t
    };
  }

  /**
   * 为延长交点插值GPS坐标
   */
  private interpolateExtendedGPS(
    intersection: MapPoint,
    longFirst: RoadPoint, longLast: RoadPoint,
    horFirst: RoadPoint, horLast: RoadPoint
  ): GPSPoint {
    // 计算交点在纵向路线上的投影
    const longProj = this.projectPointToLine(intersection, longFirst.mapXy, longLast.mapXy);
    const longGPS = this.interpolateGPSPoint(longFirst.gps, longLast.gps, longProj.t);

    // 计算交点在横向路线上的投影
    const horProj = this.projectPointToLine(intersection, horFirst.mapXy, horLast.mapXy);
    const horGPS = this.interpolateGPSPoint(horFirst.gps, horLast.gps, horProj.t);

    // 取两者的平均值
    return {
      latitude: (longGPS.latitude + horGPS.latitude) / 2,
      longitude: (longGPS.longitude + horGPS.longitude) / 2,
      altitude: (longGPS.altitude + horGPS.altitude) / 2
    };
  }

  /**
   * 线段相交算法
   * 计算两条线段的交点
   * V3: 支持无限延长模式，自动延长到相交为止
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

    // 计算线段长度
    const seg1Len = Math.sqrt(d1x * d1x + d1y * d1y);
    const seg2Len = Math.sqrt(d2x * d2x + d2y * d2y);

    // 检查交点是否在两条线段上（包括延长部分）
    if (this.enableInfiniteExtension) {
      // 无限延长模式：只要交点在合理范围内就接受
      // 计算交点到线段的距离
      const distFromSeg1 = Math.abs(t) * seg1Len; // 交点距离线段1起点的距离
      const distFromSeg2 = Math.abs(u) * seg2Len; // 交点距离线段2起点的距离
      
      // 检查延长距离是否在允许范围内
      const maxExtend1 = Math.min(this.maxExtensionDistance, seg1Len * this.extensionTolerance);
      const maxExtend2 = Math.min(this.maxExtensionDistance, seg2Len * this.extensionTolerance);
      
      // 交点必须在合理范围内（不能太远）
      const tMin = -maxExtend1 / seg1Len;
      const tMax = 1 + maxExtend1 / seg1Len;
      const uMin = -maxExtend2 / seg2Len;
      const uMax = 1 + maxExtend2 / seg2Len;
      
      if (t >= tMin && t <= tMax && u >= uMin && u <= uMax) {
        return {
          x: p1.x + t * d1x,
          y: p1.y + t * d1y
        };
      }
    } else if (this.enableExtension) {
      // 普通延长模式：使用延长容差
      const tolerance = this.extensionTolerance;
      
      if (t >= -tolerance && t <= 1 + tolerance && u >= -tolerance && u <= 1 + tolerance) {
        return {
          x: p1.x + t * d1x,
          y: p1.y + t * d1y
        };
      }
    } else {
      // 不延长：严格检查交点在线段上
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
        return {
          x: p1.x + t * d1x,
          y: p1.y + t * d1y
        };
      }
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
   * V2: 根据实际行驶路线方向拉直，而不是强制正南正北
   * 
   * 算法：
   * 1. 计算道路首尾点连线方向（或最小二乘法拟合）
   * 2. 将所有点投影到该直线上
   */
  private straightenRoadPoints(road: Road): RoadPoint[] {
    const points = road.points;
    if (points.length < 3) {
      return points;
    }

    // 计算道路的实际方向（使用首尾点连线）
    const first = points[0];
    const last = points[points.length - 1];
    
    const dx = last.mapXy.x - first.mapXy.x;
    const dy = last.mapXy.y - first.mapXy.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    
    if (length < 0.1) {
      // 首尾点太近，返回原点
      return points;
    }

    // 计算单位方向向量（主方向）
    const dirX = dx / length;
    const dirY = dy / length;

    // 计算垂直方向向量
    const perpX = -dirY;
    const perpY = dirX;

    // 计算道路中心点
    let sumX = 0, sumY = 0;
    for (const pt of points) {
      sumX += pt.mapXy.x;
      sumY += pt.mapXy.y;
    }
    const meanX = sumX / points.length;
    const meanY = sumY / points.length;

    // 计算所有点在垂直方向的偏移平均值
    let avgPerpOffset = 0;
    for (const pt of points) {
      const perpOffset = (pt.mapXy.x - meanX) * perpX + (pt.mapXy.y - meanY) * perpY;
      avgPerpOffset += perpOffset;
    }
    avgPerpOffset /= points.length;

    // 计算直线的基准点（中心点投影到直线上）
    const baseX = meanX + perpX * avgPerpOffset;
    const baseY = meanY + perpY * avgPerpOffset;

    // 将所有点投影到直线上
    const straightenedPoints: RoadPoint[] = points.map((pt, idx) => {
      // 计算点在主方向上的投影距离
      const projDist = (pt.mapXy.x - first.mapXy.x) * dirX + (pt.mapXy.y - first.mapXy.y) * dirY;
      
      // 计算投影后的坐标
      const projX = first.mapXy.x + projDist * dirX + perpX * avgPerpOffset;
      const projY = first.mapXy.y + projDist * dirY + perpY * avgPerpOffset;

      return {
        ...pt,
        mapXy: {
          x: projX,
          y: projY
        }
      };
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
   * 拉直道路点（将道路点投影到首尾连线上）
   */
  private straightenRoadPoints(road: Road): RoadPoint[] {
    const points = road.points;
    if (points.length < 3) {
      return points;
    }

    // 计算道路的实际方向（使用首尾点连线）
    const first = points[0];
    const last = points[points.length - 1];
    
    const dx = last.mapXy.x - first.mapXy.x;
    const dy = last.mapXy.y - first.mapXy.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    
    if (length < 0.1) {
      return points;
    }

    // 计算单位方向向量（主方向）
    const dirX = dx / length;
    const dirY = dy / length;

    // 计算垂直方向向量
    const perpX = -dirY;
    const perpY = dirX;

    // 计算道路中心点
    let sumX = 0, sumY = 0;
    for (const pt of points) {
      sumX += pt.mapXy.x;
      sumY += pt.mapXy.y;
    }
    const meanX = sumX / points.length;
    const meanY = sumY / points.length;

    // 计算所有点在垂直方向的偏移平均值
    let avgPerpOffset = 0;
    for (const pt of points) {
      const perpOffset = (pt.mapXy.x - meanX) * perpX + (pt.mapXy.y - meanY) * perpY;
      avgPerpOffset += perpOffset;
    }
    avgPerpOffset /= points.length;

    // 将所有点投影到直线上
    const straightenedPoints: RoadPoint[] = points.map((pt, idx) => {
      // 计算点在主方向上的投影距离
      const projDist = (pt.mapXy.x - first.mapXy.x) * dirX + (pt.mapXy.y - first.mapXy.y) * dirY;
      
      // 计算投影后的坐标
      const projX = first.mapXy.x + projDist * dirX + perpX * avgPerpOffset;
      const projY = first.mapXy.y + projDist * dirY + perpY * avgPerpOffset;

      return {
        ...pt,
        mapXy: {
          x: projX,
          y: projY
        }
      };
    });

    return straightenedPoints;
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
   * V2: 改进逻辑，只为每个交叉点生成合理的转弯路径
   * - 不再生成双向重复路径
   * - 根据道路方向确定最佳转弯方向
   * - 支持路线拉直后的转弯计算
   */
  generateTurnPaths(
    intersections: Intersection[],
    roads: Road[]
  ): TurnPath[] {
    const turnPaths: TurnPath[] = [];

    for (const intersection of intersections) {
      const connectedRoadIds = intersection.connectedRoads;
      
      if (connectedRoadIds.length < 2) continue;
      
      // 获取连接的道路
      const connectedRoads = connectedRoadIds
        .map(id => roads.find(r => r.id === id))
        .filter((r): r is Road => r !== undefined);

      if (connectedRoads.length < 2) continue;

      // 分析交叉点处的道路方向，确定合理的转弯组合
      const turnCombinations = this.analyzeTurnCombinations(
        intersection,
        connectedRoads
      );

      // 只生成必要的转弯路径
      for (const combo of turnCombinations) {
        const turnPath = this.generateSingleTurnPath(
          intersection,
          combo.fromRoad,
          combo.toRoad,
          combo.direction
        );
        if (turnPath) {
          turnPaths.push(turnPath);
        }
      }
    }

    return turnPaths;
  }

  /**
   * 分析交叉点处的转弯组合
   * V4: 按路口类型生成转弯路径
   * 
   * 路口分类：
   * - L型路口：2条道路交叉，2个方向，2条转弯路径
   * - T型路口：2条道路交叉，3个方向，4条转弯路径
   * - 十字型路口：2条道路交叉，4个方向，8条转弯路径
   * 
   * 判断依据：
   * - 每条道路有两个端点，如果端点在交叉点附近，则该方向是尽头（不可通行）
   * - 统计可通行方向数来确定路口类型
   */
  private analyzeTurnCombinations(
    intersection: Intersection,
    connectedRoads: Road[]
  ): { fromRoad: Road; toRoad: Road; direction: 'left' | 'right' | 'straight' | 'uturn' }[] {
    const combinations: { fromRoad: Road; toRoad: Road; direction: 'left' | 'right' | 'straight' | 'uturn' }[] = [];

    if (connectedRoads.length !== 2) {
      // 只处理2条道路交叉的情况
      return combinations;
    }

    const [road1, road2] = connectedRoads;

    // 分析每条道路的可通行方向
    const road1Directions = this.analyzeRoadDirections(road1, intersection);
    const road2Directions = this.analyzeRoadDirections(road2, intersection);

    // 合并所有可通行方向
    const allDirections = [
      ...road1Directions.map(d => ({ ...d, road: road1 })),
      ...road2Directions.map(d => ({ ...d, road: road2 }))
    ];

    // 计算总的可通行方向数
    const totalDirections = allDirections.length;

    // 根据路口类型生成转弯路径
    if (totalDirections === 2) {
      // L型路口：2个方向，2条转弯路径
      return this.generateLTypeTurns(allDirections, intersection);
    } else if (totalDirections === 3) {
      // T型路口：3个方向，4条转弯路径
      return this.generateTTypeTurns(allDirections, intersection, road1, road2);
    } else if (totalDirections === 4) {
      // 十字型路口：4个方向，8条转弯路径
      return this.generateCrossTypeTurns(allDirections, intersection, road1, road2);
    }

    return combinations;
  }

  /**
   * 分析道路在交叉点处的可通行方向
   * 返回可通行的方向列表（每个方向包含角度和是否为正向）
   */
  private analyzeRoadDirections(
    road: Road,
    intersection: Intersection
  ): { angle: number; isForward: boolean }[] {
    const directions: { angle: number; isForward: boolean }[] = [];
    
    if (road.points.length < 2) return directions;

    // 找到交叉点在道路上的最近点索引
    let nearestIdx = 0;
    let minDist = Infinity;
    
    for (let i = 0; i < road.points.length; i++) {
      const pt = road.points[i];
      const dist = Math.sqrt(
        Math.pow(pt.mapXy.x - intersection.center.mapXy.x, 2) +
        Math.pow(pt.mapXy.y - intersection.center.mapXy.y, 2)
      );
      if (dist < minDist) {
        minDist = dist;
        nearestIdx = i;
      }
    }

    // 判断交叉点是否在道路端点附近
    const isAtStart = nearestIdx <= 1; // 在起点附近
    const isAtEnd = nearestIdx >= road.points.length - 2; // 在终点附近

    // 计算道路方向角度
    const roadAngle = this.calculateRoadAngle(road, nearestIdx);

    // 如果交叉点不在起点，则可以正向通行（沿道路方向）
    if (!isAtStart) {
      directions.push({
        angle: roadAngle,
        isForward: true
      });
    }

    // 如果交叉点不在终点，则可以反向通行（逆道路方向）
    if (!isAtEnd) {
      directions.push({
        angle: roadAngle + Math.PI, // 反向
        isForward: false
      });
    }

    return directions;
  }

  /**
   * 计算道路在某点处的角度
   */
  private calculateRoadAngle(road: Road, idx: number): number {
    if (road.points.length < 2) return 0;

    // 使用道路整体方向（首尾点连线）来确定角度
    const first = road.points[0];
    const last = road.points[road.points.length - 1];
    return Math.atan2(
      last.mapXy.y - first.mapXy.y,
      last.mapXy.x - first.mapXy.x
    );
  }

  /**
   * L型路口：2个方向，生成2条转弯路径
   * 只有进入和离开两个方向，直接连接
   */
  private generateLTypeTurns(
    directions: { angle: number; isForward: boolean; road: Road }[],
    intersection: Intersection
  ): { fromRoad: Road; toRoad: Road; direction: 'left' | 'right' | 'straight' | 'uturn' }[] {
    const combinations: { fromRoad: Road; toRoad: Road; direction: 'left' | 'right' | 'straight' | 'uturn' }[] = [];

    if (directions.length !== 2) return combinations;

    const [dir1, dir2] = directions;

    // 计算转弯方向
    const turnDir1to2 = this.calculateTurnDirectionFromAngles(dir1.angle, dir2.angle);
    const turnDir2to1 = this.calculateTurnDirectionFromAngles(dir2.angle, dir1.angle);

    // 生成双向转弯路径
    if (turnDir1to2 === 'left' || turnDir1to2 === 'right') {
      combinations.push({
        fromRoad: dir1.road,
        toRoad: dir2.road,
        direction: turnDir1to2
      });
    }

    if (turnDir2to1 === 'left' || turnDir2to1 === 'right') {
      combinations.push({
        fromRoad: dir2.road,
        toRoad: dir1.road,
        direction: turnDir2to1
      });
    }

    return combinations;
  }

  /**
   * T型路口：3个方向，生成4条转弯路径
   * 主路（2个方向）+ 支路（1个方向）
   */
  private generateTTypeTurns(
    directions: { angle: number; isForward: boolean; road: Road }[],
    intersection: Intersection,
    road1: Road,
    road2: Road
  ): { fromRoad: Road; toRoad: Road; direction: 'left' | 'right' | 'straight' | 'uturn' }[] {
    const combinations: { fromRoad: Road; toRoad: Road; direction: 'left' | 'right' | 'straight' | 'uturn' }[] = [];

    // 找出主路（有2个方向的道路）和支路（只有1个方向）
    const road1Dirs = directions.filter(d => d.road.id === road1.id);
    const road2Dirs = directions.filter(d => d.road.id === road2.id);

    let mainRoadDirs: typeof directions;
    let branchRoadDir: typeof directions[0];

    if (road1Dirs.length === 2) {
      mainRoadDirs = road1Dirs;
      branchRoadDir = road2Dirs[0];
    } else if (road2Dirs.length === 2) {
      mainRoadDirs = road2Dirs;
      branchRoadDir = road1Dirs[0];
    } else {
      // 异常情况，按通用方式处理
      return this.generateCrossTypeTurns(directions, intersection, road1, road2);
    }

    // 主路两个方向分别转向支路（2条转弯）
    for (const mainDir of mainRoadDirs) {
      const turnDir = this.calculateTurnDirectionFromAngles(mainDir.angle, branchRoadDir.angle);
      if (turnDir === 'left' || turnDir === 'right') {
        combinations.push({
          fromRoad: mainDir.road,
          toRoad: branchRoadDir.road,
          direction: turnDir
        });
      }
    }

    // 支路转向主路两个方向（2条转弯）
    for (const mainDir of mainRoadDirs) {
      const turnDir = this.calculateTurnDirectionFromAngles(branchRoadDir.angle, mainDir.angle);
      if (turnDir === 'left' || turnDir === 'right') {
        combinations.push({
          fromRoad: branchRoadDir.road,
          toRoad: mainDir.road,
          direction: turnDir
        });
      }
    }

    return combinations;
  }

  /**
   * 十字型路口：4个方向，生成8条转弯路径
   * 每个方向可以转向其他3个方向，排除直行
   */
  private generateCrossTypeTurns(
    directions: { angle: number; isForward: boolean; road: Road }[],
    intersection: Intersection,
    road1: Road,
    road2: Road
  ): { fromRoad: Road; toRoad: Road; direction: 'left' | 'right' | 'straight' | 'uturn' }[] {
    const combinations: { fromRoad: Road; toRoad: Road; direction: 'left' | 'right' | 'straight' | 'uturn' }[] = [];

    // 每个方向可以转向其他3个方向
    for (const fromDir of directions) {
      for (const toDir of directions) {
        // 跳过同一条道路（直行或掉头）
        if (fromDir.road.id === toDir.road.id) continue;

        // 计算转弯方向
        const turnDir = this.calculateTurnDirectionFromAngles(fromDir.angle, toDir.angle);

        // 只添加左转或右转
        if (turnDir === 'left' || turnDir === 'right') {
          // 避免重复添加相同的转弯
          const exists = combinations.some(c => 
            c.fromRoad.id === fromDir.road.id && 
            c.toRoad.id === toDir.road.id &&
            c.direction === turnDir
          );
          
          if (!exists) {
            combinations.push({
              fromRoad: fromDir.road,
              toRoad: toDir.road,
              direction: turnDir
            });
          }
        }
      }
    }

    return combinations;
  }

  /**
   * 根据进入角度和出口角度计算转弯方向
   */
  private calculateTurnDirectionFromAngles(
    enterAngle: number,
    exitAngle: number
  ): 'left' | 'right' | 'straight' | 'uturn' {
    // 计算角度差（归一化到 -π ~ π）
    let angleDiff = exitAngle - enterAngle;
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
    
    // 根据角度差判断转弯方向
    const absDiff = Math.abs(angleDiff);
    
    if (absDiff < Math.PI / 6) {
      // 角度差小于30°，视为直行
      return 'straight';
    } else if (absDiff > Math.PI * 5 / 6) {
      // 角度差大于150°，视为掉头
      return 'uturn';
    } else if (angleDiff > 0) {
      // 正角度差，左转
      return 'left';
    } else {
      // 负角度差，右转
      return 'right';
    }
  }

  /**
   * 生成单个转弯路径
   */
  private generateSingleTurnPath(
    intersection: Intersection,
    fromRoad: Road,
    toRoad: Road,
    direction: 'left' | 'right' | 'straight' | 'uturn'
  ): TurnPath | null {
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
  /**
   * 生成圆弧路径点
   * V2: 优化点间距，根据转弯半径动态计算
   * 
   * 点间距策略：
   * - 默认间距 0.2m（适合低速转弯）
   * - 点数 = 弧长 / 点间距 + 1
   * - 最少 11 个点，最多 51 个点
   */
  private generateArcPoints(
    center: { gps: GPSPoint; mapXy: MapPoint },
    fromRoad: Road,
    toRoad: Road,
    radius: number,
    direction: string
  ): TurnPath['points'] {
    const points: TurnPath['points'] = [];
    
    // 直行不需要单独生成路径，返回空数组
    // 直行时车辆沿着原有道路行驶，路径点已在 road.points 中
    if (direction === 'straight') {
      return points;
    }

    // 掉头：生成半圆路径
    const isUTurn = direction === 'uturn';

    // 计算圆弧
    const startAngle = this.getRoadDirection(fromRoad, { center } as any);
    let endAngle = isUTurn 
      ? startAngle + Math.PI  // 掉头：转180度
      : this.getRoadDirection(toRoad, { center } as any);
    
    // 归一化角度
    if (direction === 'left' || isUTurn) {
      while (endAngle < startAngle) endAngle += 2 * Math.PI;
    } else {
      while (endAngle > startAngle) endAngle -= 2 * Math.PI;
    }

    // 计算弧长和点数
    const arcAngle = Math.abs(endAngle - startAngle);
    const arcLength = radius * arcAngle;
    
    // 点间距 0.2m，确保转弯平滑
    const pointSpacing = 0.2; // 米
    const numPoints = Math.max(11, Math.min(51, Math.ceil(arcLength / pointSpacing)));

    // 生成圆弧点
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
 * 
 * V3.0 更新：
 * - 使用膨胀法生成地图
 * - 首选路网：骨架膨胀0.7m（总宽度1.4m），灰度255
 * - 高代价区：再膨胀0.3m（总宽度2.0m），灰度70
 * - 禁区：其他区域，灰度0
 * - Nav2 scale模式
 */
export class MapFileGenerator {
  private coordinateService: CoordinateService;

  // 膨胀参数
  private readonly PREFERRED_DILATION = 0.7;  // 首选路网膨胀半径（米）
  private readonly HIGH_COST_DILATION = 0.3;  // 高代价区额外膨胀半径（米）
  
  // 灰度值定义（Nav2 scale模式）
  private readonly GRAY_KEEPOUT = 0;      // 禁区：黑色
  private readonly GRAY_HIGH_COST = 70;   // 高代价区：灰色
  private readonly GRAY_PREFERRED = 255;  // 首选路网：白色
  
  constructor(coordinateService: CoordinateService) {
    this.coordinateService = coordinateService;
  }

  /**
   * 拉直道路点（将道路点投影到首尾连线上）
   */
  private straightenRoadPoints(road: Road): RoadPoint[] {
    const points = road.points;
    if (points.length < 3) {
      return points;
    }

    // 计算道路的实际方向（使用首尾点连线）
    const first = points[0];
    const last = points[points.length - 1];
    
    const dx = last.mapXy.x - first.mapXy.x;
    const dy = last.mapXy.y - first.mapXy.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    
    if (length < 0.1) {
      return points;
    }

    // 计算单位方向向量（主方向）
    const dirX = dx / length;
    const dirY = dy / length;

    // 计算垂直方向向量
    const perpX = -dirY;
    const perpY = dirX;

    // 计算道路中心点
    let sumX = 0, sumY = 0;
    for (const pt of points) {
      sumX += pt.mapXy.x;
      sumY += pt.mapXy.y;
    }
    const meanX = sumX / points.length;
    const meanY = sumY / points.length;

    // 计算所有点在垂直方向的偏移平均值
    let avgPerpOffset = 0;
    for (const pt of points) {
      const perpOffset = (pt.mapXy.x - meanX) * perpX + (pt.mapXy.y - meanY) * perpY;
      avgPerpOffset += perpOffset;
    }
    avgPerpOffset /= points.length;

    // 将所有点投影到直线上
    const straightenedPoints: RoadPoint[] = points.map((pt, idx) => {
      // 计算点在主方向上的投影距离
      const projDist = (pt.mapXy.x - first.mapXy.x) * dirX + (pt.mapXy.y - first.mapXy.y) * dirY;
      
      // 计算投影后的坐标
      const projX = first.mapXy.x + projDist * dirX + perpX * avgPerpOffset;
      const projY = first.mapXy.y + projDist * dirY + perpY * avgPerpOffset;

      return {
        ...pt,
        mapXy: {
          x: projX,
          y: projY
        }
      };
    });

    return straightenedPoints;
  }

  /**
   * 生成PGM地图（膨胀法）
   * 
   * 策略：
   * 1. 首选路网：骨架膨胀0.7m，灰度255
   * 2. 高代价区：再膨胀0.3m，灰度70
   * 3. 禁区：其他区域，灰度0
   */
  generatePGMMap(
    roads: Road[],
    intersections: Intersection[],
    beamPositions: BeamPosition[],
    turnArcs: TurnArc[] = [],
    straightPaths: StraightPath[] = [],
    resolution: number = 0.05
  ): { pgm: Buffer; width: number; height: number; origin: { x: number; y: number }; statistics: MapStatistics } {
    // 收集所有骨架点
    const skeletonPoints: Array<{x: number, y: number}> = [];
    
    // 添加道路点（拉直后）
    for (const road of roads) {
      const straightened = this.straightenRoadPoints(road);
      for (const pt of straightened) {
        skeletonPoints.push({ x: pt.mapXy.x, y: pt.mapXy.y });
      }
    }
    
    // 添加转弯圆弧点
    for (const arc of turnArcs) {
      for (const pt of arc.points) {
        skeletonPoints.push({ x: pt.mapXy.x, y: pt.mapXy.y });
      }
    }
    
    // 添加直行线路点
    for (const sp of straightPaths) {
      for (const pt of sp.points) {
        skeletonPoints.push({ x: pt.mapXy.x, y: pt.mapXy.y });
      }
    }
    
    if (skeletonPoints.length === 0) {
      throw new Error('没有骨架点');
    }
    
    // 计算边界
    const bounds = this.calculateSkeletonBounds(skeletonPoints, beamPositions);
    
    // 计算像素尺寸
    const width = Math.ceil((bounds.maxX - bounds.minX) / resolution) + 100;
    const height = Math.ceil((bounds.maxY - bounds.minY) / resolution) + 100;
    
    // 创建骨架图像
    const skeletonImg: number[][] = [];
    for (let y = 0; y < height; y++) {
      skeletonImg[y] = new Array(width).fill(0);
    }
    
    // 绘制骨架点
    for (const pt of skeletonPoints) {
      const px = Math.floor((pt.x - bounds.minX) / resolution) + 50;
      const py = height - Math.floor((pt.y - bounds.minY) / resolution) - 1;
      if (px >= 0 && px < width && py >= 0 && py < height) {
        skeletonImg[py][px] = 255;
      }
    }
    
    // 计算膨胀半径（像素）
    const preferredRadiusPx = Math.round(this.PREFERRED_DILATION / resolution);
    const highCostRadiusPx = Math.round(this.HIGH_COST_DILATION / resolution);
    
    // 执行膨胀操作
    const preferredDilated = this.binaryDilation(skeletonImg, preferredRadiusPx);
    const highCostDilated = this.binaryDilation(preferredDilated, highCostRadiusPx);
    
    // 创建最终地图
    const grayArray: number[] = new Array(width * height).fill(this.GRAY_KEEPOUT);
    
    // 填充高代价区
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (highCostDilated[y][x]) {
          grayArray[y * width + x] = this.GRAY_HIGH_COST;
        }
      }
    }
    
    // 填充首选路网（覆盖高代价区）
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (preferredDilated[y][x]) {
          grayArray[y * width + x] = this.GRAY_PREFERRED;
        }
      }
    }
    
    // 计算统计
    const totalPixels = width * height;
    let keepoutPixels = 0, highCostPixels = 0, preferredPixels = 0;
    for (const v of grayArray) {
      if (v === this.GRAY_KEEPOUT) keepoutPixels++;
      else if (v === this.GRAY_HIGH_COST) highCostPixels++;
      else if (v === this.GRAY_PREFERRED) preferredPixels++;
    }
    
    const statistics: MapStatistics = {
      totalPixels,
      keepoutPixels,
      highCostPixels,
      preferredPixels,
      keepoutPercent: (keepoutPixels / totalPixels) * 100,
      highCostPercent: (highCostPixels / totalPixels) * 100,
      preferredPercent: (preferredPixels / totalPixels) * 100
    };
    
    // 转换为PGM格式
    const pgm = this.createPGMBuffer(grayArray, width, height);
    
    return {
      pgm,
      width,
      height,
      origin: {
        x: bounds.minX - 50 * resolution,
        y: bounds.minY - 50 * resolution
      },
      statistics
    };
  }
  
  /**
   * 计算骨架点边界
   */
  private calculateSkeletonBounds(
    skeletonPoints: Array<{x: number, y: number}>,
    beamPositions: BeamPosition[]
  ): { minX: number; maxX: number; minY: number; maxY: number } {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    
    for (const pt of skeletonPoints) {
      minX = Math.min(minX, pt.x);
      maxX = Math.max(maxX, pt.x);
      minY = Math.min(minY, pt.y);
      maxY = Math.max(maxY, pt.y);
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
   * 二值图像膨胀
   * 使用圆形结构元素
   */
  private binaryDilation(img: number[][], radius: number): boolean[][];
  private binaryDilation(img: boolean[][], radius: number): boolean[][];
  private binaryDilation(img: number[][] | boolean[][], radius: number): boolean[][] {
    const height = img.length;
    const width = img[0] ? img[0].length : 0;
    
    if (width === 0 || height === 0) {
      return [];
    }
    
    // 创建输出图像
    const output: boolean[][] = [];
    for (let y = 0; y < height; y++) {
      output[y] = new Array(width).fill(false);
    }
    
    // 创建圆形结构元素
    const kernel: Array<[number, number]> = [];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radius * radius) {
          kernel.push([dx, dy]);
        }
      }
    }
    
    // 执行膨胀
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const value = img[y] && img[y][x];
        const isTrue = typeof value === 'boolean' ? value : (value as number) > 0;
        
        if (isTrue) {
          // 将结构元素应用到该点
          for (const [dx, dy] of kernel) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height && output[ny]) {
              output[ny][nx] = true;
            }
          }
        }
      }
    }
    
    return output;
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
   * 绘制禁区（连续通道）
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
      if (road.points.length < 2) continue;
      
      const keepout = road.params.keepoutDistance;
      const halfChannel = road.params.channelWidth / 2;
      
      // 绘制连续线段
      for (let i = 0; i < road.points.length - 1; i++) {
        const p1 = road.points[i];
        const p2 = road.points[i + 1];
        
        // 计算线段方向
        const dx = p2.mapXy.x - p1.mapXy.x;
        const dy = p2.mapXy.y - p1.mapXy.y;
        const segLength = Math.sqrt(dx * dx + dy * dy);
        
        if (segLength < 0.01) continue;
        
        // 垂直方向单位向量
        const perpX = -dy / segLength;
        const perpY = dx / segLength;
        
        // 沿线段插值绘制
        const steps = Math.ceil(segLength / resolution);
        for (let step = 0; step <= steps; step++) {
          const t = step / steps;
          const x = p1.mapXy.x + dx * t;
          const y = p1.mapXy.y + dy * t;
          
          // 左侧禁区
          for (let d = halfChannel; d < halfChannel + keepout; d += resolution) {
            const px = x + perpX * d;
            const py = y + perpY * d;
            this.setPixel(grayArray, width, height, px, py, resolution, bounds, 0);
          }
          
          // 右侧禁区
          for (let d = halfChannel; d < halfChannel + keepout; d += resolution) {
            const px = x - perpX * d;
            const py = y - perpY * d;
            this.setPixel(grayArray, width, height, px, py, resolution, bounds, 0);
          }
        }
      }
    }
  }

  /**
   * 绘制首选路网（连续通道）
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
      if (road.points.length < 2) continue;
      
      const halfPreferred = road.params.preferredWidth / 2;
      
      // 绘制连续线段
      for (let i = 0; i < road.points.length - 1; i++) {
        const p1 = road.points[i];
        const p2 = road.points[i + 1];
        
        // 计算线段方向
        const dx = p2.mapXy.x - p1.mapXy.x;
        const dy = p2.mapXy.y - p1.mapXy.y;
        const segLength = Math.sqrt(dx * dx + dy * dy);
        
        if (segLength < 0.01) continue;
        
        // 垂直方向单位向量
        const perpX = -dy / segLength;
        const perpY = dx / segLength;
        
        // 沿线段插值绘制
        const steps = Math.ceil(segLength / resolution);
        for (let step = 0; step <= steps; step++) {
          const t = step / steps;
          const x = p1.mapXy.x + dx * t;
          const y = p1.mapXy.y + dy * t;
          
          // 绘制垂直于线段的宽度
          for (let d = -halfPreferred; d <= halfPreferred; d += resolution) {
            const px = x + perpX * d;
            const py = y + perpY * d;
            this.setPixel(grayArray, width, height, px, py, resolution, bounds, 254);
          }
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
      if (road.points.length < 2) continue;
      
      const halfChannel = road.params.channelWidth / 2;
      const halfPreferred = road.params.preferredWidth / 2;
      
      // 计算道路方向（首尾点连线）
      const first = road.points[0];
      const last = road.points[road.points.length - 1];
      const dx = last.mapXy.x - first.mapXy.x;
      const dy = last.mapXy.y - first.mapXy.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      
      if (length < 0.1) continue;
      
      // 垂直方向单位向量
      const perpX = -dy / length;
      const perpY = dx / length;
      
      for (const pt of road.points) {
        // 首选路网和通道边缘之间的高代价区
        for (let d = halfPreferred; d < halfChannel; d += resolution) {
          // 左侧高代价区
          const x1 = pt.mapXy.x + perpX * d;
          const y1 = pt.mapXy.y + perpY * d;
          this.setPixel(grayArray, width, height, x1, y1, resolution, bounds, 150);
          
          // 右侧高代价区
          const x2 = pt.mapXy.x - perpX * d;
          const y2 = pt.mapXy.y - perpY * d;
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
   * 生成十字路口的4个转弯圆弧
   * 
   * 几何规则：
   * - 圆弧中心位于 (±4.5m, ±4.5m) 相对于路口中心
   * - 半径 = 4.5m（阿克曼最小转弯半径）
   * - 圆弧与垂直道路中心线相切
   */
  generateTurnArcs(
    intersection: Intersection,
    roads: Road[],
    turnRadius: number = 4.5,
    pointSpacing: number = 0.2
  ): TurnArc[] {
    const arcs: TurnArc[] = [];
    const cx = intersection.center.mapXy.x;
    const cy = intersection.center.mapXy.y;
    
    // 找到连接的道路
    const connectedRoads = roads.filter(r => intersection.connectedRoads.includes(r.id));
    
    if (connectedRoads.length !== 2) {
      return arcs;
    }
    
    const [road1, road2] = connectedRoads;
    
    // 获取道路方向
    const dir1 = this.getRoadDirectionVector(road1);
    const dir2 = this.getRoadDirectionVector(road2);
    
    // 计算垂直方向向量
    const perp1 = { x: -dir1.y, y: dir1.x };
    const perp2 = { x: -dir2.y, y: dir2.x };
    
    // 生成4个象限的圆弧
    const quadrants = [
      { signX: 1, signY: 1 },   // 第一象限
      { signX: 1, signY: -1 },  // 第四象限
      { signX: -1, signY: 1 },  // 第二象限
      { signX: -1, signY: -1 }  // 第三象限
    ];
    
    const R = turnRadius;
    
    for (let idx = 0; idx < quadrants.length; idx++) {
      const q = quadrants[idx];
      const sx = q.signX;
      const sy = q.signY;
      
      // 圆弧中心位置
      const arcCx = cx + sx * R * perp1.x + sy * R * perp2.x;
      const arcCy = cy + sx * R * perp1.y + sy * R * perp2.y;
      
      // 切点位置
      const tangent1X = cx + sy * R * perp2.x;
      const tangent1Y = cy + sy * R * perp2.y;
      
      const tangent2X = cx + sx * R * perp1.x;
      const tangent2Y = cy + sx * R * perp1.y;
      
      // 验证半径
      const r1 = Math.sqrt((tangent1X - arcCx) ** 2 + (tangent1Y - arcCy) ** 2);
      const r2 = Math.sqrt((tangent2X - arcCx) ** 2 + (tangent2Y - arcCy) ** 2);
      
      // 计算起始和结束角度
      let startAngle = Math.atan2(tangent1Y - arcCy, tangent1X - arcCx);
      let endAngle = Math.atan2(tangent2Y - arcCy, tangent2X - arcCx);
      
      // 计算角度差，确保走短弧（小于180度）
      let angleDiff = endAngle - startAngle;
      
      // 标准化到 [-π, π] 范围
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
      
      // 设置endAngle使角度差为短弧
      endAngle = startAngle + angleDiff;
      
      // 计算弧长和点数
      const arcLength = R * Math.abs(angleDiff);
      const numPoints = Math.max(11, Math.ceil(arcLength / pointSpacing) + 1);
      
      // 生成圆弧点
      const arcPoints: TurnArcPoint[] = [];
      for (let i = 0; i < numPoints; i++) {
        const t = i / (numPoints - 1);
        const angle = startAngle + t * (endAngle - startAngle);
        
        const px = arcCx + R * Math.cos(angle);
        const py = arcCy + R * Math.sin(angle);
        
        // 简化的GPS计算
        const lat = intersection.center.gps.latitude + py / 111000;
        const lon = intersection.center.gps.longitude + px / (111000 * Math.cos(intersection.center.gps.latitude * Math.PI / 180));
        
        arcPoints.push({
          seq: i,
          gps: { latitude: lat, longitude: lon, altitude: intersection.center.gps.altitude },
          mapXy: { x: px, y: py }
        });
      }
      
      arcs.push({
        id: `arc_${intersection.id}_${idx}`,
        intersectionId: intersection.id,
        quadrant: idx,
        radius: R,
        center: { x: arcCx, y: arcCy },
        tangentPoints: [
          { x: tangent1X, y: tangent1Y },
          { x: tangent2X, y: tangent2Y }
        ],
        points: arcPoints
      });
    }
    
    return arcs;
  }
  
  /**
   * 获取道路方向向量（首尾点连线）
   */
  private getRoadDirectionVector(road: Road): { x: number; y: number } {
    const points = road.points;
    if (points.length < 2) {
      return { x: 1, y: 0 };
    }
    
    const first = points[0];
    const last = points[points.length - 1];
    
    const dx = last.mapXy.x - first.mapXy.x;
    const dy = last.mapXy.y - first.mapXy.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    
    if (length > 0.1) {
      return { x: dx / length, y: dy / length };
    }
    
    return { x: 1, y: 0 };
  }
  
  /**
   * 生成直行线路（沿道路方向延伸到转弯圆弧的切点）
   */
  generateStraightPaths(
    intersection: Intersection,
    roads: Road[],
    arcs: TurnArc[],
    turnRadius: number = 4.5,
    pointSpacing: number = 0.2
  ): StraightPath[] {
    const straightPaths: StraightPath[] = [];
    const cx = intersection.center.mapXy.x;
    const cy = intersection.center.mapXy.y;
    
    // 找到连接的道路
    const connectedRoads = roads.filter(r => intersection.connectedRoads.includes(r.id));
    
    if (connectedRoads.length !== 2) {
      return straightPaths;
    }
    
    // 收集所有切点
    const tangentPoints: Array<{x: number, y: number}> = [];
    for (const arc of arcs) {
      for (const tp of arc.tangentPoints) {
        tangentPoints.push(tp);
      }
    }
    
    // 为每条道路生成直行线路
    for (const road of connectedRoads) {
      const dir = this.getRoadDirectionVector(road);
      
      // 找到该道路方向上的切点
      const roadTangents: Array<{x: number, y: number}> = [];
      for (const tp of tangentPoints) {
        // 计算切点到路口中心的向量
        const vx = tp.x - cx;
        const vy = tp.y - cy;
        
        // 计算与道路方向的点积
        const dot = vx * dir.x + vy * dir.y;
        
        // 如果点积接近0，说明切点在该道路的垂直方向
        if (Math.abs(dot) < 1.0) {
          roadTangents.push(tp);
        }
      }
      
      // 为每个切点生成直行线路
      for (const tp of roadTangents) {
        const distToTangent = Math.sqrt((tp.x - cx) ** 2 + (tp.y - cy) ** 2);
        
        // 生成直行点
        const numPoints = Math.max(2, Math.ceil(turnRadius / pointSpacing) + 1);
        const straightPoints: StraightPathPoint[] = [];
        
        for (let i = 0; i < numPoints; i++) {
          const t = i / (numPoints - 1);
          
          // 从路口中心向切点方向延伸
          let px = cx + t * (tp.x - cx);
          let py = cy + t * (tp.y - cy);
          
          // 简化的GPS计算
          const lat = intersection.center.gps.latitude + py / 111000;
          const lon = intersection.center.gps.longitude + px / (111000 * Math.cos(intersection.center.gps.latitude * Math.PI / 180));
          
          straightPoints.push({
            seq: i,
            gps: { latitude: lat, longitude: lon, altitude: intersection.center.gps.altitude },
            mapXy: { x: px, y: py }
          });
        }
        
        straightPaths.push({
          id: `straight_${intersection.id}_${road.id}_${straightPaths.length}`,
          intersectionId: intersection.id,
          roadId: road.id,
          points: straightPoints
        });
      }
    }
    
    return straightPaths;
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
   * 生成gps_routes.json（V3.0版本，包含转弯圆弧和直行线路）
   */
  generateGPSRoutesJSON(
    origin: { gps: GPSPoint; utm: { zone: number; easting: number; northing: number } },
    roads: Road[],
    intersections: Intersection[],
    turnArcs: TurnArc[],
    straightPaths: StraightPath[]
  ): object {
    return {
      version: '3.0',
      origin: {
        gps: {
          lat: origin.gps.latitude,
          lon: origin.gps.longitude
        },
        utm: origin.utm
      },
      roads: roads.map(road => {
        // 对道路点进行拉直处理
        const straightenedPoints = this.straightenRoadPoints(road);
        return {
          id: road.id,
          name: road.name,
          type: road.type,
          params: road.params,
          points: straightenedPoints.map(pt => ({
            seq: pt.seq,
            gps: { lat: pt.gps.latitude, lon: pt.gps.longitude },
            map_xy: pt.mapXy
          }))
        };
      }),
      intersections: intersections.map(int => ({
        id: int.id,
        type: int.type,
        center: {
          gps: { lat: int.center.gps.latitude, lon: int.center.gps.longitude },
          map_xy: int.center.mapXy
        },
        connected_roads: int.connectedRoads
      })),
      turn_arcs: turnArcs.map(arc => ({
        id: arc.id,
        intersection_id: arc.intersectionId,
        quadrant: arc.quadrant,
        radius: arc.radius,
        center: arc.center,
        tangent_points: arc.tangentPoints,
        points: arc.points.map(pt => ({
          seq: pt.seq,
          gps: { lat: pt.gps.latitude, lon: pt.gps.longitude },
          map_xy: pt.mapXy
        }))
      })),
      straight_paths: straightPaths.map(sp => ({
        id: sp.id,
        intersection_id: sp.intersectionId,
        road_id: sp.roadId,
        points: sp.points.map(pt => ({
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
