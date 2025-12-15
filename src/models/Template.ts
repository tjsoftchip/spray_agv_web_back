import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface TemplateAttributes {
  id: string;
  name: string;
  description: string;
  yardId: string;
  yardName: string;
  yardShape: 'rectangle' | 'custom';
  yardDimensions: {
    length: number;
    width: number;
  };
  defaultMapId?: string;
  navigationPoints: Array<{
    id: string;
    name: string;
    position: { x: number; y: number; z: number };
    orientation: { x: number; y: number; z: number; w: number };
    order: number;
    type: 'start' | 'waypoint' | 'end';
  }>;
  roadSegments: Array<{
    id: string;
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
  }>;
  version: string;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

interface TemplateCreationAttributes extends Optional<TemplateAttributes, 'id'> {}

class Template extends Model<TemplateAttributes, TemplateCreationAttributes> implements TemplateAttributes {
  public id!: string;
  public name!: string;
  public description!: string;
  public yardId!: string;
  public yardName!: string;
  public yardShape!: 'rectangle' | 'custom';
  public yardDimensions!: { length: number; width: number };
  public defaultMapId?: string;
  public navigationPoints!: Array<{
    id: string;
    name: string;
    position: { x: number; y: number; z: number };
    orientation: { x: number; y: number; z: number; w: number };
    order: number;
    type: 'start' | 'waypoint' | 'end';
  }>;
  public roadSegments!: Array<{
    id: string;
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
  }>;
  public version!: string;
  public isActive!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Template.init(
  {
    id: {
      type: DataTypes.STRING,
      primaryKey: true,
      defaultValue: () => `template_${Date.now()}`,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    yardId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    yardName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    yardShape: {
      type: DataTypes.ENUM('rectangle', 'custom'),
      allowNull: false,
      defaultValue: 'rectangle',
    },
    yardDimensions: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    defaultMapId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    navigationPoints: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    roadSegments: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    version: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: '1.0',
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    sequelize,
    tableName: 'templates',
    indexes: [
      {
        fields: ['yardId'],
        name: 'idx_template_yard_id',
      },
      {
        fields: ['isActive'],
        name: 'idx_template_is_active',
      },
      {
        fields: ['createdAt'],
        name: 'idx_template_created_at',
      },
    ],
  }
);

export default Template;
