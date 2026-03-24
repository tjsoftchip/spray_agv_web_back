import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

// GPS坐标点
export interface GPSPoint {
  latitude: number;
  longitude: number;
  altitude: number;
}

// 地图坐标点
export interface MapPoint {
  x: number;
  y: number;
}

// 道路点
export interface RoadPoint {
  seq: number;
  gps: GPSPoint;
  mapXy: MapPoint;
}

// 道路数据
export interface Road {
  id: string;
  name: string;
  type: 'longitudinal' | 'horizontal'; // 纵向/横向
  params: {
    preferredWidth: number;   // 首选路网宽度 (m)
    keepoutDistance: number;  // 禁区宽度 (m)
    channelWidth: number;     // 通道总宽度 (m)
  };
  points: RoadPoint[];
}

// 交叉点相邻交点
export interface IntersectionNeighbors {
  top?: string;      // 上方相邻交点ID
  bottom?: string;   // 下方相邻交点ID
  left?: string;     // 左方相邻交点ID
  right?: string;    // 右方相邻交点ID
  top_road_id?: string;   // 上方相邻交点的横向路ID
  bottom_road_id?: string; // 下方相邻交点的横向路ID
  left_road_id?: string;  // 左方相邻交点的纵向路ID
  right_road_id?: string; // 右方相邻交点的纵向路ID
}

// 交叉点数据（V4.0扩展）
export interface Intersection {
  id: string;
  type: 'cross' | 't_junction' | 'corner' | 'L' | 'T' | 'partial_0' | 'partial_1' | 'partial_2' | 'partial_3'; // 路口类型
  center: {
    gps: GPSPoint;
    mapXy: MapPoint;
  };
  road_v_id?: string;          // 纵向道路ID（V4.0新增，可选）
  road_h_id?: string;          // 横向道路ID（V4.0新增，可选）
  connectedRoads: string[];    // 连接的道路ID（保留兼容）
  neighbors?: IntersectionNeighbors;  // 四个方向的相邻交点（V4.0新增，可选）
  valid_quadrants?: number[];  // 有效象限列表 [0-3]（V4.0新增，可选）
}

// 转弯路径（旧版，保留兼容）
export interface TurnPath {
  id: string;
  intersectionId: string;
  fromRoad: string;
  toRoad: string;
  direction: 'left' | 'right' | 'straight' | 'uturn';
  radius: number;
  points: Array<{
    seq: number;
    gps: GPSPoint;
    mapXy: MapPoint;
  }>;
}

// 转弯圆弧点
export interface TurnArcPoint {
  seq: number;
  gps: GPSPoint;
  mapXy: MapPoint;
}

// 转弯圆弧（V4.0扩展）
export interface TurnArc {
  id: string;
  intersectionId: string;
  quadrant: number;  // 0-3，四个象限
  radius: number;    // 转弯半径（米）
  center: MapPoint;  // 圆弧中心
  tangentPoints: MapPoint[];  // 切点位置
  points: TurnArcPoint[];     // 圆弧路径点
  beam_position_id?: string;  // 关联的梁位ID（V4.0新增）
}

// 地图统计信息
export interface MapStatistics {
  totalPixels: number;
  keepoutPixels: number;
  highCostPixels: number;
  preferredPixels: number;
  keepoutPercent: number;
  highCostPercent: number;
  preferredPercent: number;
}

// 梁位相邻梁位（V4.0新增）
export interface BeamNeighbors {
  left?: string;   // 左侧相邻梁位ID
  right?: string;  // 右侧相邻梁位ID
  top?: string;    // 上方相邻梁位ID
  bottom?: string; // 下方相邻梁位ID
}

// 梁位数据（V4.0扩展）
export interface BeamPosition {
  id: string;
  name: string;
  row: string;      // 行标签 A, B, C...
  col: number;      // 列标签 1, 2, 3...
  center: MapPoint;
  boundaries: {
    north?: string; // 北边道路ID（保持简单字符串格式）
    south?: string;
    east?: string;
    west?: string;
  };
  corner_intersections?: string[]; // 四个角对应的交叉点ID（V4.0新增）
  crossPoints?: string[];          // 兼容旧字段名
  neighbors?: BeamNeighbors;       // 相邻梁位关系（V4.0新增）
}

// GPS地图属性
export interface GPSMapAttributes {
  id: string;
  name: string;
  description?: string;
  origin: {
    gps: GPSPoint;
    utm: {
      zone: number;
      easting: number;
      northing: number;
    };
    rotation: number; // 地图旋转角度 (rad)
  };
  supplyStation?: {
    gps: GPSPoint;
    mapXy: MapPoint;
  };
  roads: Road[];
  intersections: Intersection[];
  turnPaths: TurnPath[];      // 旧版转弯路径（保留兼容）
  turnArcs?: TurnArc[];       // V3.0新增：转弯圆弧
  beamPositions: BeamPosition[];
  statistics?: MapStatistics;  // V3.0新增：地图统计信息
  status: 'draft' | 'completed' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}

// 创建时可省略的字段
type GPSMapCreationAttributes = Optional<GPSMapAttributes, 'id' | 'createdAt' | 'updatedAt' | 'description' | 'supplyStation' | 'roads' | 'intersections' | 'turnPaths' | 'turnArcs' | 'beamPositions' | 'statistics' | 'status'>;

// GPS地图模型
class GPSMap extends Model<GPSMapAttributes, GPSMapCreationAttributes> implements GPSMapAttributes {
  declare id: string;
  declare name: string;
  declare description: string;
  declare origin: GPSMapAttributes['origin'];
  declare supplyStation: GPSMapAttributes['supplyStation'];
  declare roads: Road[];
  declare intersections: Intersection[];
  declare turnPaths: TurnPath[];
  declare turnArcs?: TurnArc[];
  declare beamPositions: BeamPosition[];
  declare statistics?: MapStatistics;
  declare status: 'draft' | 'completed' | 'archived';
  declare createdAt: Date;
  declare updatedAt: Date;
}

GPSMap.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    origin: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    supplyStation: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    roads: {
      type: DataTypes.JSON,
      defaultValue: [],
    },
    intersections: {
      type: DataTypes.JSON,
      defaultValue: [],
    },
    turnPaths: {
      type: DataTypes.JSON,
      defaultValue: [],
    },
    turnArcs: {
      type: DataTypes.JSON,
      defaultValue: [],
    },
    beamPositions: {
      type: DataTypes.JSON,
      defaultValue: [],
    },
    statistics: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM('draft', 'completed', 'archived'),
      defaultValue: 'draft',
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: 'gps_maps',
    modelName: 'GPSMap',
    timestamps: true,
    updatedAt: 'updatedAt',
    createdAt: 'createdAt',
  }
);

export default GPSMap;
