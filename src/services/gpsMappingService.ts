/**
 * GPS道路数据处理与圆弧生成服务
 * 完全按照设计文档实现：
 * - docs/GPS_ROAD_DATA_PROCESSING_ALGORITHM.md
 * - docs/TURN_ARC_GENERATION_ALGORITHM.md
 * 
 * @version 4.0
 * @date 2026-03-24
 */

import { GPSPoint, MapPoint, Road, RoadPoint, Intersection, TurnArc, TurnArcPoint, BeamPosition } from '../models/GPSMap';

// ============================================================
// 第一部分：基础数据类型定义
// ============================================================

/** 二维坐标点 */
export interface Point2D {
  x: number;
  y: number;
}

/** GPS坐标 */
export interface GPScoord {
  lat: number;
  lon: number;
}

/** 拟合直线 */
export interface FittedLine {
  start: Point2D;
  end: Point2D;
  directionAngle: number; // 方向角度（弧度）
  roadId: string;
  /** 计算直线长度 */
  length(): number;
}

/** 相邻交点信息 */
export interface NeighborInfo {
  top: Intersection | null;
  bottom: Intersection | null;
  left: Intersection | null;
  right: Intersection | null;
  topRoadId: string | null;
  bottomRoadId: string | null;
  leftRoadId: string | null;
  rightRoadId: string | null;
}

/** 路口索引 */
export interface IntersectionIndex {
  byId: Map<string, Intersection>;
  byRoads: Map<string, string>; // key: `${roadVId}:${roadHId}`
  byRoad: Map<string, string[]>; // roadId -> intersectionIds[]
}

/** GPS原点信息 */
export interface GPSOrigin {
  gps: GPScoord;
  utm: {
    zone: number;
    easting: number;
    northing: number;
  };
  rotation: number;
}

/** 地图生成参数 */
export interface MapGenParams {
  preferredWidth: number;  // 首选网络宽度（米）
  highCostWidth: number;   // 高代价区宽度（米）
  resolution: number;      // 分辨率（米/像素）
  margin: number;          // 边距（米）
  turnRadius: number;      // 转弯半径（米）
  sampleDistance: number;  // 重采样间距（米）
}

/** 默认参数 */
export const DEFAULT_MAP_PARAMS: MapGenParams = {
  preferredWidth: 0.7,
  highCostWidth: 0.3,
  resolution: 0.05,
  margin: 5.0,
  turnRadius: 4.5,
  sampleDistance: 0.2
};

// ============================================================
// 第二部分：坐标转换服务
// ============================================================

/**
 * 坐标转换服务
 * 负责GPS、UTM、地图坐标之间的转换
 */
export class CoordinateService {
  private origin: GPSOrigin;
  private utmZone: number;
  
  constructor(origin: GPSOrigin) {
    this.origin = origin;
    this.utmZone = origin.utm.zone;
  }
  
  /**
   * GPS坐标转UTM坐标
   */
  gpsToUtm(lat: number, lon: number): { easting: number; northing: number } {
    // 使用简化的UTM转换公式（适用于小范围）
    const latRad = lat * Math.PI / 180;
    const lonRad = lon * Math.PI / 180;
    const lonOrigin = ((this.utmZone - 1) * 6 - 180 + 3) * Math.PI / 180;
    
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
  
  /**
   * UTM坐标转GPS坐标
   */
  utmToGps(easting: number, northing: number): { lat: number; lon: number } {
    const k0 = 0.9996;
    const a = 6378137.0;
    const e = 0.081819191;
    const e1 = (1 - Math.sqrt(1 - e * e)) / (1 + Math.sqrt(1 - e * e));
    
    const x = easting - 500000;
    const y = northing;
    
    const lonOrigin = ((this.utmZone - 1) * 6 - 180 + 3) * Math.PI / 180;
    
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
    
    return {
      lat: lat * 180 / Math.PI,
      lon: lon * 180 / Math.PI
    };
  }
  
  /**
   * GPS坐标转地图坐标
   */
  gpsToMap(lat: number, lon: number): Point2D {
    const utm = this.gpsToUtm(lat, lon);
    return {
      x: utm.easting - this.origin.utm.easting,
      y: utm.northing - this.origin.utm.northing
    };
  }
  
  /**
   * 地图坐标转GPS坐标
   */
  mapToGps(x: number, y: number): { lat: number; lon: number } {
    const easting = x + this.origin.utm.easting;
    const northing = y + this.origin.utm.northing;
    return this.utmToGps(easting, northing);
  }
  
  /**
   * 计算两点之间的球面距离（Haversine公式）
   */
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
  
  /**
   * 计算两点之间的平面距离
   */
  planarDistance(p1: Point2D, p2: Point2D): number {
    return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
  }
  
  /**
   * 获取原点信息
   */
  getOrigin(): GPSOrigin {
    return this.origin;
  }
  
  // ==================== 兼容接口 ====================
  
  /**
   * 兼容接口：GPS转UTM（返回带zone的对象）
   */
  toUTM(lat: number, lon: number): { zone: number; easting: number; northing: number } {
    const utm = this.gpsToUtm(lat, lon);
    return {
      zone: this.utmZone,
      easting: utm.easting,
      northing: utm.northing
    };
  }
  
  /**
   * 兼容接口：地图坐标转GPS（大写GPS）
   */
  mapToGPS(x: number, y: number): { lat: number; lon: number } {
    return this.mapToGps(x, y);
  }
}

// ============================================================
// 第三部分：GPS道路数据处理服务
// ============================================================

/**
 * GPS道路数据处理服务
 * 实现：异常点剔除、主方向识别、道路拟合、边缘路口处理、重采样
 */
export class GPSRoadProcessor {
  private coordinateService: CoordinateService | null = null;
  
  constructor(coordinateService?: CoordinateService) {
    this.coordinateService = coordinateService || null;
  }
  
  /**
   * 设置坐标服务
   */
  setCoordinateService(cs: CoordinateService): void {
    this.coordinateService = cs;
  }
  
