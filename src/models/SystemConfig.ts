import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface SystemConfigAttributes {
  id?: number;
  key: string;
  value: string;
  description?: string;
  category: string;
  createdAt?: Date;
  updatedAt?: Date;
}

interface SystemConfigCreationAttributes extends Optional<SystemConfigAttributes, 'id' | 'createdAt' | 'updatedAt' | 'description'> {}

class SystemConfig extends Model<SystemConfigAttributes, SystemConfigCreationAttributes> implements SystemConfigAttributes {
  public id!: number;
  public key!: string;
  public value!: string;
  public description?: string;
  public category!: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

SystemConfig.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    key: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    value: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    category: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'general',
    },
  },
  {
    sequelize,
    modelName: 'SystemConfig',
    tableName: 'system_configs',
    timestamps: true,
  }
);

export default SystemConfig;