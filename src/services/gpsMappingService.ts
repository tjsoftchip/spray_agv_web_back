/**
 * GPS道路数据处理与圆弧生成服务
 * 完全按照Python实现 gps_arc_generator.py 重写
 *
 * @version 5.0
 * @date 2026-03-26
 */

import { GPSPoint, MapPoint, Road, RoadPoint, Intersection, TurnArc, TurnArcPoint, BeamPosition } from '../models/GPSMap';

// ============================================================
// 基础数据类型
// ============================================================

export interface Point2D {
  x: number;
  y: number;
}

export interface GPScoord {
  lat: number;
  lon: number;
}

export interface FittedLine {
  start: Point2D;
  end: Point2D;
  directionAngle: number;
  roadId: string;
  length(): number;
  directionVector(): Point2D;
}

export interface GPSOrigin {
  gps: GPScoord;
  utm: {
    zone: number;
    easting: number;
    northing: number;
  };
  rotation: number;
}

// ============================================================
// 坐标转换服务
// ============================================================

export class CoordinateService {
  private origin: GPSOrigin;
  private utmZone: number;

  constructor(origin: GPSOrigin) {
    this.origin = origin;
    this.utmZone = origin.utm.zone;
  }

  setUTMOrigin(utm: { zone: number; easting: number; northing: number }) {
    this.origin.utm = utm;
    this.utmZone = utm.zone;
  }

  /**
   * 计算UTM分区号
   * UTM分区从西经180度开始，每6度一个分区
   */
  static calculateUTMZone(lon: number): number {
    return Math.floor((lon + 180) / 6) + 1;
  }

  gpsToUtm(lat: number, lon: number): { easting: number; northing: number } {
    const latRad = lat * Math.PI / 180;
    const lonRad = lon * Math.PI / 180;
    // 动态计算正确的UTM分区，而不是使用预设值
    const utmZone = CoordinateService.calculateUTMZone(lon);
    const lonOrigin = ((utmZone - 1) * 6 - 180 + 3) * Math.PI / 180;

    const k0 = 0.9996;
    const a = 6378137.0;
    const e = 0.081819191;

    const N = a / Math.sqrt(1 - e * e * Math.sin(latRad) * Math.sin(latRad));
    const T = Math.tan(latRad) * Math.tan(latRad);
    const C = e * e * Math.cos(latRad) * Math.cos(latRad) / (1 - e * e);
    const A = Math.cos(latRad) * (lonRad - lonOrigin);

    const M = a * ((1 - e * e / 4 - 3 * e * e * e * e / 64) * latRad
      - (3 * e * e / 8 + 3 * e * e * e * e / 32) * Math.sin(2 * latRad)
      + (15 * e * e * e * e / 256) * Math.sin(4 * latRad));

    const easting = k0 * N * (A + (1 - T + C) * A * A * A / 6
      + (5 - 18 * T + T * T + 72 * C - 58 * e * e) * A * A * A * A * A / 120) + 500000;

    const northing = k0 * (M + N * Math.tan(latRad) * (A * A / 2
      + (5 - T + 9 * C + 4 * C * C) * A * A * A * A / 24
      + (61 - 58 * T + T * T + 600 * C - 330 * e * e) * A * A * A * A * A * A / 720));

    return { easting, northing };
  }

  utmToGps(easting: number, northing: number): { lat: number; lon: number } {
    const k0 = 0.9996;
    const a = 6378137.0;
    const e = 0.081819191;
    const e1 = (1 - Math.sqrt(1 - e * e)) / (1 + Math.sqrt(1 - e * e));

    const x = easting - 500000;
    const y = northing;
    // 使用存储的origin UTM zone进行逆转换
    const lonOrigin = ((this.origin.utm.zone - 1) * 6 - 180 + 3) * Math.PI / 180;

    const M = y / k0;
    const mu = M / (a * (1 - e * e / 4 - 3 * e * e * e * e / 64 - 5 * e * e * e * e * e * e / 256));

    const phi1 = mu + (3 * e1 / 2 - 27 * e1 * e1 * e1 / 32) * Math.sin(2 * mu)
      + (21 * e1 * e1 / 16 - 55 * e1 * e1 * e1 * e1 / 32) * Math.sin(4 * mu)
      + (151 * e1 * e1 * e1 / 96) * Math.sin(6 * mu)
      + (1097 * e1 * e1 * e1 * e1 / 512) * Math.sin(8 * mu);

    const N1 = a / Math.sqrt(1 - e * e * Math.sin(phi1) * Math.sin(phi1));
    const T1 = Math.tan(phi1) * Math.tan(phi1);
    const C1 = e * e * Math.cos(phi1) * Math.cos(phi1) / (1 - e * e);
    const R1 = a * (1 - e * e) / Math.pow(1 - e * e * Math.sin(phi1) * Math.sin(phi1), 1.5);
    const D = x / (N1 * k0);

    const lat = phi1 - (N1 * Math.tan(phi1) / R1) * (D * D / 2
      - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * e * e) * D * D * D * D / 24
      + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * e * e - 3 * C1 * C1) * D * D * D * D * D * D / 720);

    const lon = lonOrigin + (D - (1 + 2 * T1 + C1) * D * D * D / 6
      + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * e * e + 24 * T1 * T1) * D * D * D * D * D / 120) / Math.cos(phi1);

    return { lat: lat * 180 / Math.PI, lon: lon * 180 / Math.PI };
  }

  gpsToMap(lat: number, lon: number): Point2D {
    const utm = this.gpsToUtm(lat, lon);
    return {
      x: utm.easting - this.origin.utm.easting,
      y: utm.northing - this.origin.utm.northing
    };
  }

  mapToGps(x: number, y: number): { lat: number; lon: number } {
    const easting = x + this.origin.utm.easting;
    const northing = y + this.origin.utm.northing;
    return this.utmToGps(easting, northing);
  }

  haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2)
      + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  planarDistance(p1: Point2D, p2: Point2D): number {
    return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
  }

  getOrigin(): GPSOrigin {
    return this.origin;
  }

  toUTM(lat: number, lon: number): { zone: number; easting: number; northing: number } {
    const zone = CoordinateService.calculateUTMZone(lon);
    const utm = this.gpsToUtm(lat, lon);
    return { zone, easting: utm.easting, northing: utm.northing };
  }

  mapToGPS(x: number, y: number): { lat: number; lon: number } {
    return this.mapToGps(x, y);
  }
}

