import { Request, Response } from 'express';
import { MapModel } from '../models';
import rosbridgeService from '../services/rosbridgeService';
import { exec } from 'child_process';
import { promisify } from 'util';
import { io } from '../app';

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
    // 先创建日志文件
    const { spawn, exec } = require('child_process');
    const fs = require('fs');
    
    // 确保日志文件存在
    fs.writeFileSync('/tmp/mapping.log', `Mapping started at ${new Date().toISOString()}\n`);
    
    // 保存建图状态，包含所有节点的PID
    fs.writeFileSync('/tmp/mapping_state.json', JSON.stringify({
      isMapping: true,
      startTime: new Date().toISOString(),
      nodes: {
        chassis: null,
        cartographer: null,
        robot_pose: null,
        laserscan_to_point: null,
        save_map: null
      }
    }));
    
    // 记录启动前的节点
    exec('ps aux | grep -E "ros2|cartographer|ydlidar|joint_state|robot_state" | grep -v grep > /tmp/nodes_before_mapping.log', { shell: true }, (error: any) => {
      if (error) {
        console.error('Error recording nodes before mapping:', error);
      }
    });
    
    const workspacePath = '/home/jetson/yahboomcar_ros2_ws/yahboomcar_ws';
    const setupCommand = `source ${workspacePath}/install/setup.bash && `;
    
    // 0. 首先启动底盘控制节点（确保tf变换和里程计可用）
    console.log('Starting chassis control node...');
    const chassisChild = spawn('bash', ['-c', 
      setupCommand + 'ros2 launch yahboomcar_bringup yahboomcar_bringup_R2_launch.py'
    ], {
      stdio: ['ignore', fs.openSync('/tmp/mapping.log', 'a'), fs.openSync('/tmp/mapping.log', 'a')],
      detached: true
    });
    
    // 记录底盘节点PID
    setTimeout(() => {
      const state = JSON.parse(fs.readFileSync('/tmp/mapping_state.json', 'utf8'));
      state.nodes.chassis = chassisChild.pid;
      fs.writeFileSync('/tmp/mapping_state.json', JSON.stringify(state));
      console.log('Chassis control node started with PID:', chassisChild.pid);
    }, 2000);
    
    // 等待底盘节点完全启动
    setTimeout(() => {
      // 1. 启动Cartographer建图节点（主要节点）
    console.log('Starting Cartographer mapping...');
    const cartographerChild = spawn('bash', ['-c', 
      setupCommand + 'ros2 launch yahboomcar_nav map_cartographer_launch.py'
    ], {
      stdio: ['ignore', fs.openSync('/tmp/mapping.log', 'a'), fs.openSync('/tmp/mapping.log', 'a')],
      detached: true
    });
    
    // 2. 启动机器人位姿发布节点（5秒后启动，确保Cartographer和tf树已初始化）
    setTimeout(() => {
      console.log('Starting robot pose publisher...');
      const robotPoseChild = spawn('bash', ['-c', 
        setupCommand + 'ros2 launch robot_pose_publisher_ros2 robot_pose_publisher_launch.py'
      ], {
        stdio: ['ignore', fs.openSync('/tmp/mapping.log', 'a'), fs.openSync('/tmp/mapping.log', 'a')],
        detached: true
      });
      
      // 更新状态文件
      const state = JSON.parse(fs.readFileSync('/tmp/mapping_state.json', 'utf8'));
      state.nodes.robot_pose = robotPoseChild.pid;
      fs.writeFileSync('/tmp/mapping_state.json', JSON.stringify(state));
      console.log('Robot pose publisher started with PID:', robotPoseChild.pid);
    }, 5000);
    
    // 3. 启动激光数据转点云节点（7秒后启动）
    setTimeout(() => {
      console.log('Starting laserscan to point publisher...');
      const laserscanChild = spawn('bash', ['-c', 
        setupCommand + 'ros2 run laserscan_to_point_pulisher laserscan_to_point_pulisher'
      ], {
        stdio: ['ignore', fs.openSync('/tmp/mapping.log', 'a'), fs.openSync('/tmp/mapping.log', 'a')],
        detached: true
      });
      
      // 更新状态文件
      const state = JSON.parse(fs.readFileSync('/tmp/mapping_state.json', 'utf8'));
      state.nodes.laserscan_to_point = laserscanChild.pid;
      fs.writeFileSync('/tmp/mapping_state.json', JSON.stringify(state));
      console.log('Laserscan to point publisher started with PID:', laserscanChild.pid);
    }, 7000);
    
    // 4. 启动地图保存服务节点（9秒后启动）
    setTimeout(() => {
      console.log('Starting map save service...');
      const saveMapChild = spawn('bash', ['-c', 
        setupCommand + 'ros2 launch yahboom_app_save_map yahboom_app_save_map.launch.py'
      ], {
        stdio: ['ignore', fs.openSync('/tmp/mapping.log', 'a'), fs.openSync('/tmp/mapping.log', 'a')],
        detached: true
      });
      
      // 更新状态文件
      const state = JSON.parse(fs.readFileSync('/tmp/mapping_state.json', 'utf8'));
      state.nodes.save_map = saveMapChild.pid;
      fs.writeFileSync('/tmp/mapping_state.json', JSON.stringify(state));
      console.log('Map save service started with PID:', saveMapChild.pid);
    }, 9000);
    
    // 保存主节点PID到状态文件
    setTimeout(() => {
      const state = JSON.parse(fs.readFileSync('/tmp/mapping_state.json', 'utf8'));
      state.nodes.cartographer = cartographerChild.pid;
      fs.writeFileSync('/tmp/mapping_state.json', JSON.stringify(state));
      console.log('Cartographer mapping started with PID:', cartographerChild.pid);
      
      // 记录所有启动的节点
      fs.writeFileSync('/tmp/mapping_nodes.log', JSON.stringify({
        chassis: {
          pid: chassisChild.pid,
          command: 'ros2 launch yahboomcar_bringup yahboomcar_bringup_R2_launch.py',
          status: 'running'
        },
        cartographer: { 
          pid: cartographerChild.pid, 
          command: 'ros2 launch yahboomcar_nav map_cartographer_launch.py',
          status: 'running'
        },
        robot_pose: { 
          pid: state.nodes.robot_pose, 
          command: 'ros2 launch robot_pose_publisher_ros2 robot_pose_publisher_launch.py',
          status: state.nodes.robot_pose ? 'running' : 'starting'
        },
        laserscan_to_point: { 
          pid: state.nodes.laserscan_to_point, 
          command: 'ros2 run laserscan_to_point_pulisher laserscan_to_point_pulisher',
          status: state.nodes.laserscan_to_point ? 'running' : 'starting'
        },
        save_map: { 
          pid: state.nodes.save_map, 
          command: 'ros2 launch yahboom_app_save_map yahboom_app_save_map.launch.py',
          status: state.nodes.save_map ? 'running' : 'starting'
        }
      }, null, 2));
    }, 10000);
    
    // 初始化机器人位姿为地图原点（延迟11秒，在robot_pose_publisher启动后）
    setTimeout(() => {
      console.log('Initializing robot pose to map origin...');
      exec('bash -c "' + setupCommand + 'ros2 topic pub --once /initialpose geometry_msgs/PoseWithCovarianceStamped \'{header: {frame_id: \"map\"}, pose: {pose: {position: {x: 0.0, y: 0.0, z: 0.0}, orientation: {x: 0.0, y: 0.0, z: 0.0, w: 1.0}}, covariance: [0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.1]}\'"', { shell: true }, (error: any) => {
        if (error) {
          console.error('Error initializing robot pose:', error);
        } else {
          console.log('Robot pose initialized to map origin');
        }
      });
    }, 11000);
    
    // 订阅地图话题,用于实时预览（延迟12秒确保所有节点已启动）
    setTimeout(() => {
      console.log('About to subscribe to map topics...');
      rosbridgeService.subscribeTopic('/map', 'nav_msgs/OccupancyGrid');
      console.log('Subscribe request sent for /map');
      // 机器人位姿话题
      rosbridgeService.subscribeTopic('/robot_pose', 'geometry_msgs/PoseStamped');
      rosbridgeService.subscribeTopic('/odom', 'nav_msgs/Odometry');
      rosbridgeService.subscribeTopic('/amcl_pose', 'geometry_msgs/PoseWithCovarianceStamped');
      // 订阅tf话题获取机器人位置
      rosbridgeService.subscribeTopic('/tf', 'tf2_msgs/TFMessage');
      rosbridgeService.subscribeTopic('/tf_static', 'tf2_msgs/TFMessage');
      // 订阅激光扫描话题
      rosbridgeService.subscribeTopic('/scan', 'sensor_msgs/LaserScan');
      // 订阅点云话题（由laserscan_to_point_pulisher发布）
      rosbridgeService.subscribeTopic('/scan_points', 'sensor_msgs/PointCloud2');
    }, 12000);
    
    res.json({ 
      message: 'Mapping started successfully', 
      pid: cartographerChild.pid,
      nodes: ['chassis', 'cartographer', 'robot_pose', 'laserscan_to_point', 'save_map']
    });
  } catch (error) {
    console.error('Error starting mapping:', error);
    res.status(500).json({ error: 'Failed to start mapping' });
  }
};

