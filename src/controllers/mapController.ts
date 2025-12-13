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
    const { spawn } = require('child_process');
    const fs = require('fs');
    
    // 确保日志文件存在
    fs.writeFileSync('/tmp/mapping.log', `Mapping started at ${new Date().toISOString()}\n`);
    
    // 保存建图状态
    fs.writeFileSync('/tmp/mapping_state.json', JSON.stringify({
      isMapping: true,
      startTime: new Date().toISOString(),
      pid: null
    }));
    
    // 记录启动前的节点
    const { exec } = require('child_process');
    exec('ps aux | grep -E "ros2|cartographer|ydlidar|joint_state|robot_state" | grep -v grep > /tmp/nodes_before_mapping.log', { shell: true }, (error: any) => {
      if (error) {
        console.error('Error recording nodes before mapping:', error);
      }
    });
    
    // 使用更简单的方式启动建图
    const child = spawn('bash', ['-c', 
      'source /home/jetson/yahboomcar_ros2_ws/yahboomcar_ws/install/setup.bash && ' +
      'ros2 launch yahboomcar_nav map_cartographer_launch.py'
    ], {
      stdio: ['ignore', fs.openSync('/tmp/mapping.log', 'a'), fs.openSync('/tmp/mapping.log', 'a')],
      detached: true
    });
    
    console.log('Mapping process started with PID:', child.pid);
    
    // 保存PID到状态文件
    setTimeout(() => {
      const state = JSON.parse(fs.readFileSync('/tmp/mapping_state.json', 'utf8'));
      state.pid = child.pid;
      fs.writeFileSync('/tmp/mapping_state.json', JSON.stringify(state));
    }, 1000);
    
    // 订阅地图话题,用于实时预览
    setTimeout(() => {
      console.log('About to subscribe to map topics...');
      rosbridgeService.subscribeTopic('/map', 'nav_msgs/OccupancyGrid');
      console.log('Subscribe request sent for /map');
      // 尝试多个机器人位姿话题
      rosbridgeService.subscribeTopic('/robot_pose_k', 'cartographer_ros_msgs/RobotPose');
      rosbridgeService.subscribeTopic('/robot_pose', 'geometry_msgs/PoseStamped');
      rosbridgeService.subscribeTopic('/odom', 'nav_msgs/Odometry');
      rosbridgeService.subscribeTopic('/amcl_pose', 'geometry_msgs/PoseWithCovarianceStamped');
      // 订阅tf话题获取机器人位置
      rosbridgeService.subscribeTopic('/tf', 'tf2_msgs/TFMessage');
      rosbridgeService.subscribeTopic('/tf_static', 'tf2_msgs/TFMessage');
    }, 5000);
    
    res.json({ message: 'Mapping started successfully', pid: child.pid });
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

    

    // 获取建图进程PID

    let mappingPid = null;

    try {

      if (fs.existsSync('/tmp/mapping_state.json')) {

        const state = JSON.parse(fs.readFileSync('/tmp/mapping_state.json', 'utf8'));

        mappingPid = state.pid;

        console.log('Found mapping PID:', mappingPid);

      }

    } catch (e) {

      console.error('Error reading mapping state:', e);

    }

    

    // 优雅停止

    const stopProcess = spawn('bash', ['-c', `

      source /home/jetson/yahboomcar_ros2_ws/yahboomcar_ws/install/setup.bash && 

      # 如果有PID，先尝试优雅停止

      ${mappingPid ? `kill -INT ${mappingPid} 2>/dev/null && sleep 1 &&` : ''}

      # 停止所有建图相关进程

      pkill -f "map_cartographer_launch.py" &&

      pkill -f "cartographer_node" &&

      pkill -f "cartographer_occupancy_grid_node" &&

      pkill -f "ydlidar_ros2_driver_node" &&

      pkill -f "driver_node" &&

      pkill -f "imu_filter_madgwick" &&

      pkill -f "joint_state_publisher" &&

      pkill -f "robot_state_publisher" &&

      pkill -f "yahboom_joy_R2" &&

      pkill -f "joy_ctrl" &&

      pkill -f "joy_node" &&

      pkill -f "launch_ros_" &&

      # 等待一下

      sleep 2 &&

      # 强制杀死残留进程

      pkill -9 -f "cartographer" &&

      pkill -9 -f "ydlidar" &&

      pkill -9 -f "driver_node" &&

      pkill -9 -f "imu_filter_madgwick" &&

      pkill -9 -f "joint_state_publisher" &&

      pkill -9 -f "robot_state_publisher" &&

      pkill -9 -f "launch_ros_"

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

    stopProcess.on('close', (code: number) => {

      console.log(`Stop mapping process exited with code ${code}`);

      

      // 取消订阅地图话题

      rosbridgeService.unsubscribeTopic('/map');

      rosbridgeService.unsubscribeTopic('/robot_pose_k');

      rosbridgeService.unsubscribeTopic('/robot_pose');

      rosbridgeService.unsubscribeTopic('/odom');

      rosbridgeService.unsubscribeTopic('/amcl_pose');

      rosbridgeService.unsubscribeTopic('/tf');

      rosbridgeService.unsubscribeTopic('/tf_static');

      

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
      // 检查进程是否还在运行
      if (state.pid) {
        try {
          await execAsync(`ps -p ${state.pid}`);
          // 进程存在
          res.json(state);
        } catch (error) {
          // 进程不存在，更新状态文件
          console.log(`Mapping process ${state.pid} not found, updating status`);
          const newState = { isMapping: false };
          fs.writeFileSync('/tmp/mapping_state.json', JSON.stringify(newState));
          res.json(newState);
        }
      } else {
        res.json(state);
      }
    } else {
      res.json({ isMapping: false });
    }
  } catch (error) {
    console.error('Error in getMappingStatusLocal:', error);
    res.status(500).json({ error: 'Failed to get mapping status' });
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
      rosbridgeService.subscribeTopic('/robot_pose_k', 'cartographer_ros_msgs/RobotPose');
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
    rosbridgeService.unsubscribeTopic('/robot_pose_k');
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

export const saveMap = async (req: Request, res: Response) => {
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
    
    // 直接调用命令保存地图
    console.log('Saving map directly...');
    
    try {
      // 检查地图话题是否存在
      const checkCmd = `source /home/jetson/yahboomcar_ros2_ws/yahboomcar_ws/install/setup.bash && ros2 topic info /map`;
      const { stdout: checkOut } = await execAsync(checkCmd, { 
        shell: true,
        env: { ...process.env, ROS_DOMAIN_ID: '77' }
      });
      
      if (checkOut.includes('Type: nav_msgs/msg/OccupancyGrid')) {
        console.log('Map topic found, saving...');
        // 保存地图
        const saveCmd = `
          source /home/jetson/yahboomcar_ros2_ws/yahboomcar_ws/install/setup.bash &&
          ros2 run nav2_map_server map_saver_cli -f ${mapPath}
        `;
        
        const { stdout, stderr } = await execAsync(saveCmd, { 
          shell: true,
          env: { ...process.env, ROS_DOMAIN_ID: '77' }
        });
        console.log('Map save output:', stdout);
        if (stderr) console.log('Map save stderr:', stderr);
      } else {
        throw new Error('Map topic not found');
      }
    } catch (e: any) {
      console.error('Error saving map:', e);
      // 创建占位符文件
      await fs.writeFile(`${mapPath}.yaml`, `image: ${mapPath}.pgm\nresolution: 0.05\norigin: [0.0, 0.0, 0.0]\nnegate: 0\noccupied_thresh: 0.65\nfree_thresh: 0.196\n`);
      await fs.writeFile(`${mapPath}.pgm`, 'P2\n1 1\n255\n255\n');
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
