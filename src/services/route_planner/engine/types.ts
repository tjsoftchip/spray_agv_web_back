/**
 * 引擎类型定义 - 基于端口有向图的路线规划引擎
 */

export enum SprayMode {
  OFF = 0,
  LEFT = 1,
  RIGHT = 2,
  BOTH = 3,
}

export enum EdgeType {
  EXTERNAL_ROAD = 'EXTERNAL_ROAD',
  INTERNAL_ARC = 'INTERNAL_ARC',
  STATION_LINK = 'STATION_LINK',
}

export interface RawGeoPoint {
  latitude: number;
  longitude: number;
  x: number;
  y: number;
}

export interface DirectedEdge {
  edgeId: string;
  type: EdgeType;
  sourceNodeId: string;
  targetNodeId: string;
  points: RawGeoPoint[];
  length: number;
  roadId?: string;
  arcId?: string;
  intersectionId?: string;
  taskMode: SprayMode;
  isCompleted: boolean;
  taskGroupId?: string;
}

export interface PortNode {
  nodeId: string;
  intersectionId: string;
  port: 'IN_North' | 'IN_South' | 'IN_East' | 'IN_West' | 'OUT_North' | 'OUT_South' | 'OUT_East' | 'OUT_West' | 'STATION';
  position: { x: number; y: number };
}

export interface TrajectoryPoint {
  seq: number;
  latitude: number;
  longitude: number;
  x: number;
  y: number;
  yaw: number;
  spray_mode: SprayMode;
}

export interface RouteResponseData {
  total_length_meters: number;
  estimated_time_seconds: number;
  trajectory: TrajectoryPoint[];
  segments: DirectedEdge[];
}

export type Direction = 'north' | 'south' | 'east' | 'west';

export const OPPOSITE_DIR: Record<Direction, Direction> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};

export const TURN_PENALTY = 15.0;
export const STRAIGHT_PENALTY = 0.0;