// ============================================================
// 辅助函数
// ============================================================

function normalizeAngle(angle: number): number {
  while (angle < 0) angle += 2 * Math.PI;
  while (angle >= 2 * Math.PI) angle -= 2 * Math.PI;
  return angle;
}

function normalizeAngleHalfPi(angle: number): number {
  while (angle < 0) angle += Math.PI;
  while (angle >= Math.PI) angle -= Math.PI;
  return angle;
}

function circularMean(angles: number[]): number {
  if (angles.length === 0) return 0.0;
  const sinSum = angles.reduce((s, a) => s + Math.sin(a), 0);
  const cosSum = angles.reduce((s, a) => s + Math.cos(a), 0);
  return Math.atan2(sinSum, cosSum);
}

function createFittedLine(start: Point2D, end: Point2D, directionAngle: number, roadId: string): FittedLine {
  return {
    start,
    end,
    directionAngle,
    roadId,
    length: () => Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2),
    directionVector: () => {
      const len = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2);
      if (len < 1e-10) return { x: 0, y: 0 };
      return { x: (end.x - start.x) / len, y: (end.y - start.y) / len };
    }
  };
}

// ============================================================
// GPS道路数据处理
// ============================================================

export class GPSRoadProcessor {
  private coordinateService: CoordinateService | null = null;

  constructor(coordinateService?: CoordinateService) {
    this.coordinateService = coordinateService || null;
  }

  setCoordinateService(cs: CoordinateService): void {
    this.coordinateService = cs;
  }

  /**
   * 计算角度的标准差（考虑角度的周期性）
   */
  private computeAngleStd(angles: number[]): number {
    if (angles.length < 2) return 0;
    const mean = circularMean(angles);
    let sumSq = 0;
    for (const a of angles) {
      let diff = normalizeAngle(a - mean);
      if (diff > Math.PI) diff -= 2 * Math.PI;
      if (diff < -Math.PI) diff += 2 * Math.PI;
      sumSq += diff * diff;
    }
    return Math.sqrt(sumSq / angles.length);
  }