  /**
   * 步骤1：异常点剔除
   * 注意：对于已处理好的道路数据，maxDistance 应设置较大值（如10米）
   * 以避免过度删除正常的稀疏GPS点
   */
  removeOutlierPoints(points: RoadPoint[], maxDistance: number = 10.0, minPoints: number = 3): RoadPoint[] {
    if (points.length < minPoints) {
      return points;
    }
    
    const validPoints: RoadPoint[] = [points[0]];
    
    for (let i = 1; i < points.length; i++) {
      const prev = validPoints[validPoints.length - 1];
      const curr = points[i];
      
      // 使用平面距离或球面距离
      const distance = this.coordinateService
        ? this.coordinateService.haversineDistance(prev.gps.latitude, prev.gps.longitude, curr.gps.latitude, curr.gps.longitude)
        : Math.sqrt((curr.mapXy.x - prev.mapXy.x) ** 2 + (curr.mapXy.y - prev.mapXy.y) ** 2);
      
      if (distance <= maxDistance) {
        validPoints.push(curr);
      }
    }
    
    if (validPoints.length < minPoints) {
      return points.slice(0, minPoints);
    }
    
    return validPoints;
  }
  
  /**
   * 步骤2：道路主方向识别
   */
  identifyRoadDirections(roads: Road[]): { longitudinalAngle: number; horizontalAngle: number } {
    const longitudinalRoads = roads.filter(r => r.type === 'longitudinal');
    const horizontalRoads = roads.filter(r => r.type === 'horizontal');
    
    const longitudinalAngles = longitudinalRoads.map(road => this.fitLineAngle(road.points));
    const horizontalAngles = horizontalRoads.map(road => this.fitLineAngle(road.points));
    
    const longitudinalAngle = this.circularMean(longitudinalAngles);
    const horizontalAngle = this.circularMean(horizontalAngles);
    
    const angleDiff = Math.abs(this.normalizeAngle(longitudinalAngle - horizontalAngle));
    
    if (!(Math.PI / 2 - 0.1 < angleDiff && angleDiff < Math.PI / 2 + 0.1)) {
      const correctedHorizontal = this.normalizeAngle(longitudinalAngle + Math.PI / 2);
      return { longitudinalAngle, horizontalAngle: correctedHorizontal };
    }
    
    return { longitudinalAngle, horizontalAngle };
  }
  
  /**
   * 拟合点集的方向角度（PCA方法）
   */
  fitLineAngle(points: RoadPoint[]): number {
    if (points.length < 2) {
      return 0.0;
    }
    
    const n = points.length;
    const meanX = points.reduce((sum, p) => sum + p.mapXy.x, 0) / n;
    const meanY = points.reduce((sum, p) => sum + p.mapXy.y, 0) / n;
    
    const covXX = points.reduce((sum, p) => sum + (p.mapXy.x - meanX) ** 2, 0) / n;
    const covYY = points.reduce((sum, p) => sum + (p.mapXy.y - meanY) ** 2, 0) / n;
    const covXY = points.reduce((sum, p) => sum + (p.mapXy.x - meanX) * (p.mapXy.y - meanY), 0) / n;
    
    if (Math.abs(covXY) < 1e-10) {
      return covXX > covYY ? 0.0 : Math.PI / 2;
    }
    
    const angle = 0.5 * Math.atan2(2 * covXY, covXX - covYY);
    return this.normalizeAngle(angle);
  }
  
  /**
   * 计算角度的圆周平均
   */
  circularMean(angles: number[]): number {
    if (angles.length === 0) {
      return 0.0;
    }
    
    const sinSum = angles.reduce((sum, a) => sum + Math.sin(a), 0);
    const cosSum = angles.reduce((sum, a) => sum + Math.cos(a), 0);
    
    return Math.atan2(sinSum, cosSum);
  }
  
  /**
   * 将角度归一化到 [0, π) 范围
   */
  normalizeAngle(angle: number): number {
    while (angle < 0) {
      angle += Math.PI;
    }
    while (angle >= Math.PI) {
      angle -= Math.PI;
    }
    return angle;
  }
  
  /**
   * 步骤3：主方向约束下拟合道路直线
   */
  fitRoadWithDirection(road: Road, mainAngle: number): FittedLine {
    const points = road.points;
    
    if (points.length < 2) {
      throw new Error(`道路 ${road.id} 点数不足`);
    }
    
    const dx = Math.cos(mainAngle);
    const dy = Math.sin(mainAngle);
    const perpDx = -dy;
    const perpDy = dx;
    
    const projections: number[] = [];
    const offsets: number[] = [];
    
    for (const p of points) {
      const proj = p.mapXy.x * dx + p.mapXy.y * dy;
      projections.push(proj);
      const offset = p.mapXy.x * perpDx + p.mapXy.y * perpDy;
      offsets.push(offset);
    }
    
    const sortedOffsets = [...offsets].sort((a, b) => a - b);
    const centerOffset = sortedOffsets[Math.floor(sortedOffsets.length / 2)];
    
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
    
    return createFittedLine(start, end, mainAngle, road.id);
  }
  
  /**
   * 计算两条直线的交点
   */
  calculateIntersection(lineV: FittedLine, lineH: FittedLine): Point2D | null {
    const startV = lineV.start;
    const dirV = this.directionVector(lineV);
    const startH = lineH.start;
    const dirH = this.directionVector(lineH);
    
    const denom = dirV.x * dirH.y - dirV.y * dirH.x;
    
    if (Math.abs(denom) < 1e-10) {
      return null;
    }
    
    const dx = startH.x - startV.x;
    const dy = startH.y - startV.y;
    const t = (dx * dirH.y - dy * dirH.x) / denom;
    
    return {
      x: startV.x + t * dirV.x,
      y: startV.y + t * dirV.y
    };
  }
  
  /**
   * 获取直线的方向向量
   */
  directionVector(line: FittedLine): Point2D {
    const length = line.length();
    if (length < 1e-10) {
      return { x: 0, y: 0 };
    }
    return {
      x: (line.end.x - line.start.x) / length,
      y: (line.end.y - line.start.y) / length
    };
  }
  
