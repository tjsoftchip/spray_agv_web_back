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
  executionType: 'manual' | 'scheduled' | 'queue';
  operationType: 'single' | 'scheduled';
  scheduleConfig?: {
    type: 'once' | 'daily' | 'weekly';
    time: string;
    weekdays?: number[];
  };
  isScheduleEnabled: boolean;
  initialPosition?: {
    x: number;
    y: number;
    theta: number;
  };
  executionParams: {
    operationSpeed: number;
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
  navigationSequence?: Array<{
    pointId: string;
    pointName: string;
    position: { x: number; y: number; z: number };
    orientation: { x: number; y: number; z: number; w: number };
    status: 'pending' | 'navigating' | 'arrived' | 'failed';
    startTime?: Date;
    endTime?: Date;
    retryCount?: number;
  }>;
  currentNavigationIndex?: number;
  obstacleEvents?: Array<{
    timestamp: Date;
    type: 'laser_only' | 'camera_only' | 'both_confirmed';
    action: 'stopped' | 'slowed' | 'continued';
    position: { x: number; y: number };
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
  public executionType!: 'manual' | 'scheduled' | 'queue';
  public operationType!: 'single' | 'scheduled';
  public scheduleConfig?: {
    type: 'once' | 'daily' | 'weekly';
    time: string;
    weekdays?: number[];
  };
  public isScheduleEnabled!: boolean;
  public initialPosition?: {
    x: number;
    y: number;
    theta: number;
  };
  public executionParams!: {
    operationSpeed: number;
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
  public navigationSequence?: Array<{
    pointId: string;
    pointName: string;
    position: { x: number; y: number; z: number };
    orientation: { x: number; y: number; z: number; w: number };
    status: 'pending' | 'navigating' | 'arrived' | 'failed';
    startTime?: Date;
    endTime?: Date;
    retryCount?: number;
  }>;
  public currentNavigationIndex?: number;
  public obstacleEvents?: Array<{
    timestamp: Date;
    type: 'laser_only' | 'camera_only' | 'both_confirmed';
    action: 'stopped' | 'slowed' | 'continued';
    position: { x: number; y: number };
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
    executionType: {
      type: DataTypes.ENUM('manual', 'scheduled', 'queue'),
      allowNull: false,
      defaultValue: 'manual',
    },
    scheduleConfig: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    isScheduleEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    operationType: {
      type: DataTypes.ENUM('single', 'scheduled'),
      allowNull: false,
      defaultValue: 'single',
    },
    initialPosition: {
      type: DataTypes.JSON,
      allowNull: true,
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
    navigationSequence: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: [],
    },
    currentNavigationIndex: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
    },
    obstacleEvents: {
      type: DataTypes.JSON,
      allowNull: true,
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