  /**
   * 异常点剔除
   */
  removeOutlierPoints(points: RoadPoint[], maxDistance: number = 10.0, minPoints: number = 3): RoadPoint[] {
    if (points.length < minPoints) return points;
    const validPoints: RoadPoint[] = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const prev = validPoints[validPoints.length - 1];
      const curr = points[i];
      const distance = this.coordinateService
        ? this.coordinateService.haversineDistance(prev.gps.latitude, prev.gps.longitude, curr.gps.latitude, curr.gps.longitude)
        : Math.sqrt((curr.mapXy.x - prev.mapXy.x) ** 2 + (curr.mapXy.y - prev.mapXy.y) ** 2);
      if (distance <= maxDistance) validPoints.push(curr);
    }
    return validPoints.length >= minPoints ? validPoints : points.slice(0, minPoints);
  }

  /**
   * 识别道路主方向
   * 优先使用首尾点方向，当位移太小时使用PCA方法
   * 关键修复：确保同类道路方向一致（避免反向问题）
   */
  identifyRoadDirections(roads: Road[]): { longitudinalAngle: number; horizontalAngle: number } {
    const longitudinalRoads = roads.filter(r => r.type === 'longitudinal');
    const horizontalRoads = roads.filter(r => r.type === 'horizontal');

    const longitudinalData: { road: Road; angle: number }[] = [];
    for (const road of longitudinalRoads) {
      const angle = this.getRoadDirection(road.points);
      if (angle !== null) longitudinalData.push({ road, angle });
    }

    const horizontalData: { road: Road; angle: number }[] = [];
    for (const road of horizontalRoads) {
      const angle = this.getRoadDirection(road.points);
      if (angle !== null) horizontalData.push({ road, angle });
    }

    // 计算初始平均角度
    let longitudinalAngle = circularMean(longitudinalData.length > 0 ? longitudinalData.map(d => d.angle) : [Math.PI / 2]);
    let horizontalAngle = circularMean(horizontalData.length > 0 ? horizontalData.map(d => d.angle) : [0.0]);

    // 修正反向问题：确保同类道路方向与平均值相近
    // 如果某条道路方向与平均值相差>90°，则翻转180°
    const normalizeDirection = (angle: number, reference: number): number => {
      let diff = normalizeAngle(angle - reference);
      if (diff > Math.PI / 2) diff -= Math.PI;
      if (diff < -Math.PI / 2) diff += Math.PI;
      return normalizeAngle(reference + diff);
    };

    // 修正纵向路方向
    const correctedLongitudinalAngles: number[] = [];
    const longAngles = longitudinalData.map(d => d.angle);
    const longStd = this.computeAngleStd(longAngles);
    for (const { road, angle } of longitudinalData) {
      let corrected = angle;
      // 只有当同类道路角度差异较大（标准差>45°）时才进行修正
      if (longStd > Math.PI / 4) {
        corrected = normalizeDirection(angle, longitudinalAngle);
      }
      correctedLongitudinalAngles.push(corrected);
    }
    longitudinalAngle = circularMean(correctedLongitudinalAngles);

    // 修正横向路方向
    const correctedHorizontalAngles: number[] = [];
    const horzAngles = horizontalData.map(d => d.angle);
    const horzStd = this.computeAngleStd(horzAngles);
    for (const { road, angle } of horizontalData) {
      let corrected = angle;
      // 只有当同类道路角度差异较大（标准差>45°）时才进行修正
      if (horzStd > Math.PI / 4) {
        corrected = normalizeDirection(angle, horizontalAngle);
      }
      correctedHorizontalAngles.push(corrected);
    }
    horizontalAngle = circularMean(correctedHorizontalAngles);

    // 校验垂直性
    const angleDiff = Math.abs(normalizeAngle(longitudinalAngle - horizontalAngle));
    if (!(Math.PI / 2 - 0.2 < angleDiff && angleDiff < Math.PI / 2 + 0.2)) {
      horizontalAngle = normalizeAngle(longitudinalAngle + Math.PI / 2);
    }

    return { longitudinalAngle, horizontalAngle };
  }

  /**
   * 获取单条道路的方向角度
   * 优先首尾点法，位移太小时返回null（让调用方使用默认值）
   */
  private getRoadDirection(points: RoadPoint[]): number | null {
    if (points.length < 2) return null;

    const start = points[0].mapXy;
    const end = points[points.length - 1].mapXy;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const displacement = Math.sqrt(dx * dx + dy * dy);

    // 首尾点位移足够大时直接使用
    if (displacement > 0.5) {
      return Math.atan2(dy, dx);
    }

    // 位移太小，使用PCA方法
    const pcaAngle = this.pcaDirection(points);
    // 检查PCA是否有足够的方差（不是所有点重合）
    const pts = points;
    const n = pts.length;
    let meanX = 0, meanY = 0;
    for (const p of pts) { meanX += p.mapXy.x; meanY += p.mapXy.y; }
    meanX /= n; meanY /= n;
    let maxDist = 0;
    for (const p of pts) {
      const d = Math.sqrt((p.mapXy.x - meanX)**2 + (p.mapXy.y - meanY)**2);
      if (d > maxDist) maxDist = d;
    }
    // 如果所有点几乎重合，PCA结果不可靠，返回null
    if (maxDist < 0.1) return null;
    return pcaAngle;
  }

  /**
   * PCA方法计算道路方向
   */
  private pcaDirection(points: RoadPoint[]): number {
    if (points.length < 2) return 0.0;

    const n = points.length;
    let meanX = 0, meanY = 0;
    for (const p of points) { meanX += p.mapXy.x; meanY += p.mapXy.y; }
    meanX /= n; meanY /= n;

    let covXX = 0, covYY = 0, covXY = 0;
    for (const p of points) {
      const dx = p.mapXy.x - meanX;
      const dy = p.mapXy.y - meanY;
      covXX += dx * dx;
      covYY += dy * dy;
      covXY += dx * dy;
    }
    covXX /= n; covYY /= n; covXY /= n;

    if (Math.abs(covXY) < 1e-10) {
      return covXX > covYY ? 0.0 : Math.PI / 2;
    }

    return 0.5 * Math.atan2(2 * covXY, covXX - covYY);
  }

  /**
   * 道路正交化
   */
  orthogonalizeRoads(
    longitudinalAngle: number,
    horizontalAngle: number,
    tolerance: number = 0.05
  ): { longitudinalAngle: number; horizontalAngle: number } {
    const angleDiff = Math.abs(horizontalAngle - longitudinalAngle);
    const normalizedDiff = Math.abs(normalizeAngle(angleDiff));
    if (Math.abs(normalizedDiff - Math.PI / 2) <= tolerance) {
      return { longitudinalAngle, horizontalAngle };
    }
    return {
      longitudinalAngle,
      horizontalAngle: normalizeAngle(longitudinalAngle + Math.PI / 2)
    };
  }

  /**
   * 在主方向约束下拟合道路直线
   * 完全按照Python fit_road_with_direction实现
   */
  fitRoadWithDirection(road: Road, mainAngle: number): FittedLine {
    const points = road.points;
    if (points.length < 2) throw new Error(`道路 ${road.id} 点数不足`);

    const dx = Math.cos(mainAngle);
    const dy = Math.sin(mainAngle);
    const perpDx = -dy;
    const perpDy = dx;

    const projections: number[] = [];
    const offsets: number[] = [];

    for (const p of points) {
      projections.push(p.mapXy.x * dx + p.mapXy.y * dy);
      offsets.push(p.mapXy.x * perpDx + p.mapXy.y * perpDy);
    }

    const minOffset = Math.min(...offsets);
    const maxOffset = Math.max(...offsets);
    const centerOffset = (minOffset + maxOffset) / 2;
    const minProj = Math.min(...projections);
    const maxProj = Math.max(...projections);

    const start: Point2D = {
      x: minProj * dx + centerOffset * perpDx,
      y: minProj * dy + centerOffset * perpDy
    };
    const end: Point2D = {
      x: maxProj * dx + centerOffset * perpDx,
      y: maxProj * dy + centerOffset * perpDy
    };

    const line = createFittedLine(start, end, mainAngle, road.id);
    return line;
  }

  /**
   * 计算两条直线的交点
   */
  calculateIntersection(lineV: FittedLine, lineH: FittedLine): Point2D | null {
    const dirV = lineV.directionVector();
    const dirH = lineH.directionVector();
    const denom = dirV.x * dirH.y - dirV.y * dirH.x;
    if (Math.abs(denom) < 1e-10) return null;
    const dx = lineH.start.x - lineV.start.x;
    const dy = lineH.start.y - lineV.start.y;
    const t = (dx * dirH.y - dy * dirH.x) / denom;
    return { x: lineV.start.x + t * dirV.x, y: lineV.start.y + t * dirV.y };
  }

  /**
   * 道路点重采样
   */
  resampleRoadPoints(line: FittedLine, sampleDistance: number): RoadPoint[] {
    const length = line.length();
    const dirVec = line.directionVector();
    const numPoints = Math.max(2, Math.floor(length / sampleDistance) + 1);
    const points: RoadPoint[] = [];

    for (let i = 0; i < numPoints; i++) {
      const dist = Math.min(i * sampleDistance, length);
      const x = line.start.x + dist * dirVec.x;
      const y = line.start.y + dist * dirVec.y;
      let gps: { lat: number; lon: number } = { lat: 0, lon: 0 };
      if (this.coordinateService) gps = this.coordinateService.mapToGps(x, y);
      points.push({
        seq: i,
        gps: { latitude: gps.lat, longitude: gps.lon, altitude: 0 },
        mapXy: { x, y }
      });
    }
    return points;
  }

  /**
   * 完整道路处理流程
   */
  processRoads(
    roads: Road[],
    sampleDistance: number = 0.5
  ): {
    processedRoads: Road[];
    fittedLines: Map<string, FittedLine>;
    directions: { longitudinalAngle: number; horizontalAngle: number };
  } {
    // 异常点剔除
    for (const road of roads) {
      road.points = this.removeOutlierPoints(road.points);
    }

    // 识别主方向
    const directions = this.identifyRoadDirections(roads);

    // 正交化
    const ortho = this.orthogonalizeRoads(directions.longitudinalAngle, directions.horizontalAngle);

    // 拟合道路
    const fittedLines = new Map<string, FittedLine>();
    for (const road of roads) {
      const mainAngle = road.type === 'longitudinal' ? ortho.longitudinalAngle : ortho.horizontalAngle;
      const fittedLine = this.fitRoadWithDirection(road, mainAngle);
      fittedLines.set(road.id, fittedLine);
    }

    // 重采样
    const processedRoads = roads.map(road => {
      const fittedLine = fittedLines.get(road.id)!;
      const newPoints = this.resampleRoadPoints(fittedLine, sampleDistance);
      return { ...road, points: newPoints };
    });

    return { processedRoads, fittedLines, directions: ortho };
  }
}