  /**
   * 判断是否为边缘路口
   */
  isEdgeIntersection(
    lineV: FittedLine,
    lineH: FittedLine,
    intersection: Point2D,
    tolerance: number = 1.5
  ): { isEdge: boolean; vStatus: string; hStatus: string } {
    const dirV = this.directionVector(lineV);
    const dirH = this.directionVector(lineH);
    
    const vProjStart = (intersection.x - lineV.start.x) * dirV.x + (intersection.y - lineV.start.y) * dirV.y;
    const vProjEnd = (intersection.x - lineV.end.x) * dirV.x + (intersection.y - lineV.end.y) * dirV.y;
    const vLength = lineV.length();
    
    const hProjStart = (intersection.x - lineH.start.x) * dirH.x + (intersection.y - lineH.start.y) * dirH.y;
    const hProjEnd = (intersection.x - lineH.end.x) * dirH.x + (intersection.y - lineH.end.y) * dirH.y;
    const hLength = lineH.length();
    
    let vStatus = 'normal';
    if (-tolerance <= vProjStart && vProjStart <= vLength + tolerance &&
        -tolerance <= vProjEnd && vProjEnd <= vLength + tolerance) {
      vStatus = 'normal';
    } else if (vProjStart > vLength + tolerance || vProjEnd > vLength + tolerance) {
      vStatus = 'trim';
    } else {
      vStatus = 'extend';
    }
    
    let hStatus = 'normal';
    if (-tolerance <= hProjStart && hProjStart <= hLength + tolerance &&
        -tolerance <= hProjEnd && hProjEnd <= hLength + tolerance) {
      hStatus = 'normal';
    } else if (hProjStart > hLength + tolerance || hProjEnd > hLength + tolerance) {
      hStatus = 'trim';
    } else {
      hStatus = 'extend';
    }
    
    const isEdge = vStatus !== 'normal' || hStatus !== 'normal';
    
    return { isEdge, vStatus, hStatus };
  }
  
  /**
   * 步骤4：道路点序列重采样
   */
  resampleRoadPoints(line: FittedLine, sampleDistance: number): RoadPoint[] {
    const length = line.length();
    const dirVec = this.directionVector(line);
    
    const numPoints = Math.floor(length / sampleDistance) + 1;
    const points: RoadPoint[] = [];
    
    for (let i = 0; i < numPoints; i++) {
      const dist = i * sampleDistance;
      const x = line.start.x + dist * dirVec.x;
      const y = line.start.y + dist * dirVec.y;
      
      let gps = { lat: 0, lon: 0 };
      if (this.coordinateService) {
        gps = this.coordinateService.mapToGps(x, y);
      }
      
      points.push({
        seq: i,
        gps: { latitude: gps.lat, longitude: gps.lon, altitude: 0 },
        mapXy: { x, y }
      });
    }
    
    return points;
  }
  
  // ==================== 兼容接口 ====================
  
  /**
   * 兼容接口：处理单条道路
   */
  processRoad(road: Road, mainAngle: number, coordinateService: CoordinateService): { fittedLine: FittedLine; resampledPoints: RoadPoint[] } {
    this.coordinateService = coordinateService;
    
    const cleanedPoints = this.removeOutlierPoints(road.points);
    const tempRoad = { ...road, points: cleanedPoints };
    const fittedLine = this.fitRoadWithDirection(tempRoad, mainAngle);
    const resampledPoints = this.resampleRoadPoints(fittedLine, 0.2);
    
    return { fittedLine, resampledPoints };
  }
  
  /**
   * 完整道路处理流程
   */
  processRoads(
    roads: Road[],
    params: MapGenParams
  ): { processedRoads: Road[]; fittedLines: Map<string, FittedLine>; directions: { longitudinalAngle: number; horizontalAngle: number } } {
    for (const road of roads) {
      road.points = this.removeOutlierPoints(road.points);
    }
    
    const directions = this.identifyRoadDirections(roads);
    console.log(`[GPSRoadProcessor] 主方向: 纵向=${(directions.longitudinalAngle * 180 / Math.PI).toFixed(1)}°, 横向=${(directions.horizontalAngle * 180 / Math.PI).toFixed(1)}°`);
    
    const fittedLines = new Map<string, FittedLine>();
    for (const road of roads) {
      const mainAngle = road.type === 'longitudinal' ? directions.longitudinalAngle : directions.horizontalAngle;
      const fittedLine = this.fitRoadWithDirection(road, mainAngle);
      fittedLines.set(road.id, fittedLine);
    }
    
    const processedRoads = roads.map(road => {
      const fittedLine = fittedLines.get(road.id)!;
      const newPoints = this.resampleRoadPoints(fittedLine, params.sampleDistance);
      return { ...road, points: newPoints };
    });
    
    return { processedRoads, fittedLines, directions };
  }
}

// ============================================================
// 第四部分：路口处理服务
// ============================================================

/**
 * 路口处理服务
 */
export class IntersectionProcessor {
  /**
   * 构建路口索引
   */
  buildIndex(intersections: Intersection[]): IntersectionIndex {
    const index: IntersectionIndex = {
      byId: new Map(),
      byRoads: new Map(),
      byRoad: new Map()
    };
    
    for (const inter of intersections) {
      index.byId.set(inter.id, inter);
      
      if (inter.road_v_id && inter.road_h_id) {
        const key = `${inter.road_v_id}:${inter.road_h_id}`;
        index.byRoads.set(key, inter.id);
      }
      
      if (inter.road_v_id) {
        if (!index.byRoad.has(inter.road_v_id)) {
          index.byRoad.set(inter.road_v_id, []);
        }
        index.byRoad.get(inter.road_v_id)!.push(inter.id);
      }
      
      if (inter.road_h_id) {
        if (!index.byRoad.has(inter.road_h_id)) {
          index.byRoad.set(inter.road_h_id, []);
        }
        index.byRoad.get(inter.road_h_id)!.push(inter.id);
      }
    }
    
    return index;
  }
  
