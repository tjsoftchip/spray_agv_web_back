import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface ScheduleAttributes {
  id: string;
  name: string;
  description?: string;
  taskId: string;
  scheduleType: 'once' | 'daily' | 'weekly' | 'monthly' | 'cron';
  startTime: Date;
  endTime?: Date;
  repeatInterval?: number;
  cronExpression?: string;
  status: 'active' | 'inactive';
  lastExecuted?: Date;
  nextExecution?: Date;
  executionCount: number;
  maxExecutions?: number;
  isDeleted: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

interface ScheduleCreationAttributes extends Optional<ScheduleAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

class Schedule extends Model<ScheduleAttributes, ScheduleCreationAttributes> implements ScheduleAttributes {
  public id!: string;
  public name!: string;
  public description?: string;
  public taskId!: string;
  public scheduleType!: 'once' | 'daily' | 'weekly' | 'monthly' | 'cron';
  public startTime!: Date;
  public endTime?: Date;
  public repeatInterval?: number;
  public cronExpression?: string;
  public status!: 'active' | 'inactive';
  public lastExecuted?: Date;
  public nextExecution?: Date;
  public executionCount!: number;
  public maxExecutions?: number;
  public isDeleted!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Schedule.init(
  {
    id: {
      type: DataTypes.STRING,
      primaryKey: true,
      defaultValue: () => `schedule_${Date.now()}`,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    taskId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    scheduleType: {
      type: DataTypes.ENUM('once', 'daily', 'weekly', 'monthly', 'cron'),
      allowNull: false,
      defaultValue: 'once',
    },
    startTime: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    endTime: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    repeatInterval: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    cronExpression: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive'),
      allowNull: false,
      defaultValue: 'active',
    },
    lastExecuted: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    nextExecution: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    executionCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    maxExecutions: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    isDeleted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    sequelize,
    tableName: 'schedules',
    timestamps: true,
    indexes: [
      {
        fields: ['taskId'],
        name: 'idx_schedule_task_id',
      },
      {
        fields: ['status'],
        name: 'idx_schedule_status',
      },
      {
        fields: ['scheduleType'],
        name: 'idx_schedule_type',
      },
      {
        fields: ['nextExecution'],
        name: 'idx_schedule_next_execution',
      },
      {
        fields: ['isDeleted'],
        name: 'idx_schedule_is_deleted',
      },
      {
        fields: ['status', 'nextExecution'],
        name: 'idx_schedule_status_next',
      },
    ],
  }
);

export default Schedule;