export const stopMapping = async (req: Request, res: Response) => {
  try {
    const { spawn, exec } = require('child_process');
    const fs = require('fs');
    
    console.log('Stopping mapping...');
    
    // 获取建图进程PID和所有节点信息
    let mappingState = null;
    try {
      if (fs.existsSync('/tmp/mapping_state.json')) {
        mappingState = JSON.parse(fs.readFileSync('/tmp/mapping_state.json', 'utf8'));
        console.log('Found mapping state:', mappingState);
      }
    } catch (e) {
      console.error('Error reading mapping state:', e);
    }
    
    // 如果有保存地图的请求，先调用保存服务
    const { saveMap } = req.body;
    if (saveMap && mappingState?.nodes?.save_map) {
      console.log('Saving map before stopping...');
      
      // 调用yahboom_app_save_map服务保存地图
      const saveProcess = spawn('bash', ['-c', `
        source /home/jetson/yahboomcar_ros2_ws/yahboomcar_ws/install/setup.bash &&
        timeout 30s ros2 service call /yahboomAppSaveMap yahboom_app_save_map/srv/SaveMap "{map_name: 'map_$(date +%Y%m%d_%H%M%S)'}"
      `], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      // 等待保存完成
      await new Promise((resolve) => {
        saveProcess.on('close', (code: number | null) => {
          console.log('Map save process exited with code:', code);
          resolve(code);
        });
      });
    }
    
    // 检查进程是否存在并优雅停止所有建图节点
    const stopCommands = [];
    
    // 检查进程是否存在的辅助函数
    const checkProcessExists = async (pid: number) => {
      try {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        await execAsync(`ps -p ${pid}`);
        return true;
      } catch (error) {
        return false;
      }
    };
    
    // 0. 停止底盘控制节点（最后停止，确保其他节点优雅退出）
    if (mappingState?.nodes?.chassis) {
      const exists = await checkProcessExists(mappingState.nodes.chassis);
      if (exists) {
        stopCommands.push(`kill -INT ${mappingState.nodes.chassis} 2>/dev/null`);
        console.log(`Stopping chassis process: ${mappingState.nodes.chassis}`);
      } else {
        console.log(`Chassis process ${mappingState.nodes.chassis} not found, skipping`);
      }
    }
    
    // 1. 停止Cartographer建图节点
    if (mappingState?.nodes?.cartographer) {
      const exists = await checkProcessExists(mappingState.nodes.cartographer);
      if (exists) {
        stopCommands.push(`kill -INT ${mappingState.nodes.cartographer} 2>/dev/null`);
        console.log(`Stopping cartographer process: ${mappingState.nodes.cartographer}`);
      } else {
        console.log(`Cartographer process ${mappingState.nodes.cartographer} not found, skipping`);
      }
    }
    stopCommands.push('pkill -f "map_cartographer_launch.py" 2>/dev/null');
    stopCommands.push('pkill -f "cartographer_node" 2>/dev/null');
    stopCommands.push('pkill -f "cartographer_occupancy_grid_node" 2>/dev/null');
    
    // 2. 停止机器人位姿发布节点
    if (mappingState?.nodes?.robot_pose) {
      const exists = await checkProcessExists(mappingState.nodes.robot_pose);
      if (exists) {
        stopCommands.push(`kill -INT ${mappingState.nodes.robot_pose} 2>/dev/null`);
        console.log(`Stopping robot_pose process: ${mappingState.nodes.robot_pose}`);
      } else {
        console.log(`Robot pose process ${mappingState.nodes.robot_pose} not found, skipping`);
      }
    }
    stopCommands.push('pkill -f "robot_pose_publisher" 2>/dev/null');
    
    // 3. 停止激光数据转点云节点
    if (mappingState?.nodes?.laserscan_to_point) {
      const exists = await checkProcessExists(mappingState.nodes.laserscan_to_point);
      if (exists) {
        stopCommands.push(`kill -INT ${mappingState.nodes.laserscan_to_point} 2>/dev/null`);
        console.log(`Stopping laserscan_to_point process: ${mappingState.nodes.laserscan_to_point}`);
      } else {
        console.log(`Laserscan to point process ${mappingState.nodes.laserscan_to_point} not found, skipping`);
      }
    }
    stopCommands.push('pkill -f "laserscan_to_point_pulisher" 2>/dev/null');
    
    // 4. 停止地图保存服务节点（最后停止）
    if (mappingState?.nodes?.save_map) {
      const exists = await checkProcessExists(mappingState.nodes.save_map);
      if (exists) {
        stopCommands.push(`kill -INT ${mappingState.nodes.save_map} 2>/dev/null`);
        console.log(`Stopping save_map process: ${mappingState.nodes.save_map}`);
      } else {
        console.log(`Save map process ${mappingState.nodes.save_map} not found, skipping`);
      }
    }
    stopCommands.push('pkill -f "yahboom_app_save_map" 2>/dev/null');
    
    const stopProcess = spawn('bash', ['-c', `
      source /home/jetson/yahboomcar_ros2_ws/yahboomcar_ws/install/setup.bash &&
      # 优雅停止所有建图相关节点
      ${stopCommands.join(' && ')} &&
      # 等待节点停止
      sleep 3 &&
      # 强制杀死残留进程
      pkill -9 -f "map_cartographer_launch.py" 2>/dev/null &&
      pkill -9 -f "cartographer_node" 2>/dev/null &&
      pkill -9 -f "robot_pose_publisher" 2>/dev/null &&
      pkill -9 -f "laserscan_to_point_pulisher" 2>/dev/null &&
      pkill -9 -f "yahboom_app_save_map" 2>/dev/null
    `], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    

    // 记录输出
    stopProcess.stdout?.on('data', (data: Buffer) => {
      console.log('Stop mapping stdout:', data.toString());
    });
    
    stopProcess.stderr?.on('data', (data: Buffer) => {
      console.log('Stop mapping stderr:', data.toString());
    });
    
    stopProcess.on('error', (error: Error) => {
      console.error('Failed to stop mapping process:', error);
    });
    
    // 等待进程结束
    stopProcess.on('close', async (code: number) => {
      console.log(`Stop mapping process exited with code ${code}`);
      
      // 取消订阅所有地图相关话题
      rosbridgeService.unsubscribeTopic('/map');
      rosbridgeService.unsubscribeTopic('/robot_pose');
      rosbridgeService.unsubscribeTopic('/odom');
      rosbridgeService.unsubscribeTopic('/amcl_pose');
      rosbridgeService.unsubscribeTopic('/tf');
      rosbridgeService.unsubscribeTopic('/tf_static');
      rosbridgeService.unsubscribeTopic('/scan');
      rosbridgeService.unsubscribeTopic('/scan_points');
      
      // 记录停止后的节点状态
      exec('ps aux | grep -E "ros2|cartographer|ydlidar|joint_state|robot_state|robot_pose|laserscan_to_point|yahboom_app_save_map" | grep -v grep > /tmp/nodes_after_mapping.log', { shell: true }, (error: any) => {
        if (error) {
          console.error('Error recording nodes after mapping:', error);
        }
      });
      
      // 强制清理建图状态（无论进程是否成功停止）
      try {
        if (fs.existsSync('/tmp/mapping_state.json')) {
          console.log('Cleaning up mapping state file...');
          fs.unlinkSync('/tmp/mapping_state.json');
          console.log('Mapping state file removed');
        }
      } catch (error) {
        console.error('Error cleaning up mapping state:', error);
      }
      
      // 清理建图状态

      if (fs.existsSync('/tmp/mapping_state.json')) {

        fs.unlinkSync('/tmp/mapping_state.json');

      }

    });

    

    res.json({ message: 'Mapping stopped successfully' });

  } catch (error) {

    console.error('Error stopping mapping:', error);

    res.status(500).json({ error: 'Failed to stop mapping' });

  }

};

export const getMappingStatus = async (req: Request, res: Response) => {
  try {
    const fs = require('fs');
    if (fs.existsSync('/tmp/mapping_state.json')) {
      const state = JSON.parse(fs.readFileSync('/tmp/mapping_state.json', 'utf8'));
      res.json(state);
    } else {
      res.json({ isMapping: false });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to get mapping status' });
  }
};

export const getMappingStatusLocal = async (req: Request, res: Response) => {
  try {
    const fs = require('fs');
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    if (fs.existsSync('/tmp/mapping_state.json')) {
      const state = JSON.parse(fs.readFileSync('/tmp/mapping_state.json', 'utf8'));
      
      // 检查主要进程是否还在运行
      let isRunning = false;
      if (state.nodes) {
        // 检查Cartographer节点（主要节点）
        if (state.nodes.cartographer) {
          try {
            await execAsync(`ps -p ${state.nodes.cartographer}`);
            isRunning = true;
          } catch (error) {
            console.log(`Cartographer process ${state.nodes.cartographer} not found`);
          }
        }
        
        // 如果Cartographer不在，检查底盘节点
        if (!isRunning && state.nodes.chassis) {
          try {
            await execAsync(`ps -p ${state.nodes.chassis}`);
            isRunning = true;
          } catch (error) {
            console.log(`Chassis process ${state.nodes.chassis} not found`);
          }
        }
      }
      
      if (isRunning) {
        res.json({ isMapping: true, ...state });
      } else {
        // 进程不存在，更新状态文件
        console.log('Mapping processes not found, updating status');
        const newState = { isMapping: false };
        fs.writeFileSync('/tmp/mapping_state.json', JSON.stringify(newState));
        res.json(newState);
      }
    } else {
      res.json({ isMapping: false });
    }
  } catch (error) {
    console.error('Error in getMappingStatusLocal:', error);
    res.status(500).json({ error: 'Failed to get mapping status' });
  }
};

export const forceStopMapping = async (req: Request, res: Response) => {
  try {
    const fs = require('fs');
    const { exec } = require('child_process');
    
    console.log('Force stopping mapping...');
    
    // 直接删除状态文件
    if (fs.existsSync('/tmp/mapping_state.json')) {
      fs.unlinkSync('/tmp/mapping_state.json');
      console.log('Mapping state file force removed');
    }
    
    // 强制杀死所有可能的建图进程
    exec('pkill -9 -f "map_cartographer_launch.py" 2>/dev/null', { shell: true });
    exec('pkill -9 -f "cartographer_node" 2>/dev/null', { shell: true });
    exec('pkill -9 -f "robot_pose_publisher" 2>/dev/null', { shell: true });
    exec('pkill -9 -f "laserscan_to_point_pulisher" 2>/dev/null', { shell: true });
    exec('pkill -9 -f "yahboom_app_save_map" 2>/dev/null', { shell: true });
    
    // 取消订阅所有话题
    rosbridgeService.unsubscribeTopic('/map');
    
    rosbridgeService.unsubscribeTopic('/robot_pose');
    rosbridgeService.unsubscribeTopic('/odom');
    rosbridgeService.unsubscribeTopic('/amcl_pose');
    rosbridgeService.unsubscribeTopic('/tf');
    rosbridgeService.unsubscribeTopic('/tf_static');
    rosbridgeService.unsubscribeTopic('/scan');
    rosbridgeService.unsubscribeTopic('/scan_points');
    
    res.json({ message: 'Mapping force stopped successfully' });
  } catch (error) {
    console.error('Error force stopping mapping:', error);
    res.status(500).json({ error: 'Failed to force stop mapping' });
  }
};

export const startMappingLocal = async (req: Request, res: Response) => {
  try {
    const fs = require('fs');
    
    // 检查是否已经在建图
    if (fs.existsSync('/tmp/mapping_state.json')) {
      const state = JSON.parse(fs.readFileSync('/tmp/mapping_state.json', 'utf8'));
      if (state.isMapping) {
        return res.json({ message: 'Mapping already in progress' });
      }
    }
    
    // 保存建图状态
    fs.writeFileSync('/tmp/mapping_state.json', JSON.stringify({
      isMapping: true,
      startTime: new Date().toISOString(),
      pid: null
    }));
    
    // 订阅地图话题,用于实时预览
    setTimeout(() => {
      console.log('About to subscribe to map topics...');
      rosbridgeService.subscribeTopic('/map', 'nav_msgs/OccupancyGrid');
      console.log('Subscribe request sent for /map');
      // 尝试多个机器人位姿话题
      
      rosbridgeService.subscribeTopic('/robot_pose', 'geometry_msgs/PoseStamped');
      rosbridgeService.subscribeTopic('/odom', 'nav_msgs/Odometry');
      rosbridgeService.subscribeTopic('/amcl_pose', 'geometry_msgs/PoseWithCovarianceStamped');
      // 订阅tf话题获取机器人位置
      rosbridgeService.subscribeTopic('/tf', 'tf2_msgs/TFMessage');
      rosbridgeService.subscribeTopic('/tf_static', 'tf2_msgs/TFMessage');
    }, 2000);
    
    res.json({ message: 'Mapping started successfully' });
  } catch (error) {
    console.error('Error starting mapping:', error);
    res.status(500).json({ error: 'Failed to start mapping' });
  }
};

export const stopMappingLocal = async (req: Request, res: Response) => {
  try {
    const fs = require('fs');
    
    // 更新状态文件
    fs.writeFileSync('/tmp/mapping_state.json', JSON.stringify({
      isMapping: false
    }));
    
    // 取消订阅
    rosbridgeService.unsubscribeTopic('/map');
    rosbridgeService.unsubscribeTopic('/robot_pose');
    rosbridgeService.unsubscribeTopic('/odom');
    rosbridgeService.unsubscribeTopic('/amcl_pose');
    rosbridgeService.unsubscribeTopic('/tf');
    rosbridgeService.unsubscribeTopic('/tf_static');
    
    res.json({ message: 'Mapping stopped successfully' });
  } catch (error) {
    console.error('Error stopping mapping:', error);
    res.status(500).json({ error: 'Failed to stop mapping' });
  }
};

export const saveMapLocal = async (req: Request, res: Response) => {
  try {
    const { name, description } = req.body;
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    const fs = require('fs').promises;
    
    // 创建地图文件路径
    const timestamp = Date.now();
    const mapDir = '/home/jetson/yahboomcar_ros2_ws/yahboomcar_ws/maps';
    const mapPath = `${mapDir}/${name}_${timestamp}`;
    
    // 确保目录存在
    await execAsync(`mkdir -p ${mapDir}`);
    
    // 使用ROS2环境保存地图
    const saveCommand = `
      source /home/jetson/yahboomcar_ros2_ws/yahboomcar_ws/install/setup.bash &&
      ros2 run nav2_map_server map_saver_cli -f ${mapPath}
    `;
    
    console.log('Saving map with command:', saveCommand);
    
    try {
      const { stdout, stderr } = await execAsync(saveCommand, { 
        shell: true,
        env: {
          ...process.env,
          ROS_DOMAIN_ID: '77'
        }
      });
      console.log('Map save output:', stdout);
      if (stderr) console.log('Map save stderr:', stderr);
    } catch (e: any) {
      console.error('Error saving map:', e);
      // 创建占位符文件
      await fs.writeFile(`${mapPath}.yaml`, `image: ${mapPath}.png\nresolution: 0.05\norigin: [0.0, 0.0, 0.0]\nnegate: 0\noccupied_thresh: 0.65\nfree_thresh: 0.196\n`);
      await fs.writeFile(`${mapPath}.png`, '');
      console.log('Created placeholder map files');
    }
    
    // 读取实际地图信息
    let mapInfo = {
      resolution: 0.05,
      width: 1000,
      height: 1000,
      origin: { x: 0, y: 0, z: 0 }
    };
    
    try {
      const yamlContent = await fs.readFile(`${mapPath}.yaml`, 'utf8');
      const lines = yamlContent.split('\n');
      lines.forEach((line: string) => {
        if (line.startsWith('resolution:')) {
          mapInfo.resolution = parseFloat(line.split(':')[1]);
        } else if (line.startsWith('origin:')) {
          const originStr = line.split(':')[1].trim();
          mapInfo.origin = JSON.parse(originStr.replace(/'/g, '"'));
        }
      });
    } catch (e) {
      console.log('Could not read map info, using defaults');
    }
    
    // 创建地图记录（不需要数据库）
    const mapRecord = {
      id: timestamp,
      name,
      description,
      filePath: `${mapPath}.yaml`,
      resolution: mapInfo.resolution,
      width: mapInfo.width,
      height: mapInfo.height,
      origin: mapInfo.origin,
      isActive: false,
      createdAt: new Date().toISOString()
    };
    
    res.status(201).json(mapRecord);
  } catch (error) {
    console.error('Error saving map:', error);
    res.status(500).json({ error: 'Failed to save map' });
  }
};

export const scanLocalMaps = async (req: Request, res: Response) => {
  try {
    const fs = require('fs');
    const path = require('path');
    
    const mapsDir = '/home/jetson/yahboomcar_ros2_ws/yahboomcar_ws/src/yahboomcar_nav/maps';
    const maps = [];
    
    if (fs.existsSync(mapsDir)) {
      const files = fs.readdirSync(mapsDir);
      const yamlFiles = files.filter(file => file.endsWith('.yaml'));
      
      for (const yamlFile of yamlFiles) {
        const yamlPath = path.join(mapsDir, yamlFile);
        const yamlContent = fs.readFileSync(yamlPath, 'utf8');
        
        // 解析YAML文件
        const lines = yamlContent.split('\n');
        let mapInfo: any = {
          name: path.basename(yamlFile, '.yaml'),
          yamlPath: yamlPath,
          pgmPath: '',
          resolution: 0.05,
          origin: { x: 0, y: 0, z: 0 },
          width: 1000,
          height: 1000,
        };
        
        lines.forEach(line => {
          if (line.startsWith('image:')) {
            const imageName = line.split(':')[1].trim();
            mapInfo.pgmPath = path.join(mapsDir, imageName);
          } else if (line.startsWith('resolution:')) {
            mapInfo.resolution = parseFloat(line.split(':')[1]);
          } else if (line.startsWith('origin:')) {
            const originStr = line.split(':')[1].trim();
            mapInfo.origin = JSON.parse(originStr.replace(/'/g, '"'));
          }
        });
        
        // 检查PGM文件是否存在
        if (fs.existsSync(mapInfo.pgmPath)) {
          // 尝试读取PGM文件头获取尺寸
          try {
            const pgmContent = fs.readFileSync(mapInfo.pgmPath, 'utf8');
            const pgmLines = pgmContent.split('\n');
            if (pgmLines[0] === 'P2' && pgmLines[1]) {
              const dimensions = pgmLines[1].split(' ');
              mapInfo.width = parseInt(dimensions[0]);
              mapInfo.height = parseInt(dimensions[1]);
            }
          } catch (e) {
            console.log(`Could not read PGM dimensions for ${mapInfo.name}`);
          }
          
          maps.push(mapInfo);
        }
      }
    }
    
    res.json(maps);
  } catch (error) {
    console.error('Error scanning local maps:', error);
    res.status(500).json({ error: 'Failed to scan local maps' });
  }
};

export const loadMapToDatabase = async (req: Request, res: Response) => {
  try {
    const { yamlPath, pgmPath, name, description } = req.body;
    
    // 读取地图信息
    const fs = require('fs');
    const yamlContent = fs.readFileSync(yamlPath, 'utf8');
    const lines = yamlContent.split('\n');
    
    let mapInfo: any = {
      name: name,
      description: description || '',
      yamlPath: yamlPath,
      pgmPath: pgmPath,
      resolution: 0.05,
      origin: { x: 0, y: 0, z: 0 },
      width: 1000,
      height: 1000,
    };
    
    lines.forEach(line => {
      if (line.startsWith('resolution:')) {
        mapInfo.resolution = parseFloat(line.split(':')[1]);
      } else if (line.startsWith('origin:')) {
        const originStr = line.split(':')[1].trim();
        mapInfo.origin = JSON.parse(originStr.replace(/'/g, '"'));
      }
    });
    
    // 读取PGM文件头获取尺寸
    try {
      const pgmContent = fs.readFileSync(pgmPath, 'utf8');
      const pgmLines = pgmContent.split('\n');
      if (pgmLines[0] === 'P2' && pgmLines[1]) {
        const dimensions = pgmLines[1].split(' ');
        mapInfo.width = parseInt(dimensions[0]);
        mapInfo.height = parseInt(dimensions[1]);
      }
    } catch (e) {
      console.log(`Could not read PGM dimensions for ${mapInfo.name}`);
    }
    
    // 创建地图记录
    const map = await MapModel.create(mapInfo);
    res.status(201).json(map);
  } catch (error) {
    console.error('Error loading map to database:', error);
    res.status(500).json({ error: 'Failed to load map to database' });
  }
};

export const getMapImage = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const map = await MapModel.findByPk(id);
    
    if (!map) {
      return res.status(404).json({ error: 'Map not found' });
    }
    
    const fs = require('fs');
    const path = require('path');
    
    // 读取PGM文件并转换为PNG
    const sharp = require('sharp');
    const pgmBuffer = fs.readFileSync(map.pgmPath);
    
    // 使用Sharp转换PGM到PNG
    const pngBuffer = await sharp(pgmBuffer, { raw: { width: map.width, height: map.height, channels: 1 } })
      .png()
      .toBuffer();
    
    res.set('Content-Type', 'image/png');
    res.send(pngBuffer);
  } catch (error) {
    console.error('Error getting map image:', error);
    res.status(500).json({ error: 'Failed to get map image' });
  }
};

export const saveMap = async (req: Request, res: Response) => {
  try {
    const { name, description } = req.body;
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    const fs = require('fs').promises;
    
    // 创建地图文件路径（使用原厂默认路径）
    const mapDir = '/home/jetson/yahboomcar_ros2_ws/yahboomcar_ws/src/yahboomcar_nav/maps';
    const mapPath = `${mapDir}/${name}`;
    
    // 确保目录存在
    await execAsync(`mkdir -p ${mapDir}`);
    
// 使用ROS2环境保存地图（参考原厂save_map_launch.py）
    const saveScript = `
#!/bin/bash
. /home/jetson/yahboomcar_ros2_ws/yahboomcar_ws/install/setup.bash
export ROS_DOMAIN_ID=77

# 等待一下确保环境加载
sleep 1

# 检查地图话题是否存在
if ros2 topic info /map >/dev/null 2>&1; then
    echo "Map topic found, saving map..."
    # 使用原厂launch文件的参数，保存为PGM格式
    timeout 15 ros2 run nav2_map_server map_saver_cli -f ${mapPath} \\
        --ros-args \\
        -p save_map_timeout:=10000.0 \\
        -p map_saver.mode:=trinary \\
        -p map_saver.resolution:=0.05 \\
        -p map_saver.origin:=[-10, -10, 0] \\
        -p map_saver.negate:=0 \\
        -p map_saver.occupied_thresh:=0.65 \\
        -p map_saver.free_thresh:=0.196 \\
        -p map_saver.free_thresh_default:=0.196
    echo "Map saved to ${mapPath}"
else
    echo "Map topic not found, checking if Cartographer is running..."
    # 尝试启动Cartographer并保存地图
    if pgrep -f "cartographer" >/dev/null; then
        echo "Cartographer is running, waiting for map topic..."
        # 等待地图话题出现
        for i in {1..10}; do
            if ros2 topic info /map >/dev/null 2>&1; then
                echo "Map topic appeared, saving map..."
                ros2 run nav2_map_server map_saver_cli -f ${mapPath} \\
                    --ros-args \\
                    -p save_map_timeout:=10000.0 \\
                    -p map_saver.mode:=trinary \\
                    -p map_saver.resolution:=0.05 \\
                    -p map_saver.origin:=[-10, -10, 0] \\
                    -p map_saver.negate:=0 \\
                    -p map_saver.occupied_thresh:=0.65 \\
                    -p map_saver.free_thresh:=0.25
                echo "Map saved to ${mapPath}"
                exit 0
            fi
            sleep 2
        done
    fi
    
    echo "No map data available, creating placeholder files"
    # 创建占位符文件
    cat > ${mapPath}.yaml << EOF
image: ${mapPath}.pgm
resolution: 0.05
origin: [-10.0, -10.0, 0.0]
negate: 0
occupied_thresh: 0.65
free_thresh: 0.25
EOF
    # 创建一个更大的占位符PGM文件（100x100）
    cat > ${mapPath}.pgm << EOF
P2
100 100
255
$(for i in {1..10000}; do echo -n "205 "; done)
EOF
fi
`;
    
    // 直接调用原厂launch文件保存地图
    console.log('Saving map using launch file...');
    
    try {
      // 使用原厂launch文件保存地图
      const saveCmd = `bash -c "
        cd /home/jetson/yahboomcar_ros2_ws &&
        source yahboomcar_ws/install/setup.bash &&
        ros2 launch yahboomcar_nav save_map_launch.py map_name:=${name}
      "`;
      
      const { stdout, stderr } = await execAsync(saveCmd, { 
        shell: true,
        env: { ...process.env, ROS_DOMAIN_ID: '77' }
      });
      console.log('Map save output:', stdout);
      if (stderr) console.log('Map save stderr:', stderr);
    } catch (e: any) {
      console.error('Error saving map:', e);
      console.log('Attempting to save using alternative method...');
      
      // 备选方案：直接调用map_saver_cli
      try {
        const altSaveCmd = `bash -c "
          cd /home/jetson/yahboomcar_ros2_ws &&
          source yahboomcar_ws/install/setup.bash &&
          timeout 10 ros2 run nav2_map_server map_saver_cli -f ${mapPath}
        "`;
        
        const { stdout: altOut, stderr: altErr } = await execAsync(altSaveCmd, { 
          shell: true,
          env: { ...process.env, ROS_DOMAIN_ID: '77' }
        });
        console.log('Alternative save output:', altOut);
        if (altErr) console.log('Alternative save stderr:', altErr);
      } catch (altError: any) {
        console.error('Alternative save also failed:', altError);
        // 创建占位符文件（使用原厂格式）
        await fs.writeFile(`${mapPath}.yaml`, `image: ${mapPath}.pgm\nmode: trinary\nresolution: 0.05\norigin: [-10, -10, 0]\nnegate: 0\noccupied_thresh: 0.65\nfree_thresh: 0.25\n`);
        await fs.writeFile(`${mapPath}.pgm`, 'P2\n1 1\n255\n255\n');
        console.log('Created placeholder map files');
      }
    }
    
    // 读取实际地图信息
    let mapInfo = {
      resolution: 0.05,
      width: 1000,
      height: 1000,
      origin: { x: 0, y: 0, z: 0 }
    };
    
    try {
      const yamlContent = await fs.readFile(`${mapPath}.yaml`, 'utf8');
      const lines = yamlContent.split('\n');
      lines.forEach((line: string) => {
        if (line.startsWith('resolution:')) {
          mapInfo.resolution = parseFloat(line.split(':')[1]);
        } else if (line.startsWith('origin:')) {
          const originStr = line.split(':')[1].trim();
          mapInfo.origin = JSON.parse(originStr.replace(/'/g, '"'));
        }
      });
    } catch (e) {
      console.log('Could not read map info, using defaults');
    }
    
    const map = await MapModel.create({
      name,
      description,
      filePath: `${mapPath}.yaml`,
      resolution: mapInfo.resolution,
      width: mapInfo.width,
      height: mapInfo.height,
      origin: mapInfo.origin,
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
    
    // 读取地图文件
    const fs = require('fs');
    const path = require('path');
    
    const yamlPath = map.filePath;
    const pgmPath = yamlPath.replace('.yaml', '.pgm');
    
    // 读取YAML配置
    const yamlContent = fs.readFileSync(yamlPath, 'utf8');
    const lines = yamlContent.split('\n');
    
    let mapInfo: any = {
      width: 100,
      height: 100,
      resolution: 0.05,
      origin: { x: -10, y: -10, z: 0 }
    };
    
    lines.forEach((line: string) => {
      if (line.startsWith('resolution:')) {
        mapInfo.resolution = parseFloat(line.split(':')[1]);
      } else if (line.startsWith('origin:')) {
        const originStr = line.split(':')[1].trim();
        mapInfo.origin = JSON.parse(originStr.replace(/'/g, '"'));
      }
    });
    
    // 读取PGM文件
    const pgmContent = fs.readFileSync(pgmPath, 'utf8');
    const pgmLines = pgmContent.split('\n');
    
    // 解析PGM头部
    let lineIndex = 0;
    while (pgmLines[lineIndex].startsWith('#')) {
      lineIndex++;
    }
    
    const dimensions = pgmLines[lineIndex].split(' ');
    mapInfo.width = parseInt(dimensions[0]);
    mapInfo.height = parseInt(dimensions[1]);
    lineIndex++;
    
    const maxVal = parseInt(pgmLines[lineIndex]);
    lineIndex++;
    
    // 读取像素数据
    const pixelData: number[] = [];
    for (let i = lineIndex; i < pgmLines.length; i++) {
      const values = pgmLines[i].trim().split(/\s+/);
      values.forEach((val: string) => {
        if (val) {
          pixelData.push(parseInt(val));
        }
      });
    }
    
    // 转换为ROS2 OccupancyGrid格式
    const mapData = {
      header: {
        stamp: { sec: 0, nanosec: 0 },
        frame_id: 'map'
      },
      info: {
        map_load_time: { sec: 0, nanosec: 0 },
        resolution: mapInfo.resolution,
        width: mapInfo.width,
        height: mapInfo.height,
        origin: {
          position: mapInfo.origin,
          orientation: { x: 0, y: 0, z: 0, w: 1 }
        }
      },
      data: pixelData.map((val: number) => {
        if (val === 205) return -1; // 未知
        if (val === 255) return 0;  // 空闲
        if (val === 0) return 100;  // 占用
        // 转换灰度值到占用概率
        return Math.round(100 * (255 - val) / 255);
      })
    };
    
    // 发送地图数据到前端
    io.emit('map_data', mapData);
    
    res.json({ message: 'Map loaded', map, mapData });
  } catch (error) {
    console.error('Error loading map:', error);
    res.status(500).json({ error: 'Failed to load map' });
  }
};