  /**
   * 获取相邻交点信息
   */
  getNeighborInfo(intersection: Intersection, index: IntersectionIndex): NeighborInfo {
    const info: NeighborInfo = {
      top: null,
      bottom: null,
      left: null,
      right: null,
      topRoadId: null,
      bottomRoadId: null,
      leftRoadId: null,
      rightRoadId: null
    };
    
    if (!intersection.road_v_id || !intersection.road_h_id) {
      return info;
    }
    
    const vIntersectionIds = index.byRoad.get(intersection.road_v_id) || [];
    const vIntersections = vIntersectionIds
      .map(id => index.byId.get(id)!)
      .filter(inter => inter !== undefined)
      .sort((a, b) => a.center.mapXy.y - b.center.mapXy.y);
    
    const vIdx = vIntersections.findIndex(inter => inter.id === intersection.id);
    
    if (vIdx > 0) {
      info.bottom = vIntersections[vIdx - 1];
      info.bottomRoadId = vIntersections[vIdx - 1].road_h_id || null;
    }
    if (vIdx < vIntersections.length - 1) {
      info.top = vIntersections[vIdx + 1];
      info.topRoadId = vIntersections[vIdx + 1].road_h_id || null;
    }
    
    const hIntersectionIds = index.byRoad.get(intersection.road_h_id) || [];
    const hIntersections = hIntersectionIds
      .map(id => index.byId.get(id)!)
      .filter(inter => inter !== undefined)
      .sort((a, b) => a.center.mapXy.x - b.center.mapXy.x);
    
    const hIdx = hIntersections.findIndex(inter => inter.id === intersection.id);
    
    if (hIdx > 0) {
      info.left = hIntersections[hIdx - 1];
      info.leftRoadId = hIntersections[hIdx - 1].road_v_id || null;
    }
    if (hIdx < hIntersections.length - 1) {
      info.right = hIntersections[hIdx + 1];
      info.rightRoadId = hIntersections[hIdx + 1].road_v_id || null;
    }
    
    return info;
  }
  
  /**
   * 判断象限有效性
   */
  getValidQuadrants(neighborInfo: NeighborInfo, index: IntersectionIndex): number[] {
    const validQuadrants: number[] = [];
    
    // Q0: 右上象限
    if (neighborInfo.right && neighborInfo.top) {
      const diagonalKey = `${neighborInfo.rightRoadId}:${neighborInfo.topRoadId}`;
      if (neighborInfo.rightRoadId && neighborInfo.topRoadId && index.byRoads.has(diagonalKey)) {
        validQuadrants.push(0);
      }
    }
    
    // Q1: 左上象限
    if (neighborInfo.left && neighborInfo.top) {
      const diagonalKey = `${neighborInfo.leftRoadId}:${neighborInfo.topRoadId}`;
      if (neighborInfo.leftRoadId && neighborInfo.topRoadId && index.byRoads.has(diagonalKey)) {
        validQuadrants.push(1);
      }
    }
    
    // Q2: 左下象限
    if (neighborInfo.left && neighborInfo.bottom) {
      const diagonalKey = `${neighborInfo.leftRoadId}:${neighborInfo.bottomRoadId}`;
      if (neighborInfo.leftRoadId && neighborInfo.bottomRoadId && index.byRoads.has(diagonalKey)) {
        validQuadrants.push(2);
      }
    }
    
    // Q3: 右下象限
    if (neighborInfo.right && neighborInfo.bottom) {
      const diagonalKey = `${neighborInfo.rightRoadId}:${neighborInfo.bottomRoadId}`;
      if (neighborInfo.rightRoadId && neighborInfo.bottomRoadId && index.byRoads.has(diagonalKey)) {
        validQuadrants.push(3);
      }
    }
    
    return validQuadrants;
  }
  
  /**
   * 获取路口类型
   */
  getIntersectionType(validQuadrants: number[]): string {
    const num = validQuadrants.length;
    if (num === 1) return 'L';
    if (num === 2) return 'T';
    if (num === 4) return 'cross';
    return `partial_${num}`;
  }
  
  /**
   * 处理所有路口
   */
  processIntersections(intersections: Intersection[], roads: Road[]): Intersection[] {
    const index = this.buildIndex(intersections);
    
    return intersections.map(inter => {
      const neighborInfo = this.getNeighborInfo(inter, index);
      const validQuadrants = this.getValidQuadrants(neighborInfo, index);
      const type = this.getIntersectionType(validQuadrants);
      
      return {
        ...inter,
        type: type as any,
        neighbors: {
          top: neighborInfo.top?.id,
          bottom: neighborInfo.bottom?.id,
          left: neighborInfo.left?.id,
          right: neighborInfo.right?.id,
          top_road_id: neighborInfo.topRoadId || undefined,
          bottom_road_id: neighborInfo.bottomRoadId || undefined,
          left_road_id: neighborInfo.leftRoadId || undefined,
          right_road_id: neighborInfo.rightRoadId || undefined
        },
        valid_quadrants: validQuadrants
      };
    });
  }
}

// ============================================================
// 第五部分：圆弧生成服务
// ============================================================

/**
 * 圆弧生成服务V4
 */
export class TurnArcGeneratorV4 {
  private coordinateService: CoordinateService;
  
  constructor(coordinateService: CoordinateService) {
    this.coordinateService = coordinateService;
  }
  
