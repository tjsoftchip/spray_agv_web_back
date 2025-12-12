import { Request, Response } from 'express';
import { MapModel } from '../models';
import rosbridgeService from '../services/rosbridgeService';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const execAsyncQuiet = promisify(exec);

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
    console.log('Starting mapping process...');
    
    // 先创建日志文件
    const { spawn } = require('child_process');
    const fs = require('fs');
    
    // 确保日志文件存在
    fs.writeFileSync('/tmp/mapping.log', `Mapping started at ${new Date().toISOString()}\n`);
    
    // 使用更简单的方式启动建图
    const child = spawn('bash', ['-c', 
      'source /home/jetson/yahboomcar_ros2_ws/yahboomcar_ws/install/setup.bash && ' +
      'ros2 launch yahboomcar_nav map_cartographer_launch.py'
    ], {
      stdio: ['ignore', fs.openSync('/tmp/mapping.log', 'a'), fs.openSync('/tmp/mapping.log', 'a')],
      detached: true
    });
    
    child.on('error', (error: Error) => {
      console.error('Failed to start mapping process:', error);
      fs.appendFileSync('/tmp/mapping.log', `Error: ${error.message}\n`);
    });
    
    child.on('exit', (code: number, signal: string) => {
      console.log(`Mapping process exited with code ${code}, signal ${signal}`);
      fs.appendFileSync('/tmp/mapping.log', `Process exited with code ${code}, signal ${signal}\n`);
    });
    
    // 分离子进程
    child.unref();
    
    console.log('Mapping process spawned with PID:', child.pid);
    fs.appendFileSync(`/tmp/mapping.log`, `Process spawned with PID: ${child.pid}\n`);
    
    // 订阅地图话题,用于实时预览
    setTimeout(() => {
      console.log('Subscribing to map topics...');
      rosbridgeService.subscribeTopic('/map', 'nav_msgs/OccupancyGrid');
      // 先尝试订阅/robot_pose_k，如果没有数据则使用里程计
      rosbridgeService.subscribeTopic('/robot_pose_k', 'geometry_msgs/PoseStamped');
      rosbridgeService.subscribeTopic('/odom', 'nav_msgs/Odometry');
    }, 5000);
    
    res.json({ message: 'Mapping started successfully', pid: child.pid });
  } catch (error) {
    console.error('Error starting mapping:', error);
    res.status(500).json({ error: 'Failed to start mapping' });
  }
};

export const stopMapping = async (req: Request, res: Response) => {
  try {
    const { spawn } = require('child_process');
    
    // 停止所有建图相关节点
    const process = spawn('bash', ['-c', `
      source /home/jetson/yahboomcar_ros2_ws/yahboomcar_ws/install/setup.bash && 
      pkill -f "ros2 launch yahboomcar_nav map_cartographer_launch.py" &&
      pkill -f "cartographer_node" &&
      pkill -f "cartographer_occupancy_grid_node" &&
      pkill -f "joint_state_publisher" &&
      pkill -f "robot_state_publisher" &&
      pkill -f "Ackman_driver_R2" &&
      pkill -f "yahboom_joy_R2" &&
      pkill -f "imu_filter_madgwick_node" &&
      pkill -f "ydlidar_ros2_driver_node"
    `], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    process.on('error', (error: Error) => {
      console.error('Failed to stop mapping process:', error);
    });
    
    // 等待进程结束
    process.on('close', (code: number) => {
      console.log(`Stop mapping process exited with code ${code}`);
      
      // 取消订阅地图话题
      rosbridgeService.unsubscribeTopic('/map');
      rosbridgeService.unsubscribeTopic('/robot_pose_k');
    });
    
    res.json({ message: 'Mapping stopped successfully' });
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

export const deleteMap = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const map = await MapModel.findByPk(id);
    if (!map) {
      return res.status(404).json({ error: 'Map not found' });
    }
    
    // 删除地图文件
    if (map.filePath) {
      try {
        const fs = require('fs');
        if (fs.existsSync(map.filePath)) {
          fs.unlinkSync(map.filePath);
        }
        // 删除pgm文件
        if (fs.existsSync(map.filePath.replace('.yaml', '.pgm'))) {
          fs.unlinkSync(map.filePath.replace('.yaml', '.pgm'));
        }
      } catch (error) {
        console.error('Error deleting map files:', error);
      }
    }
    
    // 删除数据库记录
    await map.destroy();
    
    res.json({ message: 'Map deleted successfully' });
  } catch (error) {
    console.error('Error deleting map:', error);
    res.status(500).json({ error: 'Failed to delete map' });
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
