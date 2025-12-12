import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface RoadSegmentAttributes {
  id: string;
  templateId: string;
  startNavPointId: string;
  endNavPointId: string;
  sprayParams: {
    pumpStatus: boolean;
    leftArmStatus: 'open' | 'close' | 'adjusting';
    rightArmStatus: 'open' | 'close' | 'adjusting';
    leftValveStatus: boolean;
    rightValveStatus: boolean;
    armHeight: number;
  };
  operationSpeed: number;
  createdAt?: Date;
  updatedAt?: Date;
}

interface RoadSegmentCreationAttributes extends Optional<RoadSegmentAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

class RoadSegment extends Model<RoadSegmentAttributes, RoadSegmentCreationAttributes> implements RoadSegmentAttributes {
  public id!: string;
  public templateId!: string;
  public startNavPointId!: string;
  public endNavPointId!: string;
  public sprayParams!: {
    pumpStatus: boolean;
    leftArmStatus: 'open' | 'close' | 'adjusting';
    rightArmStatus: 'open' | 'close' | 'adjusting';
    leftValveStatus: boolean;
    rightValveStatus: boolean;
    armHeight: number;
  };
  public operationSpeed!: number;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

RoadSegment.init(
  {
    id: {
      type: DataTypes.STRING,
      primaryKey: true,
      defaultValue: () => `segment_${Date.now()}`,
    },
    templateId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    startNavPointId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    endNavPointId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    sprayParams: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    operationSpeed: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0.35,
    },
  },
  {
    sequelize,
    tableName: 'road_segments',
    timestamps: true,
  }
);

export default RoadSegment;