  /**
   * 生成单个圆弧
   */
  generateArc(
    intersection: Intersection,
    quadrant: number,
    radius: number = 4.5,
    numPoints: number = 36
  ): TurnArc {
    const cx = intersection.center.mapXy.x;
    const cy = intersection.center.mapXy.y;
    
    const quadrantOffsets: Record<number, Point2D> = {
      0: { x: radius, y: radius },
      1: { x: -radius, y: radius },
      2: { x: -radius, y: -radius },
      3: { x: radius, y: -radius }
    };
    
    const offset = quadrantOffsets[quadrant];
    const ox = cx + offset.x;
    const oy = cy + offset.y;
    
    /**
     * 圆弧切点和角度配置（修复版V2）
     * 
     * 关键原则：圆弧向交点凹陷
     * 
     * 坐标系：y轴向上为正（标准数学坐标系）
     * 
     * Q0 (右上象限): 连接右方路(x大) ↔ 上方路(y大)
     *   圆心在交点右上方
     *   切点1: 圆心正下方 (x=圆心x, y=交点y) → 连接右方路
     *   切点2: 圆心正左方 (x=交点x, y=圆心y) → 连接上方路
     *   角度: -π/2 → π (顺时针从下到左，通过左侧)
     * 
     * Q1 (左上象限): 连接左方路(x小) ↔ 上方路(y大)
     *   圆心在交点左上方
     *   切点1: 圆心正右方 (x=交点x, y=圆心y) → 连接上方路
     *   切点2: 圆心正下方 (x=圆心x, y=交点y) → 连接左方路
     *   角度: 0 → π/2 (逆时针从右到下)
     * 
     * Q2 (左下象限): 连接左方路(x小) ↔ 下方路(y小)
     *   圆心在交点左下方
     *   切点1: 圆心正上方 (x=交点x, y=圆心y) → 连接左方路
     *   切点2: 圆心正右方 (x=圆心x, y=交点y) → 连接下方路
     *   角度: π/2 → π (逆时针从上到右)
     * 
     * Q3 (右下象限): 连接右方路(x大) ↔ 下方路(y小)
     *   圆心在交点右下方
     *   切点1: 圆心正左方 (x=交点x, y=圆心y) → 连接下方路
     *   切点2: 圆心正上方 (x=圆心x, y=交点y) → 连接右方路
     *   角度: π → 3π/2 (逆时针从左到上)
     */
    const tangentConfig: Record<number, { t1: Point2D; t2: Point2D; startAngle: number; endAngle: number }> = {
      0: {
        // Q0: 切点1在圆心正下方(连接右方路)，切点2在圆心正左方(连接上方路)
        t1: { x: ox, y: cy },                // 圆心正下方 = 交点y坐标
        t2: { x: cx, y: oy },                // 圆心正左方 = 交点x坐标
        startAngle: -Math.PI / 2,            // -90度（正下方）
        endAngle: Math.PI                    // 180度（正左方）
      },
      1: {
        // Q1: 切点1在圆心正右方(连接上方路)，切点2在圆心正下方(连接左方路)
        t1: { x: cx, y: oy },                // 圆心正右方 = 交点x坐标
        t2: { x: ox, y: cy },                // 圆心正下方 = 交点y坐标
        startAngle: 0,                       // 0度（正右方）
        endAngle: -Math.PI / 2               // -90度（正下方）
      },
      2: {
        // Q2: 切点1在圆心正上方(连接左方路)，切点2在圆心正右方(连接下方路)
        t1: { x: cx, y: oy },                // 圆心正上方 = 交点x坐标
        t2: { x: ox, y: cy },                // 圆心正右方 = 交点y坐标
        startAngle: 0,                       // 0度（正上方）
        endAngle: Math.PI / 2                // 90度（正右方）
      },
      3: {
        // Q3: 切点1在圆心正左方(连接下方路)，切点2在圆心正上方(连接右方路)
        t1: { x: cx, y: oy },                // 圆心正左方 = 交点x坐标
        t2: { x: ox, y: cy },                // 圆心正上方 = 交点y坐标
        startAngle: Math.PI,                 // 180度（正左方）
        endAngle: Math.PI / 2                // 90度（正上方）
      }
    };
    
    const config = tangentConfig[quadrant];
    const arcPoints: TurnArcPoint[] = [];
    const startAngle = config.startAngle;
    const endAngle = config.endAngle;
    
    /**
     * 角度步长计算（修复版V3）
     * 
     * Q0: 从-π/2到π，顺时针（角度递减）
     * Q1: 从0到-π/2，顺时针（角度递减）
     * Q2: 从0到π/2，逆时针（角度递增）
     * Q3: 从π到π/2，顺时针（角度递减）
     */
    let angleStep: number;
    if (quadrant === 0 || quadrant === 1 || quadrant === 3) {
      // Q0/Q1/Q3: 顺时针方向（角度递减）
      angleStep = -Math.PI / 2 / (numPoints - 1);
    } else {
      // Q2: 逆时针方向（角度递增）
      angleStep = (endAngle - startAngle) / (numPoints - 1);
    }
    
    for (let i = 0; i < numPoints; i++) {
      const angle = startAngle + i * angleStep;
      const x = ox + radius * Math.cos(angle);
      const y = oy + radius * Math.sin(angle);
      
      const gps = this.coordinateService.mapToGps(x, y);
      
      arcPoints.push({
        seq: i,
        gps: { latitude: gps.lat, longitude: gps.lon, altitude: 0 },
        mapXy: { x, y }
      });
    }
    
    return {
      id: `arc_${intersection.id}_${quadrant}`,
      intersectionId: intersection.id,
      quadrant,
      radius,
      center: { x: ox, y: oy },
      tangentPoints: [config.t1, config.t2],
      points: arcPoints
    };
  }
  