// ============================================================
// 路口处理服务（支持倾斜道路）
// ============================================================

export class IntersectionProcessor {
  /**
   * 构建路口索引
   */
  buildIndex(intersections: Intersection[]): {
    byId: Map<string, Intersection>;
    byRoads: Map<string, string>;
    byRoad: Map<string, string[]>;
  } {
    const index = {
      byId: new Map<string, Intersection>(),
      byRoads: new Map<string, string>(),
      byRoad: new Map<string, string[]>()
    };

    for (const inter of intersections) {
      index.byId.set(inter.id, inter);
      if (inter.road_v_id && inter.road_h_id) {
        index.byRoads.set(`${inter.road_v_id}:${inter.road_h_id}`, inter.id);
      }
      if (inter.road_v_id) {
        if (!index.byRoad.has(inter.road_v_id)) index.byRoad.set(inter.road_v_id, []);
        index.byRoad.get(inter.road_v_id)!.push(inter.id);
      }
      if (inter.road_h_id) {
        if (!index.byRoad.has(inter.road_h_id)) index.byRoad.set(inter.road_h_id, []);
        index.byRoad.get(inter.road_h_id)!.push(inter.id);
      }
    }
    return index;
  }

  /**
   * 获取相邻交点（基于方向向量投影）
   */
  getNeighborIntersections(
    inter: Intersection,
    index: { byId: Map<string, Intersection>; byRoad: Map<string, string[]> },
    longitudinalAngle: number,
    horizontalAngle: number
  ): {
    vPositive: Intersection | null;
    vNegative: Intersection | null;
    hPositive: Intersection | null;
    hNegative: Intersection | null;
  } {
    const result = { vPositive: null as Intersection | null, vNegative: null as Intersection | null, hPositive: null as Intersection | null, hNegative: null as Intersection | null };

    const dv = { x: Math.cos(longitudinalAngle), y: Math.sin(longitudinalAngle) };
    const dh = { x: Math.cos(horizontalAngle), y: Math.sin(horizontalAngle) };

    // 纵向路上的相邻交点
    const vInterIds = index.byRoad.get(inter.road_v_id || '') || [];
    const vOthers = vInterIds.map(id => index.byId.get(id)!).filter(o => o && o.id !== inter.id);

    if (vOthers.length > 0) {
      const vProjs = vOthers.map(o => ({
        proj: (o.center.mapXy.x - inter.center.mapXy.x) * dv.x + (o.center.mapXy.y - inter.center.mapXy.y) * dv.y,
        inter: o
      }));
      const posNeighbors = vProjs.filter(p => p.proj > 0).sort((a, b) => a.proj - b.proj);
      const negNeighbors = vProjs.filter(p => p.proj < 0).sort((a, b) => Math.abs(a.proj) - Math.abs(b.proj));
      if (posNeighbors.length > 0) result.vPositive = posNeighbors[0].inter;
      if (negNeighbors.length > 0) result.vNegative = negNeighbors[0].inter;
    }

    // 横向路上的相邻交点
    const hInterIds = index.byRoad.get(inter.road_h_id || '') || [];
    const hOthers = hInterIds.map(id => index.byId.get(id)!).filter(o => o && o.id !== inter.id);

    if (hOthers.length > 0) {
      const hProjs = hOthers.map(o => ({
        proj: (o.center.mapXy.x - inter.center.mapXy.x) * dh.x + (o.center.mapXy.y - inter.center.mapXy.y) * dh.y,
        inter: o
      }));
      const posNeighbors = hProjs.filter(p => p.proj > 0).sort((a, b) => a.proj - b.proj);
      const negNeighbors = hProjs.filter(p => p.proj < 0).sort((a, b) => Math.abs(a.proj) - Math.abs(b.proj));
      if (posNeighbors.length > 0) result.hPositive = posNeighbors[0].inter;
      if (negNeighbors.length > 0) result.hNegative = negNeighbors[0].inter;
    }

    return result;
  }

  /**
   * 判断象限有效性
   */
  getValidQuadrants(
    neighbors: { vPositive: Intersection | null; vNegative: Intersection | null; hPositive: Intersection | null; hNegative: Intersection | null },
    index: { byRoads: Map<string, string> }
  ): number[] {
    const valid: number[] = [];

    // Q0: vPositive + hPositive
    if (neighbors.vPositive && neighbors.hPositive) {
      const key = `${neighbors.vPositive.road_v_id}:${neighbors.hPositive.road_h_id}`;
      if (index.byRoads.has(key)) valid.push(0);
    }
    // Q1: vNegative + hPositive
    if (neighbors.vNegative && neighbors.hPositive) {
      const key = `${neighbors.vNegative.road_v_id}:${neighbors.hPositive.road_h_id}`;
      if (index.byRoads.has(key)) valid.push(1);
    }
    // Q2: vNegative + hNegative
    if (neighbors.vNegative && neighbors.hNegative) {
      const key = `${neighbors.vNegative.road_v_id}:${neighbors.hNegative.road_h_id}`;
      if (index.byRoads.has(key)) valid.push(2);
    }
    // Q3: vPositive + hNegative
    if (neighbors.vPositive && neighbors.hNegative) {
      const key = `${neighbors.vPositive.road_v_id}:${neighbors.hNegative.road_h_id}`;
      if (index.byRoads.has(key)) valid.push(3);
    }

    return valid;
  }

