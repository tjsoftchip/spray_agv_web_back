import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface TaskQueueAttributes {
  id: string;
  name: string;
  tasks: Array<{
    taskId: string;
    order: number;
    status: 'pending' | 'running' | 'completed' | 'failed';
  }>;
  status: 'idle' | 'running' | 'paused';
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

interface TaskQueueCreationAttributes extends Optional<TaskQueueAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

class TaskQueue extends Model<TaskQueueAttributes, TaskQueueCreationAttributes> implements TaskQueueAttributes {
  public id!: string;
  public name!: string;
  public tasks!: Array<{ taskId: string; order: number; status: 'pending' | 'running' | 'completed' | 'failed' }>;
  public status!: 'idle' | 'running' | 'paused';
  public isActive!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

TaskQueue.init(
  {
    id: {
      type: DataTypes.STRING,
      primaryKey: true,
      defaultValue: () => `queue_${Date.now()}`,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    tasks: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'idle',
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  },
  {
    sequelize,
    tableName: 'task_queues',
    timestamps: true,
  }
);

export default TaskQueue;