  /**
   * 生成所有圆弧
   */
  generateAllTurnArcs(intersections: Intersection[], radius: number = 4.5): TurnArc[] {
    const allArcs: TurnArc[] = [];
    
    for (const inter of intersections) {
      const validQuadrants = inter.valid_quadrants || [];
      
      for (const q of validQuadrants) {
        const arc = this.generateArc(inter, q, radius);
        allArcs.push(arc);
      }
    }
    
    console.log(`[TurnArcGeneratorV4] 生成 ${allArcs.length} 条圆弧`);
    return allArcs;
  }
}

// ============================================================
// 第六部分：梁位处理服务
// ============================================================

/**
 * 梁位处理服务
 */
export class BeamPositionProcessor {
  /**
   * 构建路口索引
   */
  buildIndex(intersections: Intersection[]): IntersectionIndex {
    const index: IntersectionIndex = {
      byId: new Map(),
      byRoads: new Map(),
      byRoad: new Map()
    };
    
    for (const inter of intersections) {
      index.byId.set(inter.id, inter);
      
      if (inter.road_v_id && inter.road_h_id) {
        const key = `${inter.road_v_id}:${inter.road_h_id}`;
        index.byRoads.set(key, inter.id);
      }
      
      if (inter.road_v_id) {
        if (!index.byRoad.has(inter.road_v_id)) {
          index.byRoad.set(inter.road_v_id, []);
        }
        index.byRoad.get(inter.road_v_id)!.push(inter.id);
      }
      
      if (inter.road_h_id) {
        if (!index.byRoad.has(inter.road_h_id)) {
          index.byRoad.set(inter.road_h_id, []);
        }
        index.byRoad.get(inter.road_h_id)!.push(inter.id);
      }
    }
    
    return index;
  }
  
  /**
   * 识别有效梁位
   */
  identifyBeamPositions(
    roads: Road[],
    intersections: Intersection[],
    index: IntersectionIndex
  ): BeamPosition[] {
    const longitudinalRoads = roads
      .filter(r => r.type === 'longitudinal')
      .sort((a, b) => a.points[0]?.mapXy.x - b.points[0]?.mapXy.x);
    
    const horizontalRoads = roads
      .filter(r => r.type === 'horizontal')
      .sort((a, b) => a.points[0]?.mapXy.y - b.points[0]?.mapXy.y);
    
    const beamPositions: BeamPosition[] = [];
    let beamId = 0;
    
    for (let i = 0; i < longitudinalRoads.length - 1; i++) {
      const roadWest = longitudinalRoads[i];
      const roadEast = longitudinalRoads[i + 1];
      
      for (let j = 0; j < horizontalRoads.length - 1; j++) {
        const roadSouth = horizontalRoads[j];
        const roadNorth = horizontalRoads[j + 1];
        
        const swKey = `${roadWest.id}:${roadSouth.id}`;
        const seKey = `${roadEast.id}:${roadSouth.id}`;
        const nwKey = `${roadWest.id}:${roadNorth.id}`;
        const neKey = `${roadEast.id}:${roadNorth.id}`;
        
        const swId = index.byRoads.get(swKey);
        const seId = index.byRoads.get(seKey);
        const nwId = index.byRoads.get(nwKey);
        const neId = index.byRoads.get(neKey);
        
        if (swId && seId && nwId && neId) {
          const swInter = index.byId.get(swId)!;
          const seInter = index.byId.get(seId)!;
          const nwInter = index.byId.get(nwId)!;
          const neInter = index.byId.get(neId)!;
          
          const centerX = (swInter.center.mapXy.x + seInter.center.mapXy.x + 
                          nwInter.center.mapXy.x + neInter.center.mapXy.x) / 4;
          const centerY = (swInter.center.mapXy.y + seInter.center.mapXy.y + 
                          nwInter.center.mapXy.y + neInter.center.mapXy.y) / 4;
          
          const row = roadWest.name || String.fromCharCode(65 + i);
          const col = j + 1;
          
          beamPositions.push({
            id: `beam_${beamId}`,
            name: `${row}${col}`,
            row,
            col,
            center: { x: centerX, y: centerY },
            boundaries: {
              west: roadWest.id,
              east: roadEast.id,
              south: roadSouth.id,
              north: roadNorth.id
            },
            corner_intersections: [swId, seId, nwId, neId],
            neighbors: {}
          });
          
          beamId++;
        }
      }
    }
    
    this.buildNeighborRelations(beamPositions);
    
    console.log(`[BeamPositionProcessor] 识别 ${beamPositions.length} 个梁位`);
    return beamPositions;
  }
  
  /**
   * 建立梁位相邻关系
   */
  buildNeighborRelations(beamPositions: BeamPosition[]): void {
    for (const beam of beamPositions) {
      const leftBeam = beamPositions.find(b => 
        b.row === beam.row && b.col === beam.col - 1
      );
      const rightBeam = beamPositions.find(b => 
        b.row === beam.row && b.col === beam.col + 1
      );
      const topBeam = beamPositions.find(b => 
        b.row === String.fromCharCode(beam.row.charCodeAt(0) + 1) && b.col === beam.col
      );
      const bottomBeam = beamPositions.find(b => 
        b.row === String.fromCharCode(beam.row.charCodeAt(0) - 1) && b.col === beam.col
      );
      
      beam.neighbors = {
        left: leftBeam?.id,
        right: rightBeam?.id,
        top: topBeam?.id,
        bottom: bottomBeam?.id
      };
    }
  }
  
  /**
   * 兼容接口：生成梁位
   */
  generateBeamPositions(intersections: Intersection[], roads: Road[]): BeamPosition[] {
    const index = this.buildIndex(intersections);
    return this.identifyBeamPositions(roads, intersections, index);
  }
  
  /**
   * 处理梁位（兼容接口）
   */
  processBeamPositions(beamPositions: BeamPosition[], turnArcs: TurnArc[]): BeamPosition[] {
    return beamPositions;
  }
  
  /**
   * 关联圆弧与梁位
   */
  associateArcsWithBeams(
    turnArcs: TurnArc[],
    beamPositions: BeamPosition[],
    intersections: Intersection[]
  ): TurnArc[] {
    return turnArcs.map(arc => {
      const relatedBeam = this.findBeamForArc(arc, beamPositions);
      return { ...arc, beam_position_id: relatedBeam?.id };
    });
  }
  
  /**
   * 查找圆弧对应的梁位
   */
  findBeamForArc(arc: TurnArc, beamPositions: BeamPosition[]): BeamPosition | undefined {
    const cornerIndex = [2, 3, 0, 1][arc.quadrant];
    
    return beamPositions.find(beam => 
      beam.corner_intersections && beam.corner_intersections[cornerIndex] === arc.intersectionId
    );
  }
}

// ============================================================
// 第七部分：地图文件生成服务
// ============================================================

/**
 * 地图文件生成服务
 */
export class MapFileGenerator {
  private coordinateService: CoordinateService;
  