  /**
   * 处理所有路口
   */
  processIntersections(
    intersections: Intersection[],
    longitudinalAngle: number,
    horizontalAngle: number
  ): Intersection[] {
    const index = this.buildIndex(intersections);

    return intersections.map(inter => {
      const neighbors = this.getNeighborIntersections(inter, index, longitudinalAngle, horizontalAngle);
      const validQuadrants = this.getValidQuadrants(neighbors, index);
      const numQ = validQuadrants.length;
      const type = numQ === 1 ? 'L' : numQ === 2 ? 'T' : numQ === 4 ? 'cross' : `partial_${numQ}`;

      return {
        ...inter,
        type: type as any,
        neighbors: {
          top: neighbors.hPositive?.id,
          bottom: neighbors.hNegative?.id,
          left: neighbors.vNegative?.id,
          right: neighbors.vPositive?.id,
          top_road_id: neighbors.hPositive?.road_h_id,
          bottom_road_id: neighbors.hNegative?.road_h_id,
          left_road_id: neighbors.vNegative?.road_v_id,
          right_road_id: neighbors.vPositive?.road_v_id
        },
        valid_quadrants: validQuadrants
      };
    });
  }
}

// ============================================================
// 圆弧生成服务（支持倾斜道路）
// ============================================================

export class TurnArcGenerator {
  private coordinateService: CoordinateService;

  constructor(coordinateService: CoordinateService) {
    this.coordinateService = coordinateService;
  }

  /**
   * 生成单个圆弧（支持倾斜道路）
   * 完全按照Python generate_arc_with_orientation实现
   */
  generateArc(
    inter: Intersection,
    quadrant: number,
    roadVAngle: number,
    roadHAngle: number,
    radius: number = 4.5,
    numPoints: number = 36
  ): TurnArc {
    const cx = inter.center.mapXy.x;
    const cy = inter.center.mapXy.y;

    // 方向向量
    const dvX = Math.cos(roadVAngle);
    const dvY = Math.sin(roadVAngle);
    const dhX = Math.cos(roadHAngle);
    const dhY = Math.sin(roadHAngle);

    // 象限符号
    // 象限0：右上角转弯，圆心在(外部右上)
    // 象限1：左上角转弯，圆心在(外部左上)
    // 象限2：左下角转弯，圆心在(外部左下)
    // 象限3：右下角转弯，圆心在(外部右下)
    const quadrantSigns: Record<number, [number, number]> = {
      0: [1, 1],   // 右上：signV=+1(向上), signH=+1(向右), 圆心在(外部右上)
      1: [-1, 1],  // 左上：signV=-1(向下错!应该是+1), signH=+1(向左错!应该是-1)
      2: [-1, -1], // 左下：signV=-1(向下), signH=-1(向左), 圆心在(外部左下)
      3: [1, -1]   // 右下：signV=+1(向上错!应该是-1), signH=-1(向右错!应该是+1)
    };
    const [signV, signH] = quadrantSigns[quadrant];

    // 圆心坐标：圆心在路口外部的对角位置
    // 例如象限0：圆心在路口右上方 (cx + R*dvX + R*dhX, cy + R*dvY + R*dhY)
    const ox = cx + signV * radius * dvX + signH * radius * dhX;
    const oy = cy + signV * radius * dvY + signH * radius * dhY;

    // 切点1：在纵向路上（从交点沿纵向路方向偏移 signV * R）
    const t1x = cx + signV * radius * dvX;
    const t1y = cy + signV * radius * dvY;

    // 切点2：在横向路上（从交点沿横向路方向偏移 signH * R）
    const t2x = cx + signH * radius * dhX;
    const t2y = cy + signH * radius * dhY;

    // 离散化圆弧
    const arcPoints = this.discretizeQuarterArc(
      { x: ox, y: oy }, radius,
      { x: t1x, y: t1y }, { x: t2x, y: t2y },
      quadrant, numPoints
    );

    const points: TurnArcPoint[] = arcPoints.map((pt, i) => {
      const gps = this.coordinateService.mapToGps(pt.x, pt.y);
      return {
        seq: i,
        gps: { latitude: gps.lat, longitude: gps.lon, altitude: 0 },
        mapXy: { x: pt.x, y: pt.y }
      };
    });

    return {
      id: `arc_${inter.id}_${quadrant}`,
      intersectionId: inter.id,
      quadrant,
      radius,
      center: { x: ox, y: oy },
      tangentPoints: [{ x: t1x, y: t1y }, { x: t2x, y: t2y }],
      points
    };
  }

/**
   * 离散化四分之一圆弧
   * 四分之一圆弧：从切点1到切点2，经过90度的圆弧
   */
  private discretizeQuarterArc(
    center: Point2D,
    radius: number,
    start: Point2D,
    end: Point2D,
    quadrant: number,
    numPoints: number
  ): Point2D[] {
    const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
    const endAngle = Math.atan2(end.y - center.y, end.x - center.x);

    // 计算角度差
    let angleDiff = endAngle - startAngle;

    // 归一化到 [-π, π]
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

    // 四分之一圆弧的角度差应该约±π/2（90度）
    // 如果归一化后的角度差接近±π（180度）或更大，说明需要反转
    // 例如：如果角度差是-90°（270°的补角），这就是正确的四分之一圆弧
    // 如果角度差是90°，也是正确的四分之一圆弧
    // 只有当角度差接近±180°时才需要反转

    // 不需要反转，直接使用归一化后的角度差
    // 归一化后的角度差约±90°就是正确的四分之一圆弧

    const points: Point2D[] = [];
    for (let i = 0; i <= numPoints; i++) {
      const t = i / numPoints;
      const angle = startAngle + t * angleDiff;
      points.push({
        x: center.x + radius * Math.cos(angle),
        y: center.y + radius * Math.sin(angle)
      });
    }

    return points;
  }

  /**
   * 生成所有圆弧
   */
  generateAllTurnArcs(
    intersections: Intersection[],
    longitudinalAngle: number,
    horizontalAngle: number,
    radius: number = 4.5
  ): TurnArc[] {
    const allArcs: TurnArc[] = [];

    for (const inter of intersections) {
      const validQuadrants = inter.valid_quadrants || [];

      for (const q of validQuadrants) {
        const arc = this.generateArc(inter, q, longitudinalAngle, horizontalAngle, radius);
        allArcs.push(arc);
      }
    }

    console.log(`[TurnArcGenerator] 生成 ${allArcs.length} 条圆弧`);
    return allArcs;
  }
}

// ============================================================
// 梁位处理服务
// ============================================================

