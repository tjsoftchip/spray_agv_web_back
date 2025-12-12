import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface TaskAttributes {
  id: string;
  name: string;
  description: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  priority: number;
  templateIds: string[];
  transitionSequence: string[];
  operationFrequency: {
    type: 'daily' | 'weekly' | 'custom';
    interval: number;
    startTime: string;
    endTime: string;
  };
  executionParams: {
    operationSpeed: number;
    sprayDuration: number;
    repeatCount: number;
  };
  createdBy: string;
  startTime?: Date;
  endTime?: Date;
  progress: number;
  executionLogs: Array<{
    timestamp: Date;
    level: 'info' | 'warning' | 'error';
    message: string;
  }>;
  isDeleted: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

interface TaskCreationAttributes extends Optional<TaskAttributes, 'id'> {}

class Task extends Model<TaskAttributes, TaskCreationAttributes> implements TaskAttributes {
  public id!: string;
  public name!: string;
  public description!: string;
  public status!: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  public priority!: number;
  public templateIds!: string[];
  public transitionSequence!: string[];
  public operationFrequency!: {
    type: 'daily' | 'weekly' | 'custom';
    interval: number;
    startTime: string;
    endTime: string;
  };
  public executionParams!: {
    operationSpeed: number;
    sprayDuration: number;
    repeatCount: number;
  };
  public createdBy!: string;
  public startTime?: Date;
  public endTime?: Date;
  public progress!: number;
  public executionLogs!: Array<{
    timestamp: Date;
    level: 'info' | 'warning' | 'error';
    message: string;
  }>;
  public isDeleted!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Task.init(
  {
    id: {
      type: DataTypes.STRING,
      primaryKey: true,
      defaultValue: () => `task_${Date.now()}`,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM('pending', 'running', 'paused', 'completed', 'failed'),
      allowNull: false,
      defaultValue: 'pending',
    },
    priority: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    templateIds: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    transitionSequence: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    operationFrequency: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    executionParams: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    createdBy: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    startTime: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    endTime: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    progress: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    executionLogs: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    isDeleted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    sequelize,
    tableName: 'tasks',
    indexes: [
      {
        fields: ['status'],
        name: 'idx_task_status',
      },
      {
        fields: ['priority'],
        name: 'idx_task_priority',
      },
      {
        fields: ['createdBy'],
        name: 'idx_task_created_by',
      },
      {
        fields: ['isDeleted'],
        name: 'idx_task_is_deleted',
      },
      {
        fields: ['status', 'isDeleted'],
        name: 'idx_task_status_deleted',
      },
      {
        fields: ['createdAt'],
        name: 'idx_task_created_at',
      },
    ],
  }
);

export default Task;
