import { Request, Response } from 'express';

export const getMaps = async (req: Request, res: Response) => {
  try {
    res.json([]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch maps' });
  }
};

export const getActiveMap = async (req: Request, res: Response) => {
  try {
    res.json(null);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch active map' });
  }
};

export const setActiveMap = async (req: Request, res: Response) => {
  try {
    res.json({ message: 'Active map set' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to set active map' });
  }
};

export const startMapping = async (req: Request, res: Response) => {
  try {
    res.json({ message: 'Mapping started' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start mapping' });
  }
};

export const stopMapping = async (req: Request, res: Response) => {
  try {
    res.json({ message: 'Mapping stopped' });
  } catch (error) {
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

export const getMapImage = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const fs = require('fs');
    const path = require('path');
    
    // 查找地图信息
    const mapsDir = '/home/jetson/yahboomcar_ros2_ws/yahboomcar_ws/src/yahboomcar_nav/maps';
    const yamlPath = path.join(mapsDir, `${id}.yaml`);
    
    if (!fs.existsSync(yamlPath)) {
      return res.status(404).json({ error: 'Map not found' });
    }
    
    // 读取YAML文件获取PGM路径
    const yamlContent = fs.readFileSync(yamlPath, 'utf8');
    const lines = yamlContent.split('\n');
    let pgmPath = '';
    let mapInfo = {
      resolution: 0.05,
      width: 1000,
      height: 1000,
      origin: { x: 0, y: 0, z: 0 }
    };
    
    lines.forEach((line: string) => {
      if (line.startsWith('image:')) {
        const imageName = line.split(':')[1].trim();
        pgmPath = path.join(mapsDir, imageName);
      } else if (line.startsWith('resolution:')) {
        mapInfo.resolution = parseFloat(line.split(':')[1]);
      } else if (line.startsWith('origin:')) {
        const originStr = line.split(':')[1].trim();
        mapInfo.origin = JSON.parse(originStr.replace(/'/g, '"'));
      }
    });
    
    if (!fs.existsSync(pgmPath)) {
      return res.status(404).json({ error: 'PGM file not found' });
    }
    
    // 尝试读取PGM文件头获取尺寸
    let pgmType = '';
    try {
      const pgmContent = fs.readFileSync(pgmPath, 'utf8');
      const pgmLines = pgmContent.split('\n');
      if (pgmLines[0] && (pgmLines[0] === 'P2' || pgmLines[0] === 'P5')) {
        pgmType = pgmLines[0];
        if (pgmLines[1]) {
          const dimensions = pgmLines[1].split(' ');
          mapInfo.width = parseInt(dimensions[0]);
          mapInfo.height = parseInt(dimensions[1]);
        }
      }
    } catch (e) {
      console.log(`Could not read PGM dimensions for ${id}`);
    }
    
    // 获取PGM文件的实际大小
    const pgmStats = fs.statSync(pgmPath);
    console.log(`PGM file size: ${pgmStats.size}, type: ${pgmType}, dimensions: ${mapInfo.width}x${mapInfo.height}`);
    
    // 转换PGM到PNG
    const sharp = require('sharp');
    const pgmBuffer = fs.readFileSync(pgmPath);
    
    // 计算二进制PGM数据的起始位置
    let dataOffset = 0;
    if (pgmType === 'P5') {
      // P5格式：跳过头部信息
      const headerText = pgmBuffer.toString('ascii', 0, Math.min(100, pgmBuffer.length));
      const headerLines = headerText.split('\n');
      let offset = 0;
      for (const line of headerLines) {
        if (line.startsWith('#')) continue; // 跳过注释
        offset += Buffer.byteLength(line + '\n', 'ascii');
        if (line.match(/^\d+ \d+$/)) break; // 找到尺寸行
        if (line.match(/^\d+$/)) break; // 找到最大值行
      }
      dataOffset = offset;
    }
    
    // 使用Sharp转换PGM到PNG
    const pngBuffer = await sharp(pgmBuffer.slice(dataOffset), { 
      raw: { 
        width: mapInfo.width, 
        height: mapInfo.height, 
        channels: 1 
      } 
    })
    .png()
    .toBuffer();
    
    res.set('Content-Type', 'image/png');
    res.send(pngBuffer);
  } catch (error) {
    console.error('Error getting map image:', error);
    res.status(500).json({ error: 'Failed to get map image' });
  }
};

export const getMappingStatusLocal = async (req: Request, res: Response) => {
  try {
    const { exec } = require('child_process');
    const fs = require('fs');
    
    // 检查建图进程是否实际在运行
    exec('pgrep -f "map_cartographer_launch.py"', { shell: true }, (error: any, stdout: string) => {
      let isProcessRunning = !error && stdout.trim().length > 0;
      
      // 读取状态文件
      if (fs.existsSync('/tmp/mapping_state.json')) {
        try {
          const state = JSON.parse(fs.readFileSync('/tmp/mapping_state.json', 'utf8'));
          
          // 如果进程不在运行但状态文件显示在建图，更新状态
          if (state.isMapping && !isProcessRunning) {
            console.log('Mapping process stopped but state file still shows mapping, updating...');
            state.isMapping = false;
            fs.writeFileSync('/tmp/mapping_state.json', JSON.stringify(state));
          }
          
          res.json(state);
        } catch (parseError) {
          console.error('Error parsing mapping state:', parseError);
          res.json({ isMapping: false });
        }
      } else {
        // 如果没有状态文件，根据进程状态返回
        res.json({ isMapping: isProcessRunning });
      }
    });
  } catch (error) {
    console.error('Error getting mapping status:', error);
    res.status(500).json({ error: 'Failed to get local mapping status' });
  }
};

export const forceStopMapping = async (req: Request, res: Response) => {
  try {
    res.json({ message: 'Mapping force stopped' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to force stop mapping' });
  }
};

export const startMappingLocal = async (req: Request, res: Response) => {
  try {
    const { spawn, exec } = require('child_process');
    const fs = require('fs');
    
    // 清理所有建图相关进程（包括被建图节点自动启动的节点）
    console.log('Cleaning up old mapping processes...');
    exec('pkill -f "map_cartographer_launch.py" 2>/dev/null', { shell: true });
    exec('pkill -f "robot_pose_publisher" 2>/dev/null', { shell: true });
    exec('pkill -f "laserscan_to_point" 2>/dev/null', { shell: true });
    exec('pkill -f "yahboom_app_save_map" 2>/dev/null', { shell: true });
    exec('pkill -f "yahboomcar_bringup_R2_launch.py" 2>/dev/null', { shell: true });
    exec('pkill -f "Ackman_driver_R2" 2>/dev/null', { shell: true });
    exec('pkill -f "ydlidar_ros2_driver" 2>/dev/null', { shell: true });
    exec('pkill -f "cartographer_node" 2>/dev/null', { shell: true });
    exec('pkill -f "cartographer_occupancy_grid_node" 2>/dev/null', { shell: true });
    exec('pkill -f "joint_state_publisher" 2>/dev/null', { shell: true });
    exec('pkill -f "joy_ctrl" 2>/dev/null', { shell: true });
    exec('pkill -f "joy_node" 2>/dev/null', { shell: true });
    exec('pkill -f "static_transform_publisher" 2>/dev/null', { shell: true });
    
    // 等待进程清理
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // 确保日志文件存在
    fs.writeFileSync('/tmp/mapping.log', `Mapping started at ${new Date().toISOString()}\n`);
    
    // 保存建图状态
    fs.writeFileSync('/tmp/mapping_state.json', JSON.stringify({
      isMapping: true,
      startTime: new Date().toISOString(),
      stage: 'starting'
    }));
    
    const workspacePath = '/home/jetson/yahboomcar_ros2_ws/yahboomcar_ws';
    const setupCommand = `source ${workspacePath}/install/setup.bash && `;
    
    // 1. 启动建图节点（会自动启动底盘、雷达等依赖节点）
    console.log('Stage 1: Starting Cartographer mapping...');
    const cartographerChild = spawn('bash', ['-c', 
      setupCommand + 'ros2 launch yahboomcar_nav map_cartographer_launch.py'
    ], {
      stdio: ['ignore', fs.openSync('/tmp/mapping.log', 'a'), fs.openSync('/tmp/mapping.log', 'a')],
      detached: true,
      env: { ...process.env, ROS_DOMAIN_ID: '77' }
    });
    
    // 等待建图节点启动完成
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // 检查建图节点是否启动成功
    exec('pgrep -f "map_cartographer_launch.py"', { shell: true }, (error: any) => {
      if (error) {
        console.error('Cartographer failed to start');
        fs.writeFileSync('/tmp/mapping_state.json', JSON.stringify({
          isMapping: false,
          error: 'Cartographer failed'
        }));
        return;
      }
      console.log('Cartographer started successfully');
    });
    
    // 2. 启动机器人位置节点
    console.log('Stage 2: Starting robot pose publisher...');
    spawn('bash', ['-c', 
      setupCommand + 'ros2 launch robot_pose_publisher_ros2 robot_pose_publisher_launch.py'
    ], {
      stdio: ['ignore', fs.openSync('/tmp/mapping.log', 'a'), fs.openSync('/tmp/mapping.log', 'a')],
      detached: true
    });
    
    // 等待robot_pose_publisher启动
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // 3. 启动激光数据转点云节点
    console.log('Stage 3: Starting laser scan to point cloud...');
    spawn('bash', ['-c', 
      setupCommand + 'ros2 run laserscan_to_point_pulisher laserscan_to_point_pulisher'
    ], {
      stdio: ['ignore', fs.openSync('/tmp/mapping.log', 'a'), fs.openSync('/tmp/mapping.log', 'a')],
      detached: true
    });
    
    // 等待点云转换器启动
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 4. 启动保存地图服务节点
    console.log('Stage 4: Starting map save service...');
    spawn('bash', ['-c', 
      setupCommand + 'ros2 launch yahboom_app_save_map yahboom_app_save_map.launch.py'
    ], {
      stdio: ['ignore', fs.openSync('/tmp/mapping.log', 'a'), fs.openSync('/tmp/mapping.log', 'a')],
      detached: true
    });
    
    // 等待服务启动
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 更新状态为正常运行
    fs.writeFileSync('/tmp/mapping_state.json', JSON.stringify({
      isMapping: true,
      startTime: new Date().toISOString(),
      stage: 'running'
    }));
    
    // 订阅所有必要的话题
    try {
      const rosbridgeService = require('../services/rosbridgeService').default;
      rosbridgeService.subscribeTopic('/map', 'nav_msgs/OccupancyGrid');
      rosbridgeService.subscribeTopic('/robot_pose', 'geometry_msgs/PoseStamped');
      rosbridgeService.subscribeTopic('/tf', 'tf2_msgs/TFMessage');
      rosbridgeService.subscribeTopic('/point_cloud', 'sensor_msgs/PointCloud2');
      rosbridgeService.subscribeTopic('/scan_points', 'sensor_msgs/PointCloud');
      console.log('Subscribed to all mapping topics');
    } catch (e) {
      console.error('Error subscribing to topics:', e);
    }
    
    // 定期检查建图进程状态
    const checkInterval = setInterval(() => {
      exec('pgrep -f "map_cartographer_launch.py"', { shell: true }, (error: any, stdout: string) => {
        if (error || !stdout.trim()) {
          console.log('Cartographer process stopped, stopping mapping');
          fs.writeFileSync('/tmp/mapping_state.json', JSON.stringify({
            isMapping: false,
            stage: 'stopped'
          }));
          clearInterval(checkInterval);
        }
      });
    }, 5000);
    
    // 最后检查所有节点是否都已启动
    console.log('Verifying all nodes are running...');
    const checkNodes = async () => {
      const nodes = [
        { name: 'cartographer', pattern: 'map_cartographer_launch.py' },
        { name: 'robot_pose_publisher', pattern: 'robot_pose_publisher' },
        { name: 'laserscan_to_point', pattern: 'laserscan_to_point' },
        { name: 'yahboom_app_save_map', pattern: 'yahboom_app_save_map' }
      ];
      
      for (const node of nodes) {
        await new Promise<void>((resolve) => {
          exec(`pgrep -f "${node.pattern}"`, { shell: true }, (error: any) => {
            if (error) {
              console.warn(`Warning: ${node.name} may not be running`);
            } else {
              console.log(`${node.name} is running`);
            }
            resolve();
          });
        });
      }
    };
    
    await checkNodes();
    
    console.log('All mapping services started successfully');
    res.json({ 
      message: 'Local mapping started successfully',
      stages: [
        'cartographer mapping (with auto-started dependencies)',
        'robot pose publisher',
        'laser scan to point cloud',
        'map save service'
      ]
    });
  } catch (error) {
    console.error('Error starting local mapping:', error);
    // 如果启动失败，重置状态
    const fs = require('fs');
    fs.writeFileSync('/tmp/mapping_state.json', JSON.stringify({
      isMapping: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }));
    res.status(500).json({ error: 'Failed to start local mapping' });
  }
};

export const stopMappingLocal = async (req: Request, res: Response) => {
  try {
    const { exec } = require('child_process');
    const fs = require('fs');
    
    console.log('Stopping local mapping...');
    
    // 停止所有建图相关进程（包括被建图节点自动启动的节点）
    console.log('Stopping map save service...');
    exec('pkill -f "yahboom_app_save_map" 2>/dev/null', { shell: true });
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('Stopping laser scan to point cloud...');
    exec('pkill -f "laserscan_to_point" 2>/dev/null', { shell: true });
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('Stopping robot pose publisher...');
    exec('pkill -f "robot_pose_publisher" 2>/dev/null', { shell: true });
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('Stopping cartographer mapping...');
    exec('pkill -f "map_cartographer_launch.py" 2>/dev/null', { shell: true });
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 停止被建图节点自动启动的依赖节点
    console.log('Stopping auto-started dependencies...');
    exec('pkill -f "yahboomcar_bringup_R2_launch.py" 2>/dev/null', { shell: true });
    exec('pkill -f "Ackman_driver_R2" 2>/dev/null', { shell: true });
    exec('pkill -f "ydlidar_ros2_driver" 2>/dev/null', { shell: true });
    exec('pkill -f "cartographer_node" 2>/dev/null', { shell: true });
    exec('pkill -f "cartographer_occupancy_grid_node" 2>/dev/null', { shell: true });
    // 停止建图相关的其他节点
    exec('pkill -f "joint_state_publisher" 2>/dev/null', { shell: true });
    exec('pkill -f "joy_ctrl" 2>/dev/null', { shell: true });
    exec('pkill -f "joy_node" 2>/dev/null', { shell: true });
    exec('pkill -f "static_transform_publisher" 2>/dev/null', { shell: true });
    exec('pkill -f "robot_state_publisher" 2>/dev/null', { shell: true });
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 强制杀死所有残留进程
    console.log('Force killing any remaining processes...');
    exec('pkill -9 -f "cartographer" 2>/dev/null', { shell: true });
    exec('pkill -9 -f "yahboomcar_bringup" 2>/dev/null', { shell: true });
    exec('pkill -9 -f "ydlidar" 2>/dev/null', { shell: true });
    exec('pkill -9 -f "Ackman" 2>/dev/null', { shell: true });
    exec('pkill -9 -f "joint_state_publisher" 2>/dev/null', { shell: true });
    exec('pkill -9 -f "joy_ctrl" 2>/dev/null', { shell: true });
    exec('pkill -9 -f "joy_node" 2>/dev/null', { shell: true });
    exec('pkill -9 -f "static_transform_publisher" 2>/dev/null', { shell: true });
    exec('pkill -9 -f "robot_state_publisher" 2>/dev/null', { shell: true });
    
    // 更新状态
    fs.writeFileSync('/tmp/mapping_state.json', JSON.stringify({
      isMapping: false,
      stage: 'stopped',
      stopTime: new Date().toISOString()
    }));
    
    // 取消话题订阅
    try {
      const rosbridgeService = require('../services/rosbridgeService').default;
      rosbridgeService.unsubscribeTopic('/map');
      rosbridgeService.unsubscribeTopic('/robot_pose');
      rosbridgeService.unsubscribeTopic('/tf');
      rosbridgeService.unsubscribeTopic('/point_cloud');
      rosbridgeService.unsubscribeTopic('/scan_points');
      console.log('Unsubscribed from all mapping topics');
    } catch (e) {
      console.error('Error unsubscribing topics:', e);
    }
    
    console.log('All mapping processes stopped');
    res.json({ 
      message: 'Local mapping stopped successfully',
      stoppedProcesses: [
        'yahboom_app_save_map',
        'laserscan_to_point',
        'robot_pose_publisher',
        'map_cartographer_launch.py',
        'yahboomcar_bringup_R2_launch.py',
        'Ackman_driver_R2',
        'ydlidar_ros2_driver',
        'cartographer_node',
        'cartographer_occupancy_grid_node',
        'joint_state_publisher',
        'joy_ctrl',
        'joy_node',
        'static_transform_publisher'
      ]
    });
  } catch (error) {
    console.error('Error stopping local mapping:', error);
    res.status(500).json({ error: 'Failed to stop local mapping' });
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
      const yamlFiles = files.filter((file: string) => file.endsWith('.yaml'));
      
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
        
        lines.forEach((line: string) => {
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

export const saveMapLocal = async (req: Request, res: Response) => {
  try {
    const { exec, spawn } = require('child_process');
    const fs = require('fs');
    
    console.log('Saving local map...');
    
    // 获取地图名称
    const mapName = req.body.mapName || `map_${Date.now()}`;
    
    // 确保地图目录存在
    const mapDir = '/home/jetson/yahboomcar_ros2_ws/yahboomcar_ws/src/yahboomcar_nav/maps';
    if (!fs.existsSync(mapDir)) {
      fs.mkdirSync(mapDir, { recursive: true });
    }
    
    const mapPath = `${mapDir}/${mapName}`;
    
    // 使用yahboom_app_save_map服务保存地图
    const workspacePath = '/home/jetson/yahboomcar_ros2_ws/yahboomcar_ws';
    const setupCommand = `source ${workspacePath}/install/setup.bash && `;
    
    // 同步执行保存操作
    return new Promise((resolve, reject) => {
      console.log(`Executing save service for map: ${mapName}`);
      
      // 调用yahboom_app_save_map服务
      const saveServiceCommand = `${setupCommand}ros2 service call /yahboomAppSaveMap yahboom_web_savmap_interfaces/srv/WebSaveMap "{mapname: '${mapName}'}"`;
      
      const child = spawn('bash', ['-c', saveServiceCommand], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
      });
      
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (data: any) => {
        stdout += data.toString();
      });
      
      child.stderr.on('data', (data: any) => {
        stderr += data.toString();
      });
      
      child.on('close', async (code: number) => {
        if (code === 0) {
          console.log('Save service response:', stdout);
          
          // 等待文件生成
          let retries = 10;
          while (retries > 0) {
            const yamlExists = fs.existsSync(`${mapPath}.yaml`);
            const pgmExists = fs.existsSync(`${mapPath}.pgm`);
            
            if (yamlExists && pgmExists) {
              console.log(`Map saved successfully at: ${mapPath}`);
              resolve({
                message: 'Local map saved successfully',
                mapPath: mapPath,
                mapName: mapName,
                method: 'yahboom_app_save_map_service'
              });
              return;
            }
            
            retries--;
            await new Promise(r => setTimeout(r, 1000));
          }
          
          console.error(`Map files not found after save at: ${mapPath}`);
          reject(new Error('Map files not generated'));
        } else {
          console.error('Save service failed, trying fallback method...');
          
          // 备用方案：使用map_saver_cli
          const fallbackCommand = `${setupCommand}ros2 run nav2_map_server map_saver_cli -f ${mapPath}`;
          const fallbackChild = spawn('bash', ['-c', fallbackCommand], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env }
          });
          
          fallbackChild.on('close', async (fallbackCode: number) => {
            if (fallbackCode === 0) {
              // 等待文件生成
              let retries = 10;
              while (retries > 0) {
                const yamlExists = fs.existsSync(`${mapPath}.yaml`);
                const pgmExists = fs.existsSync(`${mapPath}.pgm`);
                
                if (yamlExists && pgmExists) {
                  console.log(`Map saved successfully using fallback at: ${mapPath}`);
                  resolve({
                    message: 'Local map saved successfully (fallback)',
                    mapPath: mapPath,
                    mapName: mapName,
                    method: 'map_saver_cli'
                  });
                  return;
                }
                
                retries--;
                await new Promise(r => setTimeout(r, 1000));
              }
            }
            
            reject(new Error('Both save methods failed'));
          });
        }
      });
      
      child.on('error', (error: any) => {
        console.error('Error executing save command:', error);
        reject(error);
      });
    }).then((result: any) => {
      res.json(result);
    }).catch((error: any) => {
      console.error('Error saving local map:', error.message);
      res.status(500).json({ error: 'Failed to save local map' });
    });
  } catch (error: any) {
    console.error('Error saving local map:', error.message);
    res.status(500).json({ error: 'Failed to save local map' });
  }
};

export const saveMap = async (req: Request, res: Response) => {
  try {
    res.json({ message: 'Map saved' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save map' });
  }
};

export const deleteMap = async (req: Request, res: Response) => {
  try {
    res.json({ message: 'Map deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete map' });
  }
};

export const loadMap = async (req: Request, res: Response) => {
  try {
    res.json({ message: 'Map loaded' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load map' });
  }
};