export class BeamPositionProcessor {
  buildIndex(intersections: Intersection[]): {
    byId: Map<string, Intersection>;
    byRoads: Map<string, string>;
    byRoad: Map<string, string[]>;
  } {
    const index = {
      byId: new Map<string, Intersection>(),
      byRoads: new Map<string, string>(),
      byRoad: new Map<string, string[]>()
    };
    for (const inter of intersections) {
      index.byId.set(inter.id, inter);
      if (inter.road_v_id && inter.road_h_id) {
        index.byRoads.set(`${inter.road_v_id}:${inter.road_h_id}`, inter.id);
      }
      if (inter.road_v_id) {
        if (!index.byRoad.has(inter.road_v_id)) index.byRoad.set(inter.road_v_id, []);
        index.byRoad.get(inter.road_v_id)!.push(inter.id);
      }
      if (inter.road_h_id) {
        if (!index.byRoad.has(inter.road_h_id)) index.byRoad.set(inter.road_h_id, []);
        index.byRoad.get(inter.road_h_id)!.push(inter.id);
      }
    }
    return index;
  }

  generateBeamPositions(intersections: Intersection[], roads: Road[]): BeamPosition[] {
    const index = this.buildIndex(intersections);

    // 计算纵向道路的平均X坐标，按X从小到大排序（西到东）
    const longitudinalRoads = roads
      .filter(r => r.type === 'longitudinal')
      .map(r => {
        const xs = r.points.map(p => p.mapXy.x);
        const avgX = xs.reduce((sum, x) => sum + x, 0) / xs.length;
        return { ...r, _avgX: avgX };
      })
      .sort((a, b) => a._avgX - b._avgX);

    // 计算横向道路的平均Y坐标，按Y从小到大排序（南到北）
    const horizontalRoads = roads
      .filter(r => r.type === 'horizontal')
      .map(r => {
        const ys = r.points.map(p => p.mapXy.y);
        const avgY = ys.reduce((sum, y) => sum + y, 0) / ys.length;
        return { ...r, _avgY: avgY };
      })
      .sort((a, b) => a._avgY - b._avgY);

    console.log('[BeamPositionProcessor] 纵向道路排序（西→东）:');
    longitudinalRoads.forEach(r => {
      console.log(`  ${r.name} (${r.id}): 平均X=${r._avgX.toFixed(2)}`);
    });
    console.log('[BeamPositionProcessor] 横向道路排序（南→北）:');
    horizontalRoads.forEach(r => {
      console.log(`  ${r.name} (${r.id}): 平均Y=${r._avgY.toFixed(2)}`);
    });

    const beamPositions: BeamPosition[] = [];

    for (let i = 0; i < longitudinalRoads.length - 1; i++) {
      const roadWest = longitudinalRoads[i];
      const roadEast = longitudinalRoads[i + 1];

      for (let j = 0; j < horizontalRoads.length - 1; j++) {
        const roadSouth = horizontalRoads[j];
        const roadNorth = horizontalRoads[j + 1];

        // 查找四个角的交叉点
        // SW: 西侧纵向道路 + 南侧横向道路
        // SE: 东侧纵向道路 + 南侧横向道路
        // NW: 西侧纵向道路 + 北侧横向道路
        // NE: 东侧纵向道路 + 北侧横向道路
        const swId = index.byRoads.get(`${roadWest.id}:${roadSouth.id}`);
        const seId = index.byRoads.get(`${roadEast.id}:${roadSouth.id}`);
        const nwId = index.byRoads.get(`${roadWest.id}:${roadNorth.id}`);
        const trId = index.byRoads.get(`${roadEast.id}:${roadNorth.id}`);

        if (swId && seId && nwId && trId) {
          const sw = index.byId.get(swId)!;
          const se = index.byId.get(seId)!;
          const nw = index.byId.get(nwId)!;
          const tr = index.byId.get(trId)!;

          const centerX = (sw.center.mapXy.x + se.center.mapXy.x + nw.center.mapXy.x + tr.center.mapXy.x) / 4;
          const centerY = (sw.center.mapXy.y + se.center.mapXy.y + nw.center.mapXy.y + tr.center.mapXy.y) / 4;

          const beamName = `${roadWest.name}-${roadEast.name} × ${roadSouth.name}-${roadNorth.name}`;

          beamPositions.push({
            id: `beam_${roadWest.name}${roadEast.name}_${roadSouth.name}${roadNorth.name}`,
            name: beamName,
            row: `${roadWest.name}-${roadEast.name}`,
            col: j + 1,
            center: { x: centerX, y: centerY },
            boundaries: { north: roadNorth.id, south: roadSouth.id, east: roadEast.id, west: roadWest.id },
            corner_intersections: [swId, seId, nwId, trId],
            neighbors: {}
          });

          console.log(`[BeamPositionProcessor] 生成梁位: ${beamName}`);
          console.log(`  西: ${roadWest.name}(X=${roadWest._avgX.toFixed(2)}), 东: ${roadEast.name}(X=${roadEast._avgX.toFixed(2)})`);
          console.log(`  南: ${roadSouth.name}(Y=${roadSouth._avgY.toFixed(2)}), 北: ${roadNorth.name}(Y=${roadNorth._avgY.toFixed(2)})`);
          console.log(`  角点: SW=${swId}, SE=${seId}, NW=${nwId}, NE=${trId}`);
        }
      }
    }

    // 设置邻居关系（基于边界道路重叠判断）
    for (const beam of beamPositions) {
      const neighbors: any = {};
      for (const other of beamPositions) {
        if (beam.id === other.id) continue;

        // 查找左侧相邻梁位（共享西侧道路）
        if (other.boundaries.east === beam.boundaries.west &&
            other.boundaries.south === beam.boundaries.south &&
            other.boundaries.north === beam.boundaries.north) {
          neighbors.left = other.id;
        }
        // 查找右侧相邻梁位（共享东侧道路）
        if (other.boundaries.west === beam.boundaries.east &&
            other.boundaries.south === beam.boundaries.south &&
            other.boundaries.north === beam.boundaries.north) {
          neighbors.right = other.id;
        }
        // 查找上方相邻梁位（共享北侧道路）
        if (other.boundaries.south === beam.boundaries.north &&
            other.boundaries.west === beam.boundaries.west &&
            other.boundaries.east === beam.boundaries.east) {
          neighbors.top = other.id;
        }
        // 查找下方相邻梁位（共享南侧道路）
        if (other.boundaries.north === beam.boundaries.south &&
            other.boundaries.west === beam.boundaries.west &&
            other.boundaries.east === beam.boundaries.east) {
          neighbors.bottom = other.id;
        }
      }
      beam.neighbors = neighbors;
    }

    console.log(`[BeamPositionProcessor] 识别 ${beamPositions.length} 个梁位`);
    return beamPositions;
  }
}

