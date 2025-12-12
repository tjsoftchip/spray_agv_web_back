import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface SupplyStationAttributes {
  id: string;
  name: string;
  description?: string;
  type: 'water' | 'charge' | 'combined';
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
  qrcodePosition?: {
    x: number;
    y: number;
    z: number;
  };
  waterSupplyEnabled?: boolean;
  chargingEnabled?: boolean;
  ipAddress?: string;
  port?: number;
  status: 'online' | 'offline' | 'maintenance';
  createdAt?: Date;
  updatedAt?: Date;
}

interface SupplyStationCreationAttributes extends Optional<SupplyStationAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

class SupplyStation extends Model<SupplyStationAttributes, SupplyStationCreationAttributes> implements SupplyStationAttributes {
  public id!: string;
  public name!: string;
  public description?: string;
  public type!: 'water' | 'charge' | 'combined';
  public position!: { x: number; y: number; z: number };
  public orientation!: { x: number; y: number; z: number; w: number };
  public qrcodePosition?: { x: number; y: number; z: number };
  public waterSupplyEnabled?: boolean;
  public chargingEnabled?: boolean;
  public ipAddress?: string;
  public port?: number;
  public status!: 'online' | 'offline' | 'maintenance';
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

SupplyStation.init(
  {
    id: {
      type: DataTypes.STRING,
      primaryKey: true,
      defaultValue: () => `station_${Date.now()}`,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    type: {
      type: DataTypes.ENUM('water', 'charge', 'combined'),
      allowNull: false,
      defaultValue: 'combined',
    },
    position: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    orientation: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    qrcodePosition: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    waterSupplyEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
    },
    chargingEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
    },
    ipAddress: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    port: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 80,
    },
    status: {
      type: DataTypes.ENUM('online', 'offline', 'maintenance'),
      allowNull: false,
      defaultValue: 'offline',
    },
  },
  {
    sequelize,
    tableName: 'supply_stations',
  }
);

export default SupplyStation;
