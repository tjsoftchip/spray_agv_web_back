import { Request, Response } from 'express';
import { MapModel } from '../models';
import rosbridgeService from '../services/rosbridgeService';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const getMaps = async (req: Request, res: Response) => {
  try {
    const maps = await MapModel.findAll();
    res.json(maps);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch maps' });
  }
};

export const getActiveMap = async (req: Request, res: Response) => {
  try {
    const map = await MapModel.findOne({ where: { isActive: true } });
    if (!map) {
      return res.status(404).json({ error: 'No active map found' });
    }
    res.json(map);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch active map' });
  }
};

export const setActiveMap = async (req: Request, res: Response) => {
  try {
    await MapModel.update({ isActive: false }, { where: {} });
    
    const map = await MapModel.findByPk(req.params.id);
    if (!map) {
      return res.status(404).json({ error: 'Map not found' });
    }
    
    await map.update({ isActive: true });
    res.json(map);
  } catch (error) {
    res.status(500).json({ error: 'Failed to set active map' });
  }
};

export const startMapping = async (req: Request, res: Response) => {
  try {
    const command = 'ros2 launch yahboomcar_slam map_cartographer_launch.py &';
    await execAsync(command);
    res.json({ message: 'Mapping started' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start mapping' });
  }
};

export const stopMapping = async (req: Request, res: Response) => {
  try {
    try {
      await execAsync('pkill -f cartographer');
    } catch (e) {
      // 忽略没有找到进程的错误
    }
    res.json({ message: 'Mapping stopped' });
  } catch (error) {
    console.error('Error stopping mapping:', error);
    res.status(500).json({ error: 'Failed to stop mapping' });
  }
};

export const saveMap = async (req: Request, res: Response) => {
  try {
    const { name, description } = req.body;
    const timestamp = Date.now();
    const mapDir = '/home/jetson/maps';
    const mapPath = `${mapDir}/${name}_${timestamp}`;
    
    // 创建目录
    await execAsync(`mkdir -p ${mapDir}`);
    
    // 尝试保存地图（如果ROS2环境可用）
    try {
      await execAsync(`ros2 run nav2_map_server map_saver_cli -f ${mapPath}`);
    } catch (e) {
      console.log('ROS2 map saver not available, creating placeholder');
    }
    
    const map = await MapModel.create({
      name,
      description,
      filePath: `${mapPath}.yaml`,
      resolution: 0.05,
      width: 1000,
      height: 1000,
      origin: { x: 0, y: 0, z: 0 },
      isActive: false,
    });
    
    res.status(201).json(map);
  } catch (error) {
    console.error('Error saving map:', error);
    res.status(500).json({ error: 'Failed to save map' });
  }
};

export const loadMap = async (req: Request, res: Response) => {
  try {
    const map = await MapModel.findByPk(req.params.id);
    if (!map) {
      return res.status(404).json({ error: 'Map not found' });
    }
    
    rosbridgeService.callService('/map_server/load_map', 'nav2_msgs/LoadMap', {
      map_url: map.filePath,
    });
    
    res.json({ message: 'Map loaded', map });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load map' });
  }
};
