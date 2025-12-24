import sequelize from '../config/database';
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

export const initDatabase = async (): Promise<void> => {
  try {
    await sequelize.authenticate();
    console.log('Database connection established successfully.');
    
    // 简单同步，不进行alter操作
    await sequelize.sync({ force: false });
    console.log('Database models synchronized.');
    
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

export { sequelize, User, Template, Task, SupplyStation, BeamYard, NavigationPoint, RoadSegment, TaskQueue, MapModel, Schedule, SystemConfig };
export default models;
