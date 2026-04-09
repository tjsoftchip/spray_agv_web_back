/**
 * 作业路线规划器 - 类型定义
 */

export interface GpsPoint {
  latitude: number;
  longitude: number;
  altitude: number;
}

export interface MapPoint {
  x: number;
  y: number;
}

export interface RoadPoint {
  seq: number;
  gps: GpsPoint;
  map_xy: MapPoint;
}

export interface Road {
  id: string;
  name: string;
  type: 'longitudinal' | 'horizontal';
  params?: {
    preferredWidth: number;
    highCostWidth: number;
  };
  points: RoadPoint[];
}

export interface Intersection {
  id: string;
  type: 'cross' | 'T' | 'L' | string;
  center: {
    gps: GpsPoint;
    map_xy: MapPoint;
  };
  road_v_id?: string;
  road_h_id?: string;
  connected_roads: string[];
  neighbors?: {
    top?: string;
    bottom?: string;
    left?: string;
    right?: string;
    top_road_id?: string;
    bottom_road_id?: string;
    left_road_id?: string;
    right_road_id?: string;
  };
  valid_quadrants?: number[];
}

export interface TurnArcPoint {
  seq: number;
  gps: GpsPoint;
  map_xy: MapPoint;
}

export interface TurnArc {
  id: string;
  intersection_id: string;
  quadrant: number;
  radius: number;
  center: MapPoint;
  tangent_points: MapPoint[];
  points: TurnArcPoint[];
}

export interface BeamPosition {
  id: string;
  name: string;
  row: string;
  col: number;
  center: MapPoint;
  boundaries: {
    north: string;
    south: string;
    east: string;
    west: string;
  };
  corner_intersections: string[];
  neighbors?: {
    top?: string;
    bottom?: string;
    left?: string;
    right?: string;
  };
}

export interface SupplyStation {
  id: string;
  position: MapPoint;
  heading: number;
  aruco_marker_id: number;
  approach_distance: number;
  entry_road_id: string;
  entry_intersection_id: string;
}

export interface GpsRoutes {
  version: string;
  origin: {
    gps: { lat: number; lon: number };
    utm: { zone: number; easting: number; northing: number };
    rotation: number;
  };
  roads: Road[];
  intersections: Intersection[];
  turn_arcs: TurnArc[];
}

export interface Waypoint {
  x: number;
  y: number;
  yaw: number;
  spray_action?: 'extend_left_arm' | 'extend_right_arm' | 'retract_all' | 'none';
}

export type SprayMode = 'left_only' | 'right_only' | 'both' | 'none';

export interface RouteSegment {
  id: string;
  type: 'road' | 'turn_arc' | 'transit';
  road_id?: string;
  arc_id?: string;
  direction?: 'forward' | 'backward';
  beam_id?: string;
  side?: 'north' | 'south' | 'east' | 'west';
  spray_mode: SprayMode;
  waypoints: Waypoint[];
  tangent_points?: MapPoint[];
}

export interface JobRoute {
  id: string;
  name: string;
  created: string;
  beam_sequence: string[];
  segments: RouteSegment[];
  statistics: {
    total_length: number;
    estimated_time: number;
    spray_length: number;
    transit_length: number;
  };
}

export interface RoadSegment {
  road_id: string;
  start_point: MapPoint;
  end_point: MapPoint;
  start_inter_id: string;
  end_inter_id: string;
  beam_left_id: string | null;
  beam_right_id: string | null;
  points: MapPoint[];
}

export interface BeamLayout {
  beams: BeamPosition[];
  rowCount: number;
  columnCounts: number[];
  isSingleBeam: boolean;
  isSingleRow: boolean;
  isSingleColumn: boolean;
  isGrid: boolean;
  adjacencyMap: Map<string, string[]>;
  rows: Map<string, BeamPosition[]>;
}

export type CircuitDirection = 'clockwise' | 'counterclockwise';

export interface CircuitConfig {
  direction: CircuitDirection;
  boundaryCount: number;
  skipBoundaries?: Array<'west' | 'north' | 'east' | 'south'>;
}

export interface TransitConfig {
  usePresetArcs: boolean;
  allowDynamicPath: boolean;
}

export interface BoundaryInfo {
  boundary: 'west' | 'north' | 'east' | 'south';
  road: Road;
  roadSegment: RoadSegment;
  direction: 'forward' | 'backward';
  travelDir: 'north' | 'south' | 'east' | 'west';
  startInter: Intersection | null;
  endInter: Intersection | null;
  roadPoints: MapPoint[];
}

export interface BeamCorners {
  nw: MapPoint;
  ne: MapPoint;
  sw: MapPoint;
  se: MapPoint;
}

export interface BoundaryEndpoints {
  startPoint: MapPoint;
  endPoint: MapPoint;
  startInter: Intersection | null;
  endInter: Intersection | null;
}