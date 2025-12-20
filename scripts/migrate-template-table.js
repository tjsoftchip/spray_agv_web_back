/**
 * 数据库迁移脚本 - 删除模板表中的无用字段
 * 删除 yardShape、yardDimensions 和 version 字段
 */

const { Sequelize } = require('sequelize');
const path = require('path');

// 数据库配置
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, '../data/database.sqlite'),
  logging: console.log
});

async function migrateTemplateTable() {
  try {
    console.log('开始模板表迁移...');
    
    // 检查数据库连接
    await sequelize.authenticate();
    console.log('数据库连接成功');
    
    // 检查表是否存在
    const [tableResults] = await sequelize.query(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='templates'
    `);
    
    if (tableResults.length === 0) {
      console.log('templates 表不存在，无需迁移');
      return;
    }
    
    // 获取当前表结构
    const [results] = await sequelize.query("PRAGMA table_info(templates)");
    const existingColumns = results.map(row => row.name);
    console.log('当前表结构:', existingColumns);
    
    // 删除不需要的字段
    const fieldsToRemove = ['yardShape', 'yardDimensions', 'version'];
    
    for (const field of fieldsToRemove) {
      if (existingColumns.includes(field)) {
        console.log(`删除字段: ${field}`);
        try {
          await sequelize.query(`ALTER TABLE templates DROP COLUMN ${field}`);
          console.log(`字段 ${field} 删除成功`);
        } catch (error) {
          console.error(`删除字段 ${field} 失败:`, error);
        }
      } else {
        console.log(`字段 ${field} 不存在，跳过`);
      }
    }
    
    console.log('模板表迁移完成！');
    
  } catch (error) {
    console.error('模板表迁移失败:', error);
    throw error;
  } finally {
    await sequelize.close();
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  migrateTemplateTable()
    .then(() => {
      console.log('迁移成功完成');
      process.exit(0);
    })
    .catch((error) => {
      console.error('迁移失败:', error);
      process.exit(1);
    });
}

module.exports = { migrateTemplateTable };