import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface BeamYardAttributes {
  id: string;
  name: string;
  description?: string;
  location?: string;
  shape: 'rectangle' | 'custom';
  dimensions: {
    length: number;
    width: number;
  };
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

interface BeamYardCreationAttributes extends Optional<BeamYardAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

class BeamYard extends Model<BeamYardAttributes, BeamYardCreationAttributes> implements BeamYardAttributes {
  public id!: string;
  public name!: string;
  public description?: string;
  public location?: string;
  public shape!: 'rectangle' | 'custom';
  public dimensions!: { length: number; width: number };
  public isActive!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

BeamYard.init(
  {
    id: {
      type: DataTypes.STRING,
      primaryKey: true,
      defaultValue: () => `yard_${Date.now()}`,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
    },
    location: {
      type: DataTypes.STRING,
    },
    shape: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'rectangle',
    },
    dimensions: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  },
  {
    sequelize,
    tableName: 'beam_yards',
    timestamps: true,
  }
);

export default BeamYard;