// ============================================================
// 地图文件生成服务
// ============================================================

export class MapFileGenerator {
  private coordinateService: CoordinateService;

  constructor(coordinateService: CoordinateService) {
    this.coordinateService = coordinateService;
  }

  generatePGMMap(
    roads: Road[],
    turnArcs: TurnArc[],
    resolution: number = 0.1,
    preferredWidth: number = 1.4,
    highCostWidth: number = 0.3,
    margin: number = 5.0
  ): { pgm: Buffer; width: number; height: number; origin: number[] } {
    // 收集所有点
    const allPoints: Point2D[] = [];
    for (const road of roads) {
      if (!road.points || road.points.length === 0) continue;
      for (const p of road.points) {
        if (p.mapXy) allPoints.push(p.mapXy);
      }
    }
    for (const arc of turnArcs) {
      if (!arc.points || arc.points.length === 0) continue;
      for (const p of arc.points) {
        if (p.mapXy) allPoints.push(p.mapXy);
      }
    }

    if (allPoints.length === 0) {
      throw new Error(`没有道路点数据: 道路${roads.length}条, 圆弧${turnArcs.length}条, 总点数0`);
    }

    const minX = Math.min(...allPoints.map(p => p.x)) - margin;
    const maxX = Math.max(...allPoints.map(p => p.x)) + margin;
    const minY = Math.min(...allPoints.map(p => p.y)) - margin;
    const maxY = Math.max(...allPoints.map(p => p.y)) + margin;

    const width = Math.floor((maxX - minX) / resolution) + 1;
    const height = Math.floor((maxY - minY) / resolution) + 1;

    // 检查地图尺寸是否合理
    if (width > 10000 || height > 10000) {
      throw new Error(`地图尺寸过大: ${width}x${height}, 请检查数据或增大分辨率`);
    }
    if (width < 2 || height < 2) {
      throw new Error(`地图尺寸过小: ${width}x${height}, 请检查数据`);
    }

    console.log(`[PGM] 生成地图 ${width}x${height}, 道路${roads.length}条, 圆弧${turnArcs.length}条`);

    // 创建中心线图像 (0=道路中心线, 255=其他)
    const centerlineImg: number[][] = [];
    for (let y = 0; y < height; y++) {
      centerlineImg.push(new Array(width).fill(255));
    }

    // 绘制道路中心线
    for (const road of roads) {
      if (!road.points) continue;
      for (let i = 0; i < road.points.length - 1; i++) {
        if (road.points[i].mapXy && road.points[i + 1].mapXy) {
          this.drawLine(centerlineImg, road.points[i].mapXy, road.points[i + 1].mapXy, minX, minY, resolution, 0);
        }
      }
    }
    // 绘制圆弧
    for (const arc of turnArcs) {
      if (!arc.points) continue;
      for (let i = 0; i < arc.points.length - 1; i++) {
        if (arc.points[i].mapXy && arc.points[i + 1].mapXy) {
          this.drawLine(centerlineImg, arc.points[i].mapXy, arc.points[i + 1].mapXy, minX, minY, resolution, 0);
        }
      }
    }

    // 生成代价地图
    const costmap = this.generateCostmap(centerlineImg, preferredWidth, highCostWidth, resolution);

    // 释放中心线图像内存
    centerlineImg.length = 0;

    const pgmBuffer = this.createPGMBuffer(costmap);

    // 释放代价地图内存
    costmap.length = 0;

    return { pgm: pgmBuffer, width, height, origin: [minX, minY, 0.0] };
  }

  private drawLine(img: number[][], start: Point2D, end: Point2D, ox: number, oy: number, res: number, val: number): void {
    const h = img.length, w = img[0]?.length || 0;
    let x0 = Math.floor((start.x - ox) / res), y0 = h - 1 - Math.floor((start.y - oy) / res);
    let x1 = Math.floor((end.x - ox) / res), y1 = h - 1 - Math.floor((end.y - oy) / res);
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while (true) {
      if (y0 >= 0 && y0 < h && x0 >= 0 && x0 < w) img[y0][x0] = val;
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  }

  private generateCostmap(centerlineImg: number[][], pw: number, hw: number, res: number): number[][] {
    const h = centerlineImg.length, w = centerlineImg[0]?.length || 0;

    // 计算最大需要处理的距离（超出此距离的区域直接设为禁区）
    const maxDist = pw + hw + res; // 额外加res作为缓冲

    // 初始化距离地图，使用null表示未处理（比Infinity更省内存）
    const distMap: (number | null)[][] = [];
    for (let y = 0; y < h; y++) {
      distMap.push(new Array(w).fill(null));
    }

    // 使用简单队列（数组 + 索引，比 shift() 快得多）
    const queue: number[] = [];
    let queueHead = 0;

    // 找到所有中心线点作为起点
    let centerlineCount = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (centerlineImg[y][x] === 0) {
          distMap[y][x] = 0;
          queue.push(x, y);
          centerlineCount++;
        }
      }
    }

    if (centerlineCount === 0) {
      // 返回空白代价地图
      const emptyCostmap: number[][] = [];
      for (let y = 0; y < h; y++) {
        emptyCostmap.push(new Array(w).fill(254));
      }
      return emptyCostmap;
    }

    // BFS计算距离（使用索引而非shift），带提前终止优化
    const dirs = [0, 1, 0, -1, 1, 0, -1, 0]; // [dx1, dy1, dx2, dy2, ...]