  constructor(coordinateService: CoordinateService) {
    this.coordinateService = coordinateService;
  }
  
  /**
   * 生成PGM地图（使用距离变换法）
   */
  generatePGMMap(
    roads: Road[],
    intersections: Intersection[],
    beamPositions: BeamPosition[],
    turnArcs: TurnArc[],
    resolution: number = 0.05
  ): { pgm: Buffer; width: number; height: number; origin: number[] } {
    const preferredWidth = 0.7;
    const highCostWidth = 0.3;
    const margin = 5.0;
    
    const allPoints: Point2D[] = [];
    
    for (const road of roads) {
      for (const point of road.points) {
        allPoints.push(point.mapXy);
      }
    }
    
    for (const arc of turnArcs) {
      for (const point of arc.points) {
        allPoints.push(point.mapXy);
      }
    }
    
    if (allPoints.length === 0) {
      throw new Error('没有道路点数据');
    }
    
    const minX = Math.min(...allPoints.map(p => p.x)) - margin;
    const maxX = Math.max(...allPoints.map(p => p.x)) + margin;
    const minY = Math.min(...allPoints.map(p => p.y)) - margin;
    const maxY = Math.max(...allPoints.map(p => p.y)) + margin;
    
    const width = Math.floor((maxX - minX) / resolution) + 1;
    const height = Math.floor((maxY - minY) / resolution) + 1;
    
    const centerlineImg: number[][] = Array(height).fill(null).map(() => Array(width).fill(255));
    
    for (const road of roads) {
      for (let i = 0; i < road.points.length - 1; i++) {
        this.drawLineSegment(centerlineImg, road.points[i].mapXy, road.points[i + 1].mapXy, minX, minY, resolution, 0);
      }
    }
    
    for (const arc of turnArcs) {
      for (let i = 0; i < arc.points.length - 1; i++) {
        this.drawLineSegment(centerlineImg, arc.points[i].mapXy, arc.points[i + 1].mapXy, minX, minY, resolution, 0);
      }
    }
    
    const costmap = this.generateCostmap(centerlineImg, preferredWidth, highCostWidth, resolution);
    const pgmBuffer = this.createPGMBuffer(costmap);
    
    return { pgm: pgmBuffer, width, height, origin: [minX, minY, 0.0] };
  }
  
  private drawLineSegment(
    img: number[][],
    start: Point2D,
    end: Point2D,
    originX: number,
    originY: number,
    resolution: number,
    value: number
  ): void {
    const height = img.length;
    const width = img[0]?.length || 0;
    
    let x0 = Math.floor((start.x - originX) / resolution);
    let y0 = Math.floor((start.y - originY) / resolution);
    let x1 = Math.floor((end.x - originX) / resolution);
    let y1 = Math.floor((end.y - originY) / resolution);
    
    y0 = height - 1 - y0;
    y1 = height - 1 - y1;
    
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    
    while (true) {
      if (y0 >= 0 && y0 < height && x0 >= 0 && x0 < width) {
        img[y0][x0] = value;
      }
      
      if (x0 === x1 && y0 === y1) break;
      
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  }
  
  private generateCostmap(
    centerlineImg: number[][],
    preferredWidth: number,
    highCostWidth: number,
    resolution: number
  ): number[][] {
    const height = centerlineImg.length;
    const width = centerlineImg[0]?.length || 0;
    
    const distMap: number[][] = Array(height).fill(null).map(() => Array(width).fill(Infinity));
    const queue: [number, number][] = [];
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (centerlineImg[y][x] === 0) {
          distMap[y][x] = 0;
          queue.push([x, y]);
        }
      }
    }
    
    const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    
    while (queue.length > 0) {
      const [cx, cy] = queue.shift()!;
      
      for (const [dx, dy] of directions) {
        const nx = cx + dx;
        const ny = cy + dy;
        
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const newDist = distMap[cy][cx] + resolution;
          if (newDist < distMap[ny][nx]) {
            distMap[ny][nx] = newDist;
            queue.push([nx, ny]);
          }
        }
      }
    }
    
    const costmap: number[][] = Array(height).fill(null).map(() => Array(width).fill(255));
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dist = distMap[y][x];
        
