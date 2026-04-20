import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface NavigationPointAttributes {
  id: string;
  name: string;
  yardId: string;
  position: {
    x: number;
    y: number;
    z: number;
  };
  orientation: {
    x: number;
    y: number;
    z: number;
    w: number;
  };
  order: number;
  type: 'start' | 'waypoint' | 'end' | 'work' | 'charge' | 'water' | 'wait';
  navigationParams?: {
    maxSpeed?: number;
    minSpeed?: number;
    obstacleDistance?: number;
    goalTolerance?: number;
    rotationTolerance?: number;
  };
  actionOnArrival?: {
    type: 'spray' | 'charge' | 'water' | 'wait' | 'none';
    duration?: number;
    params?: any;
  };
  isTransitionPoint?: boolean;
  fromYardId?: string;
  toYardId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

interface NavigationPointCreationAttributes extends Optional<NavigationPointAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

class NavigationPoint extends Model<NavigationPointAttributes, NavigationPointCreationAttributes> implements NavigationPointAttributes {
  public id!: string;
  public name!: string;
  public yardId!: string;
  public position!: { x: number; y: number; z: number };
  public orientation!: { x: number; y: number; z: number; w: number };
  public order!: number;
  public type!: 'start' | 'waypoint' | 'end' | 'work' | 'charge' | 'water' | 'wait';
  public navigationParams?: {
    maxSpeed?: number;
    minSpeed?: number;
    obstacleDistance?: number;
    goalTolerance?: number;
    rotationTolerance?: number;
  };
  public actionOnArrival?: {
    type: 'spray' | 'charge' | 'water' | 'wait' | 'none';
    duration?: number;
    params?: any;
  };
  public isTransitionPoint?: boolean;
  public fromYardId?: string;
  public toYardId?: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

NavigationPoint.init(
  {
    id: {
      type: DataTypes.STRING,
      primaryKey: true,
      defaultValue: () => `nav_${Date.now()}`,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    yardId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    position: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    orientation: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    order: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    type: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'waypoint',
    },
    navigationParams: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    actionOnArrival: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    isTransitionPoint: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
    },
    fromYardId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    toYardId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'navigation_points',
    timestamps: true,
    indexes: [
      {
        fields: ['yardId'],
        name: 'idx_nav_point_yard_id',
      },
      {
        fields: ['type'],
        name: 'idx_nav_point_type',
      },
      {
        fields: ['order'],
        name: 'idx_nav_point_order',
      },
    ],
  }
);

export default NavigationPoint;
