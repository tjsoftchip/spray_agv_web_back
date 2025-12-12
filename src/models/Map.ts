import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface MapAttributes {
  id: string;
  name: string;
  description?: string;
  filePath: string;
  resolution: number;
  width: number;
  height: number;
  origin: {
    x: number;
    y: number;
    z: number;
  };
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

interface MapCreationAttributes extends Optional<MapAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

class MapModel extends Model<MapAttributes, MapCreationAttributes> implements MapAttributes {
  public id!: string;
  public name!: string;
  public description?: string;
  public filePath!: string;
  public resolution!: number;
  public width!: number;
  public height!: number;
  public origin!: { x: number; y: number; z: number };
  public isActive!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

MapModel.init(
  {
    id: {
      type: DataTypes.STRING,
      primaryKey: true,
      defaultValue: () => `map_${Date.now()}`,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
    },
    filePath: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    resolution: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0.05,
    },
    width: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    height: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    origin: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
  },
  {
    sequelize,
    tableName: 'maps',
    timestamps: true,
  }
);

export default MapModel;
