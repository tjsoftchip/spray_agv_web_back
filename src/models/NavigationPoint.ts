import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface NavigationPointAttributes {
  id: string;
  name: string;
  templateId?: string;
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
  type: 'start' | 'waypoint' | 'end';
  createdAt?: Date;
  updatedAt?: Date;
}

interface NavigationPointCreationAttributes extends Optional<NavigationPointAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

class NavigationPoint extends Model<NavigationPointAttributes, NavigationPointCreationAttributes> implements NavigationPointAttributes {
  public id!: string;
  public name!: string;
  public templateId?: string;
  public yardId!: string;
  public position!: { x: number; y: number; z: number };
  public orientation!: { x: number; y: number; z: number; w: number };
  public order!: number;
  public type!: 'start' | 'waypoint' | 'end';
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
    templateId: {
      type: DataTypes.STRING,
      allowNull: true,
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
        fields: ['templateId'],
        name: 'idx_nav_point_template_id',
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
