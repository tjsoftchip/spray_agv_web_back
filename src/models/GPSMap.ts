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
  points: Array<{
    seq: number;
    gps: GPSPoint;
    mapXy: MapPoint;
  }>;
}

// 交叉点数据
export interface Intersection {
  id: string;
  type: 'cross' | 't_junction' | 'corner'; // 十字/T字/转角
  center: {
    gps: GPSPoint;
    mapXy: MapPoint;
  };
  connectedRoads: string[]; // 连接的道路ID
}

// 转弯路径
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

// 梁位数据
export interface BeamPosition {
  id: string;
  name: string;
  row: string;      // 行标签 A, B, C...
  col: number;      // 列标签 1, 2, 3...
  center: MapPoint;
  boundaries: {
    north?: string; // 北边道路ID
    south?: string;
    east?: string;
    west?: string;
  };
  crossPoints: string[]; // 四个角对应的交叉点ID
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
  turnPaths: TurnPath[];
  beamPositions: BeamPosition[];
  status: 'draft' | 'completed' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}

// 创建时可省略的字段
type GPSMapCreationAttributes = Optional<GPSMapAttributes, 'id' | 'createdAt' | 'updatedAt' | 'description' | 'supplyStation' | 'roads' | 'intersections' | 'turnPaths' | 'beamPositions' | 'status'>;

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
  declare beamPositions: BeamPosition[];
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
    beamPositions: {
      type: DataTypes.JSON,
      defaultValue: [],
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
