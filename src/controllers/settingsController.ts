import { Request, Response } from 'express';
import SystemConfig from '../models/SystemConfig';

// 获取所有系统配置
export const getAllConfigs = async (req: Request, res: Response) => {
  try {
    const configs = await SystemConfig.findAll({
      order: [['category', 'ASC'], ['key', 'ASC']]
    });
    
    // 按类别分组
    const groupedConfigs = configs.reduce((acc: any, config: any) => {
      if (!acc[config.category]) {
        acc[config.category] = [];
      }
      acc[config.category].push({
        key: config.key,
        value: config.value,
        description: config.description
      });
      return acc;
    }, {});
    
    res.json(groupedConfigs);
  } catch (error) {
    console.error('Error getting system configs:', error);
    res.status(500).json({ error: 'Failed to get system configs' });
  }
};

// 更新系统配置
export const updateConfig = async (req: Request, res: Response) => {
  try {
    const { key, value } = req.body;
    
    if (!key || value === undefined) {
      return res.status(400).json({ error: 'Key and value are required' });
    }
    
    const [config, created] = await SystemConfig.findOrCreate({
      where: { key },
      defaults: {
        key,
        value,
        description: `配置项: ${key}`,
        category: 'general'
      }
    });
    
    if (!created) {
      await config.update({ value });
    }
    
    res.json({ message: 'Config updated successfully', config });
  } catch (error) {
    console.error('Error updating config:', error);
    res.status(500).json({ error: 'Failed to update config' });
  }
};

// 批量更新系统配置
export const updateMultipleConfigs = async (req: Request, res: Response) => {
  try {
    const { configs } = req.body;
    
    if (!Array.isArray(configs)) {
      return res.status(400).json({ error: 'Configs must be an array' });
    }
    
    const results = [];
    
    for (const { key, value, description, category } of configs) {
      if (!key || value === undefined) continue;
      
      const [config, created] = await SystemConfig.findOrCreate({
        where: { key },
        defaults: {
          key,
          value,
          description: description || `配置项: ${key}`,
          category: category || 'general'
        }
      });
      
      if (!created) {
        await config.update({ 
          value,
          description: description || config.description,
          category: category || config.category
        });
      }
      
      results.push({ key, value, updated: !created });
    }
    
    res.json({ message: 'Configs updated successfully', results });
  } catch (error) {
    console.error('Error updating multiple configs:', error);
    res.status(500).json({ error: 'Failed to update configs' });
  }
};

// 获取特定配置
export const getConfig = async (req: Request, res: Response) => {
  try {
    const { key } = req.params;
    
    const config = await SystemConfig.findOne({ where: { key } });
    
    if (!config) {
      return res.status(404).json({ error: 'Config not found' });
    }
    
    res.json(config);
  } catch (error) {
    console.error('Error getting config:', error);
    res.status(500).json({ error: 'Failed to get config' });
  }
};

// 初始化默认配置
export const initializeDefaultConfigs = async () => {
  try {
    const defaultConfigs = [
      // 系统配置
      { key: 'hostname', value: 'KWS-R2', description: '系统主机名', category: 'system' },
      
      // 支架参数
      { key: 'bracket_min_height', value: '1.8', description: '支架最小高度(米)', category: 'bracket' },
      { key: 'bracket_max_height', value: '2.8', description: '支架最大高度(米)', category: 'bracket' },
      { key: 'bracket_default_height', value: '1.8', description: '支架默认高度(米)', category: 'bracket' },
      
      // 运动参数
      { key: 'max_linear_speed', value: '0.35', description: '最大线速度(米/秒)', category: 'motion' },
      { key: 'max_angular_speed', value: '1.2', description: '最大角速度(弧度/秒)', category: 'motion' },
      
      // 阈值参数
      { key: 'low_water_threshold', value: '10', description: '低水位阈值(%)', category: 'threshold' },
      { key: 'low_battery_threshold', value: '10', description: '低电量阈值(%)', category: 'threshold' },
      
      // 导航参数
      { key: 'navigation_max_speed', value: '0.5', description: '导航最大速度(米/秒)', category: 'navigation' },
      { key: 'navigation_obstacle_avoidance', value: 'true', description: '启用避障功能', category: 'navigation' },
      { key: 'navigation_planning_timeout', value: '30', description: '路径规划超时(秒)', category: 'navigation' },
      
      // 建图参数
      { key: 'mapping_resolution', value: '0.05', description: '地图分辨率(米)', category: 'mapping' },
      { key: 'mapping_update_rate', value: '5', description: '地图更新频率(Hz)', category: 'mapping' },
      { key: 'mapping_scan_range', value: '10.0', description: '激光扫描范围(米)', category: 'mapping' },
      
      // 补给参数
      { key: 'supply_marker_size', value: '0.168', description: 'ArUco标记尺寸(米)', category: 'supply' },
      { key: 'supply_alignment_tolerance', value: '0.05', description: '对齐容差(米)', category: 'supply' },
      { key: 'supply_max_retry_attempts', value: '3', description: '最大重试次数', category: 'supply' },
      
      // 相机参数
      { key: 'camera_width', value: '640', description: '相机图像宽度(像素)', category: 'camera' },
      { key: 'camera_height', value: '480', description: '相机图像高度(像素)', category: 'camera' },
      { key: 'camera_fps', value: '30', description: '相机帧率', category: 'camera' },
      { key: 'camera_enable_depth', value: 'true', description: '启用深度相机', category: 'camera' }
    ];
    
    for (const config of defaultConfigs) {
      const [existing, created] = await SystemConfig.findOrCreate({
        where: { key: config.key },
        defaults: config
      });
      
      if (created) {
        console.log(`Created default config: ${config.key} = ${config.value}`);
      }
    }
    
    console.log('Default system configurations initialized');
  } catch (error) {
    console.error('Error initializing default configs:', error);
  }
};