        if (dist <= preferredWidth) {
          costmap[y][x] = Math.floor((dist / preferredWidth) * 50);
        } else if (dist <= preferredWidth + highCostWidth) {
          const relDist = (dist - preferredWidth) / highCostWidth;
          costmap[y][x] = Math.floor(50 + relDist * 204);
        }
      }
    }
    
    return costmap;
  }
  
  private createPGMBuffer(img: number[][]): Buffer {
    const height = img.length;
    const width = img[0]?.length || 0;
    
    const header = `P5\n${width} ${height}\n255\n`;
    const headerBuffer = Buffer.from(header, 'ascii');
    const dataBuffer = Buffer.alloc(height * width);
    let idx = 0;
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        dataBuffer[idx++] = img[y][x];
      }
    }
    
    return Buffer.concat([headerBuffer, dataBuffer]);
  }
  
  /**
   * 生成YAML配置
   */
  generateYAMLConfig(imageName: string, resolution: number, origin: number[]): string {
    return `image: ${imageName}
resolution: ${resolution}
origin: [${origin[0]}, ${origin[1]}, ${origin[2] || 0.0}]
negate: 0
occupied_thresh: 0.65
free_thresh: 0.196
mode: scale
`;
  }
  
  /**
   * 生成gps_routes.json
   * origin参数支持两种格式：GPSOrigin或controller的origin格式
   */
  generateGPSRoutesJSON(
    origin: GPSOrigin | { gps: GPSPoint; utm: { zone: number; easting: number; northing: number }; rotation: number },
    roads: Road[],
    intersections: Intersection[],
    turnArcs: TurnArc[]
  ): object {
    // 兼容两种origin格式
    const gpsCoord = 'lat' in origin.gps 
      ? origin.gps 
      : { lat: (origin.gps as GPSPoint).latitude, lon: (origin.gps as GPSPoint).longitude };
    
    return {
      version: '4.0',
      origin: {
        gps: gpsCoord,
        utm: origin.utm,
        rotation: origin.rotation
      },
      roads: roads.map(road => ({
        id: road.id,
        name: road.name,
        type: road.type,
        params: road.params,
        points: road.points.map(p => ({
          seq: p.seq,
          gps: p.gps,
          map_xy: p.mapXy
        }))
      })),
      intersections: intersections.map(inter => ({
        id: inter.id,
        type: inter.type,
        center: {
          gps: inter.center.gps,
          map_xy: inter.center.mapXy
        },
        road_v_id: inter.road_v_id,
        road_h_id: inter.road_h_id,
        connected_roads: inter.connectedRoads,
        neighbors: inter.neighbors,
        valid_quadrants: inter.valid_quadrants
      })),
      turn_arcs: turnArcs.map(arc => ({
        id: arc.id,
        intersection_id: arc.intersectionId,
        quadrant: arc.quadrant,
        radius: arc.radius,
        center: arc.center,
        tangent_points: arc.tangentPoints,
        points: arc.points.map(p => ({
          seq: p.seq,
          gps: p.gps,
          map_xy: p.mapXy
        })),
        beam_position_id: arc.beam_position_id
      }))
    };
  }
  
  /**
   * 生成beam_positions.json
   */
  generateBeamPositionsJSON(beamPositions: BeamPosition[]): object {
    return {
      version: '1.0',
      positions: beamPositions.map(beam => ({
        id: beam.id,
        name: beam.name,
        row: beam.row,
        col: beam.col,
        center: beam.center,
        boundaries: beam.boundaries,
        corner_intersections: beam.corner_intersections,
        neighbors: beam.neighbors
      }))
    };
  }
}

// ============================================================
// 第八部分：路口检测服务（兼容旧接口）
// ============================================================

/**
 * 路口检测服务
 */
export class IntersectionDetector {
  private threshold: number;
  private coordinateService: CoordinateService | null = null;
  
  constructor(threshold: number = 5.0) {
    this.threshold = threshold;
  }
  
  setCoordinateService(cs: CoordinateService) {
    this.coordinateService = cs;
  }
  
  /**
   * 检测道路交点
   */
  detectIntersections(roads: Road[]): Intersection[] {
    const longitudinalRoads = roads.filter(r => r.type === 'longitudinal');
    const horizontalRoads = roads.filter(r => r.type === 'horizontal');
    
    const intersections: Intersection[] = [];
    let interId = 0;
    
    for (const roadV of longitudinalRoads) {
      for (const roadH of horizontalRoads) {
        const nearest = this.findNearestPoints(roadV.points, roadH.points);
        
        if (nearest.distance < this.threshold) {
          const centerX = (nearest.p1.x + nearest.p2.x) / 2;
          const centerY = (nearest.p1.y + nearest.p2.y) / 2;
          
          const gps = this.coordinateService
            ? this.coordinateService.mapToGps(centerX, centerY)
            : { lat: 0, lon: 0 };
          
          intersections.push({
            id: `intersection_${interId}`,
            type: 'cross',
            center: {
              gps: { latitude: gps.lat, longitude: gps.lon, altitude: 0 },
              mapXy: { x: centerX, y: centerY }
            },
            road_v_id: roadV.id,
            road_h_id: roadH.id,
            connectedRoads: [roadV.id, roadH.id],
            neighbors: {},
            valid_quadrants: []
          });
          
          interId++;
        }
      }
    }
    
    console.log(`[IntersectionDetector] 检测到 ${intersections.length} 个交点`);
    return intersections;
  }
  
  private findNearestPoints(pointsV: RoadPoint[], pointsH: RoadPoint[]): { p1: Point2D; p2: Point2D; distance: number } {
    let minDist = Infinity;
    let nearestP1: Point2D = { x: 0, y: 0 };
    let nearestP2: Point2D = { x: 0, y: 0 };
    
    for (const pv of pointsV) {
      for (const ph of pointsH) {
        const dist = Math.sqrt(
          (pv.mapXy.x - ph.mapXy.x) ** 2 +
          (pv.mapXy.y - ph.mapXy.y) ** 2
        );
        
        if (dist < minDist) {
          minDist = dist;
          nearestP1 = pv.mapXy;
          nearestP2 = ph.mapXy;
        }
      }
    }
    
    return { p1: nearestP1, p2: nearestP2, distance: minDist };
  }
}

// ============================================================
// 第九部分：梁位生成服务（兼容旧接口）
// ============================================================

/**
 * 梁位生成服务
 */
export class BeamPositionGenerator {
  private coordinateService: CoordinateService;
  
  constructor(coordinateService: CoordinateService) {
    this.coordinateService = coordinateService;
  }
  
  /**
   * 生成梁位
   */
  generateBeamPositions(intersections: Intersection[], roads: Road[]): BeamPosition[] {
    const processor = new BeamPositionProcessor();
    const index = processor.buildIndex(intersections);
    return processor.identifyBeamPositions(roads, intersections, index);
  }
}

// ============================================================
// 辅助函数：创建FittedLine对象
// ============================================================

function createFittedLine(start: Point2D, end: Point2D, directionAngle: number, roadId: string): FittedLine {
  return {
    start,
    end,
    directionAngle,
    roadId,
    length: () => Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2)
  };
}

// ============================================================
// 导出所有服务和类型
// ============================================================

export {
  Point2D as Point2DType,
  FittedLine as FittedLineType,
  NeighborInfo as NeighborInfoType,
  IntersectionIndex as IntersectionIndexType,
  GPSOrigin as GPSOriginType,
  MapGenParams as MapGenParamsType
};