    while (queueHead < queue.length) {
      const cx = queue[queueHead++];
      const cy = queue[queueHead++];

      const currentDist = distMap[cy][cx] as number;

      // 提前终止：如果当前距离已经超过最大处理距离，跳过扩展
      if (currentDist >= maxDist) {
        continue;
      }

      for (let d = 0; d < 4; d++) {
        const nx = cx + dirs[d * 2];
        const ny = cy + dirs[d * 2 + 1];

        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          const nd = currentDist + res;
          const existing = distMap[ny][nx];
          if (existing === null || nd < existing) {
            distMap[ny][nx] = nd;
            queue.push(nx, ny);
          }
        }
      }
    }

    // 释放队列内存
    queue.length = 0;

    // 生成代价地图
    // Nav2 scale模式配合 negate: 1（反向模式）:
    // 灰度值直接映射到代价
    // 0 = 自由空间 (FREE_SPACE)
    // 1-253 = 不同代价等级
    // 254 = 致命障碍物 (LETHAL_OBSTACLE)
    // 255 = 未知空间 (NO_INFORMATION)
    //
    // 我们使用离散分级而不是渐变，以便更清晰地显示区域边界：
    // - 首选网络（中心线周围preferredWidth米）：灰度值0，机器人优先通行
    // - 高代价区（首选网络外highCostWidth米）：灰度值100，可通行但不推荐
    // - 禁区（超出高代价区）：灰度值254，不可通行
    const costmap: number[][] = [];

    // 计算像素距离阈值
    const preferredDistPixels = pw; // preferredWidth (米)
    const highCostDistPixels = pw + hw; // preferredWidth + highCostWidth (米)

    for (let y = 0; y < h; y++) {
      const row: number[] = [];
      for (let x = 0; x < w; x++) {
        const d = distMap[y][x];
        let cost: number;

        // 未处理的像素（距离超过maxDist）直接设为禁区
        if (d === null) {
          cost = 254;
        } else if (d <= preferredDistPixels) {
          // 首选网络区域：距离中心线 <= preferredWidth
          // 灰度值0（黑色），代价最低，机器人优先通行
          cost = 0;
        } else if (d <= highCostDistPixels) {
          // 高代价区：距离中心线在 preferredWidth 到 preferredWidth + highCostWidth 之间
          // 灰度值100（灰色），可通行但不推荐
          cost = 100;
        } else {
          // 禁区：距离太远，设置为致命障碍物
          // 灰度值254（接近白色），不可通行
          cost = 254;
        }
        row.push(cost);
      }
      costmap.push(row);
    }

    // 释放距离地图内存
    distMap.length = 0;

    return costmap;
  }

  private createPGMBuffer(img: number[][]): Buffer {
    const h = img.length;
    if (h === 0) {
      throw new Error('图像高度为0');
    }
    const w = img[0]?.length || 0;
    if (w === 0) {
      throw new Error('图像宽度为0');
    }

    const header = `P5\n${w} ${h}\n255\n`;
    const headerBuffer = Buffer.from(header, 'ascii');
    const dataBuffer = Buffer.alloc(h * w);
    let idx = 0;

    for (let y = 0; y < h; y++) {
      const row = img[y];
      if (!row || row.length !== w) {
        console.warn(`[createPGMBuffer] 警告: 第${y}行数据长度不正确, 期望${w}, 实际${row?.length || 0}`);
        // 填充默认值（禁区）
        for (let x = 0; x < w; x++) {
          dataBuffer[idx++] = 254;
        }
      } else {
        for (let x = 0; x < w; x++) {
          // 注意：row[x]可能为0（首选网络），不能使用 || 255
          const val = row[x];
          if (typeof val === 'number' && !isNaN(val)) {
            dataBuffer[idx++] = Math.max(0, Math.min(255, Math.floor(val)));
          } else {
            dataBuffer[idx++] = 254; // 默认禁区
          }
        }
      }
    }

    return Buffer.concat([headerBuffer, dataBuffer]);
  }

  generateYAMLConfig(imageName: string, resolution: number, origin: number[]): string {
    return `# GPS建图生成的代价地图配置文件
# Nav2 Costmap 官方标准值：
# - 0: 自由空间 (FREE_SPACE) - 黑色，机器人优先通行
# - 1-253: 不同代价级别 - 灰色渐变
# - 254: 致命障碍 (LETHAL_OBSTACLE) - 接近白色，不可通行
# - 255: 未知空间 (NO_INFORMATION) - 白色
#
# 本地图使用三级代价：
# - 0 (黑色): 首选网络/道路中心线，机器人优先通行
# - 100 (灰色): 高代价区/道路边缘，可通行但不推荐
# - 254 (接近白色): 禁区/道路外区域，不可通行
image: ${imageName}
resolution: ${resolution}
origin: [${origin[0]}, ${origin[1]}, ${origin[2] || 0.0}]
negate: 0
occupied_thresh: 0.99  # 254/255 ≈ 0.99，灰度值>=254视为障碍
free_thresh: 0.01      # 灰度值<=2视为自由空间
mode: scale
`;
  }

  generateGPSRoutesJSON(
    origin: any,
    roads: Road[],
    intersections: Intersection[],
    turnArcs: TurnArc[]
  ): object {
    const gpsCoord = origin.gps.latitude !== undefined
      ? { lat: origin.gps.latitude, lon: origin.gps.longitude }
      : origin.gps;

    return {
      version: '5.0',
      origin: { gps: gpsCoord, utm: origin.utm, rotation: origin.rotation || 0 },
      roads: roads.map(r => ({
        id: r.id, name: r.name, type: r.type, params: r.params,
        points: r.points.map(p => ({ seq: p.seq, gps: p.gps, map_xy: p.mapXy }))
      })),
      intersections: intersections.map(i => ({
        id: i.id, type: i.type,
        center: { gps: i.center.gps, map_xy: i.center.mapXy },
        road_v_id: i.road_v_id, road_h_id: i.road_h_id,
        connected_roads: i.connectedRoads,
        neighbors: i.neighbors, valid_quadrants: i.valid_quadrants
      })),
      turn_arcs: turnArcs.map(a => ({
        id: a.id, intersection_id: a.intersectionId, quadrant: a.quadrant, radius: a.radius,
        center: a.center, tangent_points: a.tangentPoints,
        points: a.points.map(p => ({ seq: p.seq, gps: p.gps, map_xy: p.mapXy })),
        beam_position_id: a.beam_position_id
      }))
    };
  }

  generateBeamPositionsJSON(beamPositions: BeamPosition[]): object {
    return {
      version: '1.0',
      positions: beamPositions.map(b => ({
        id: b.id, name: b.name, row: b.row, col: b.col, center: b.center,
        boundaries: b.boundaries, corner_intersections: b.corner_intersections, neighbors: b.neighbors
      }))
    };
  }
}

// ============================================================
// 导出
// ============================================================

export { Point2D as Point2DType, FittedLine as FittedLineType, GPSOrigin as GPSOriginType };
