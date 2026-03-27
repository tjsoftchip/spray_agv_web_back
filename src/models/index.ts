import sequelize from '../config/database';
import { QueryTypes } from 'sequelize';
import User from './User';
import Template from './Template';
import Task from './Task';
import SupplyStation from './SupplyStation';
import BeamYard from './BeamYard';
import NavigationPoint from './NavigationPoint';
import RoadSegment from './RoadSegment';
import TaskQueue from './TaskQueue';
import MapModel from './Map';
import Schedule from './Schedule';
import SystemConfig from './SystemConfig';
import GPSMap from './GPSMap';

const models = {
  User,
  Template,
  Task,
  SupplyStation,
  BeamYard,
  NavigationPoint,
  RoadSegment,
  TaskQueue,
  MapModel,
  Schedule,
  SystemConfig,
  GPSMap,
};

// 定义模型关联
BeamYard.hasMany(NavigationPoint, {
  foreignKey: 'yardId',
  as: 'navigationPoints',
});
NavigationPoint.belongsTo(BeamYard, {
  foreignKey: 'yardId',
  as: 'yard',
});

/**
 * 检查并添加缺失的数据库列
 */
async function ensureColumns(): Promise<void> {
  // 需要确保存在的列：{ 表名: { 列名: SQL类型 } }
  const requiredColumns: Record<string, Record<string, string>> = {
    gps_maps: {
      turnArcs: 'TEXT DEFAULT \'[]\'',
      statistics: 'TEXT',
    },
  };

  for (const [table, columns] of Object.entries(requiredColumns)) {
    try {
      // 获取表的列信息
      const tableInfo = await sequelize.query(`PRAGMA table_info(${table})`, {
        type: QueryTypes.SELECT,
      }) as Array<{ name: string }>;

      const existingColumns = new Set(tableInfo.map(col => col.name));

      for (const [colName, colType] of Object.entries(columns)) {
        if (!existingColumns.has(colName)) {
          console.log(`[DB Migration] Adding column ${colName} to ${table}...`);
          await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${colName} ${colType}`);
          console.log(`[DB Migration] Column ${colName} added successfully.`);
        }
      }
    } catch (err) {
      // 表可能不存在，忽略错误
      console.log(`[DB Migration] Skipping ${table}: ${(err as Error).message}`);
    }
  }
}

export const initDatabase = async (): Promise<void> => {
  try {
    await sequelize.authenticate();
    console.log('Database connection established successfully.');

    // 同步模型（创建不存在的表）
    await sequelize.sync({ force: false });
    console.log('Database models synchronized.');

    // 确保新增的列存在（SQLite不支持sync alter，需要手动添加）
    await ensureColumns();
    console.log('Database schema migration complete.');

    const userCount = await User.count();
    if (userCount === 0) {
      await User.create({
        username: 'admin',
        password: 'admin123',
        role: 'admin',
      });
      console.log('Default admin user created.');
    }
  } catch (error) {
    console.error('Unable to connect to the database:', error);
    // 不抛出错误，让服务继续启动
    console.log('Database sync failed, but continuing with startup...');
  }
};

export { sequelize, User, Template, Task, SupplyStation, BeamYard, NavigationPoint, RoadSegment, TaskQueue, MapModel, Schedule, SystemConfig, GPSMap };
export default models;
