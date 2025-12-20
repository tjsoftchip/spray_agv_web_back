/**
 * 数据库迁移脚本 - 添加新字段到tasks表
 * 解决 "no such column: operationType" 错误
 */

const { Sequelize } = require('sequelize');
const path = require('path');
const fs = require('fs');

// 数据库配置
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, '../database.sqlite'),
  logging: console.log
});

async function migrateDatabase() {
  try {
    console.log('开始数据库迁移...');
    
    // 检查数据库连接
    await sequelize.authenticate();
    console.log('数据库连接成功');
    
    // 检查表是否存在
    const [tableResults] = await sequelize.query(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'
    `);
    
    if (tableResults.length === 0) {
      console.log('tasks 表不存在，创建新表...');
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          priority INTEGER NOT NULL DEFAULT 0,
          templateIds TEXT NOT NULL,
          transitionSequence TEXT NOT NULL,
          executionType TEXT NOT NULL DEFAULT 'manual',
          scheduleConfig TEXT,
          isScheduleEnabled INTEGER NOT NULL DEFAULT 0,
          operationType TEXT NOT NULL DEFAULT 'single',
          initialPosition TEXT,
          executionParams TEXT NOT NULL,
          createdBy TEXT NOT NULL,
          startTime DATETIME,
          endTime DATETIME,
          progress REAL NOT NULL DEFAULT 0,
          executionLogs TEXT,
          navigationSequence TEXT,
          currentNavigationIndex INTEGER,
          obstacleEvents TEXT,
          isDeleted INTEGER NOT NULL DEFAULT 0,
          createdAt DATETIME NOT NULL,
          updatedAt DATETIME NOT NULL
        )
      `);
      console.log('tasks 表创建成功');
    }
    
    // 直接查询表结构
    const [results] = await sequelize.query("PRAGMA table_info(tasks)");
    const existingColumns = results.map(row => row.name);
    console.log('当前表结构:', existingColumns);
    
    // 检查并添加 operationType 字段
    if (!existingColumns.includes('operationType')) {
      console.log('添加 operationType 字段...');
      await sequelize.query(`
        ALTER TABLE tasks ADD COLUMN operationType TEXT NOT NULL DEFAULT 'single'
      `);
      console.log('operationType 字段添加成功');
    } else {
      console.log('operationType 字段已存在');
    }
    
    // 检查并添加 initialPosition 字段
    if (!existingColumns.includes('initialPosition')) {
      console.log('添加 initialPosition 字段...');
      await sequelize.query(`
        ALTER TABLE tasks ADD COLUMN initialPosition TEXT
      `);
      console.log('initialPosition 字段添加成功');
    } else {
      console.log('initialPosition 字段已存在');
    }
    
    // 检查并更新 scheduleConfig 字段结构
    if (existingColumns.includes('scheduleConfig') && existingColumns.includes('operationFrequency')) {
      console.log('scheduleConfig 和 operationFrequency 字段已存在，检查现有数据...');
      
      // 获取所有任务
      const [results] = await sequelize.query(`
        SELECT id, scheduleConfig, operationFrequency FROM tasks
      `);
      
      console.log(`找到 ${results.length} 个任务需要检查`);
      
      for (const task of results) {
        try {
          let scheduleConfig = task.scheduleConfig;
          
          // 如果 scheduleConfig 是旧的格式，进行转换
          if (task.operationFrequency && (!scheduleConfig || scheduleConfig === '{}')) {
            const oldFreq = JSON.parse(task.operationFrequency);
            scheduleConfig = {
              type: oldFreq.type === 'daily' ? 'daily' : 'weekly',
              time: oldFreq.startTime || '09:00',
              weekdays: oldFreq.type === 'weekly' ? [1, 2, 3, 4, 5] : undefined
            };
            
            // 更新数据库
            await sequelize.query(`
              UPDATE tasks 
              SET scheduleConfig = :scheduleConfig 
              WHERE id = :id
            `, {
              replacements: {
                scheduleConfig: JSON.stringify(scheduleConfig),
                id: task.id
              }
            });
            
            console.log(`任务 ${task.id} 的 scheduleConfig 已更新`);
          }
        } catch (error) {
          console.error(`处理任务 ${task.id} 时出错:`, error);
        }
      }
    }
    
    // 删除不再需要的字段
    const fieldsToRemove = ['operationFrequency', 'sprayDuration', 'repeatCount'];
    for (const field of fieldsToRemove) {
      if (existingColumns.includes(field)) {
        console.log(`删除字段 ${field}...`);
        try {
          await sequelize.query(`ALTER TABLE tasks DROP COLUMN ${field}`);
          console.log(`字段 ${field} 删除成功`);
        } catch (error) {
          console.error(`删除字段 ${field} 失败:`, error);
        }
      }
    }
    
    console.log('数据库迁移完成！');
    
  } catch (error) {
    console.error('数据库迁移失败:', error);
    throw error;
  } finally {
    await sequelize.close();
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  migrateDatabase()
    .then(() => {
      console.log('迁移成功完成');
      process.exit(0);
    })
    .catch((error) => {
      console.error('迁移失败:', error);
      process.exit(1);
    });
}

module.exports = { migrateDatabase };