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
    const MapModel = require('../models/Map').default;
    const fs = require('fs');
    
    // 首先从数据库查找激活的地图
    let activeMap = await MapModel.findOne({ where: { isActive: true } });
    
    if (activeMap) {
      console.log('Active map found in database:', activeMap.id);
      return res.json(activeMap);
    }
    
    // 如果数据库中没有，尝试从状态文件读取
    if (fs.existsSync('/tmp/active_map_state.json')) {
      try {
        const state = JSON.parse(fs.readFileSync('/tmp/active_map_state.json', 'utf8'));
        console.log('Active map found in state file:', state.activeMapId);
        
        // 尝试从数据库获取完整信息
        const mapFromDb = await MapModel.findOne({ where: { id: state.activeMapId } });
        if (mapFromDb) {
          return res.json(mapFromDb);
        }
        
        // 返回基本信息
        return res.json({
          id: state.activeMapId,
          name: state.activeMapId,
          yamlPath: state.activeMapPath,
          isActive: true
        });
      } catch (e) {
        console.error('Failed to read active map state:', e);
      }
    }
    
    // 如果都没有，返回 null
    console.log('No active map found');
    res.json(null);
  } catch (error) {
    console.error('Error fetching active map:', error);
    res.status(500).json({ error: 'Failed to fetch active map' });
  }
};

export const setActiveMap = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const fs = require('fs');
    const path = require('path');
    const MapModel = require('../models/Map').default;
    
    const mapsDir = '/home/jetson/yahboomcar_ros2_ws/yahboomcar_ws/src/yahboomcar_nav/maps';
    const yamlPath = path.join(mapsDir, `${id}.yaml`);
    
    // 检查地图是否存在
    if (!fs.existsSync(yamlPath)) {
      return res.status(404).json({ error: 'Map not found' });
    }
    
    // 更新数据库：将所有地图设置为非激活
    await MapModel.update({ isActive: false }, { where: {} });
    
    // 查找或创建地图记录
    let mapRecord = await MapModel.findOne({ where: { id } });
    
    if (!mapRecord) {
      // 如果数据库中没有记录，创建一个新记录
      const yamlContent = fs.readFileSync(yamlPath, 'utf8');
      const lines = yamlContent.split('\n');
      let pgmPath = '';
      let resolution = 0.05;
      let origin = { x: 0, y: 0, z: 0 };
      
      lines.forEach((line: string) => {
        if (line.startsWith('image:')) {
          const imageName = line.split(':')[1].trim();
          pgmPath = path.join(mapsDir, imageName);
        } else if (line.startsWith('resolution:')) {
          resolution = parseFloat(line.split(':')[1].trim()) || 0.05;
        } else if (line.startsWith('origin:')) {
          try {
            const originStr = line.split(':')[1].trim();
            const originArray = JSON.parse(originStr);
            if (Array.isArray(originArray) && originArray.length >= 2) {
              origin = {
                x: parseFloat(originArray[0]) || 0,
                y: parseFloat(originArray[1]) || 0,
                z: parseFloat(originArray[2]) || 0
              };
            }
          } catch (e) {
            console.error('Failed to parse origin:', e);
          }
        }
      });
      
      // 读取PGM文件获取尺寸
      let width = 1000;
      let height = 1000;
      if (fs.existsSync(pgmPath)) {
        const pgmBuffer = fs.readFileSync(pgmPath);
        let i = 0;
        let lineCount = 0;
        
        // 跳过魔数
        while (i < pgmBuffer.length && pgmBuffer[i] !== 10 && pgmBuffer[i] !== 13) i++;
        while (i < pgmBuffer.length && (pgmBuffer[i] === 10 || pgmBuffer[i] === 13)) i++;
        
        // 读取宽度和高度
        while (lineCount < 1 && i < pgmBuffer.length) {
          let line = '';
          while (i < pgmBuffer.length && pgmBuffer[i] !== 10 && pgmBuffer[i] !== 13) {
            line += String.fromCharCode(pgmBuffer[i]);
            i++;
          }
          while (i < pgmBuffer.length && (pgmBuffer[i] === 10 || pgmBuffer[i] === 13)) i++;
          
          if (line.startsWith('#')) continue;
          
          const dimensions = line.trim().split(/\s+/);
          if (dimensions.length >= 2) {
            width = parseInt(dimensions[0]) || width;
            height = parseInt(dimensions[1]) || height;
            lineCount++;
          }
        }
      }
      
      mapRecord = await MapModel.create({
        id,
        name: id,
        yamlPath,
        pgmPath,
        resolution,
        width,
        height,
        origin,
        isActive: true
      });
    } else {
      // 更新现有记录
      await mapRecord.update({ isActive: true });
    }
    
    // 保存激活地图信息到状态文件（用于兼容性）
    const activeMapState = {
      activeMapId: id,
      activeMapPath: yamlPath,
      setAt: new Date().toISOString()
    };
    
    fs.writeFileSync('/tmp/active_map_state.json', JSON.stringify(activeMapState));
    console.log(`Set active map to: ${id} (database and state file updated)`);
    
    res.json({ 
      message: 'Active map set successfully',
      activeMap: activeMapState
    });
  } catch (error) {
    console.error('Error setting active map:', error);
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
    
    // 统一使用系统模式文件判断状态
    if (fs.existsSync('/tmp/robot_system_mode')) {
      const currentMode = fs.readFileSync('/tmp/robot_system_mode', 'utf8').trim();
      const isMapping = currentMode === 'mapping';
      
      res.json({ 
        isMapping: isMapping,
        mode: currentMode,
        timestamp: new Date().toISOString()
      });
    } else {
      res.json({ 
        isMapping: false,
        mode: 'unknown',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('Error getting mapping status:', error);
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
        const resValue = parseFloat(line.split(':')[1].trim());
        mapInfo.resolution = isNaN(resValue) ? 0.05 : resValue;
      } else if (line.startsWith('origin:')) {
        try {
          const originStr = line.split(':')[1].trim();
          const originArray = JSON.parse(originStr);
          if (Array.isArray(originArray) && originArray.length >= 2) {
            mapInfo.origin = {
              x: parseFloat(originArray[0]) || 0,
              y: parseFloat(originArray[1]) || 0,
              z: parseFloat(originArray[2]) || 0
            };
          }
        } catch (e) {
          console.error(`Failed to parse origin in getMapImage:`, e);
          mapInfo.origin = { x: 0, y: 0, z: 0 };
        }
      }
    });
    
    if (!fs.existsSync(pgmPath)) {
      return res.status(404).json({ error: 'PGM file not found' });
    }
    
    // 读取PGM文件
    const sharp = require('sharp');
    const pgmBuffer = fs.readFileSync(pgmPath);
    
    // 解析PGM文件头
    let pgmType = '';
    let dataOffset = 0;
    let lineCount = 0;
    let i = 0;
    
    // 读取魔数（P2 或 P5）
    while (i < pgmBuffer.length && pgmBuffer[i] !== 10 && pgmBuffer[i] !== 13) {
      pgmType += String.fromCharCode(pgmBuffer[i]);
      i++;
    }
    
    // 跳过换行符
    while (i < pgmBuffer.length && (pgmBuffer[i] === 10 || pgmBuffer[i] === 13)) {
      i++;
    }
    
    console.log(`PGM type: ${pgmType}`);
    
    // 读取后续行（宽度、高度、最大值），跳过注释
    while (lineCount < 2 && i < pgmBuffer.length) {
      let line = '';
      
      // 读取一行
      while (i < pgmBuffer.length && pgmBuffer[i] !== 10 && pgmBuffer[i] !== 13) {
        line += String.fromCharCode(pgmBuffer[i]);
        i++;
      }
      
      // 跳过换行符
      while (i < pgmBuffer.length && (pgmBuffer[i] === 10 || pgmBuffer[i] === 13)) {
        i++;
      }
      
      // 跳过注释行
      if (line.startsWith('#')) {
        continue;
      }
      
      // 解析宽度和高度
      if (lineCount === 0) {
        const dimensions = line.trim().split(/\s+/);
        if (dimensions.length >= 2) {
          mapInfo.width = parseInt(dimensions[0]) || mapInfo.width;
          mapInfo.height = parseInt(dimensions[1]) || mapInfo.height;
          lineCount++;
        }
      } else if (lineCount === 1) {
        // 最大值行（通常是 255）
        lineCount++;
      }
    }
    
    dataOffset = i;
    
    console.log(`PGM dimensions: ${mapInfo.width}x${mapInfo.height}, data offset: ${dataOffset}`);
    
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
    
    // 统一使用系统模式文件判断状态
    let currentMode = 'unknown';
    let isMapping = false;
    
    if (fs.existsSync('/tmp/robot_system_mode')) {
      currentMode = fs.readFileSync('/tmp/robot_system_mode', 'utf8').trim();
      isMapping = currentMode === 'mapping';
    }
    
    // 可选：验证建图进程是否实际在运行（仅用于日志）
    exec('pgrep -f "cartographer_node"', { shell: true }, (error: any, stdout: any) => {
      const isProcessRunning = !error && stdout.trim().length > 0;
      
      if (isMapping && !isProcessRunning) {
        console.log('Mode is mapping but cartographer process not found, may be starting/stopping');
      }
      
      res.json({ 
        isMapping: isMapping,
        mode: currentMode,
        processRunning: isProcessRunning,
        timestamp: new Date().toISOString()
      });
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
    const { spawn } = require('child_process');
    const fs = require('fs');
    
    console.log('Switching to mapping mode using system manager...');
    
    const projectDir = process.env.PROJECT_DIR || '/home/jetson/yahboomcar_ros2_ws';
    const switchScript = `${projectDir}/switch_mode.sh`;
    
    // 只使用模式切换系统，由switch_mode.sh统一管理所有节点启动
    const switchChild = spawn('bash', [switchScript, 'mapping'], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    
    switchChild.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    
    switchChild.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    
    switchChild.on('exit', (code: number | null) => {
      if (code === 0) {
        console.log('Successfully switched to mapping mode');
      } else {
        console.error('Failed to switch to mapping mode:', stderr);
      }
    });
    
    // 等待模式切换完成
    await new Promise(resolve => setTimeout(resolve, 8000));
    
    // 确保日志文件存在
    fs.writeFileSync('/tmp/mapping.log', `Mapping started at ${new Date().toISOString()}\n`);
    
    // 只更新系统模式文件，不使用单独的mapping_state.json
    // 状态统一由系统模式文件管理
    fs.writeFileSync('/tmp/robot_system_mode', 'mapping');
    
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
    
    console.log('Mapping mode initialized successfully via system manager');
    
    res.json({ 
      message: '建图模式启动成功',
      mode: 'mapping',
      timestamp: new Date().toISOString()
    });
    
  } catch (error: any) {
    console.error('Error starting local mapping:', error);
    res.status(500).json({ error: 'Failed to start mapping' });
  }
};

export const stopMappingLocal = async (req: Request, res: Response) => {
  try {
    const { spawn } = require('child_process');
    
    console.log('Stopping local mapping...');
    
    // 只使用模式切换系统，由switch_mode.sh统一管理所有节点停止
    console.log('Switching to idle mode using system manager...');
    
    const projectDir = process.env.PROJECT_DIR || '/home/jetson/yahboomcar_ros2_ws';
    const switchScript = `${projectDir}/switch_mode.sh`;
    
    // 切换到待机模式
    const switchChild = spawn('bash', [switchScript, 'idle'], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    
    switchChild.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    
    switchChild.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    
    switchChild.on('exit', (code: number | null) => {
      if (code === 0) {
        console.log('Successfully switched to idle mode');
      } else {
        console.error('Failed to switch to idle mode:', stderr);
      }
    });
    
    // 等待模式切换完成
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // 只更新系统模式文件，不使用单独的mapping_state.json
    // 状态统一由系统模式文件管理
    const fs = require('fs');
    fs.writeFileSync('/tmp/robot_system_mode', 'idle');
    
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
    
    console.log('Mapping mode stopped successfully via system manager');
    
    res.json({ 
      message: '建图模式已停止',
      mode: 'idle',
      timestamp: new Date().toISOString()
    });
    
  } catch (error: any) {
    console.error('Error stopping local mapping:', error);
    res.status(500).json({ error: 'Failed to stop mapping' });
  }
};

export const scanLocalMaps = async (req: Request, res: Response) => {
  try {
    const fs = require('fs');
    const path = require('path');
    
    const mapsDir = '/home/jetson/yahboomcar_ros2_ws/yahboomcar_ws/src/yahboomcar_nav/maps';
    const maps = [];
    
    // 读取激活地图状态
    let activeMapId = null;
    if (fs.existsSync('/tmp/active_map_state.json')) {
      try {
        const activeMapState = JSON.parse(fs.readFileSync('/tmp/active_map_state.json', 'utf8'));
        activeMapId = activeMapState.activeMapId;
      } catch (e) {
        console.warn('Failed to read active map state:', e);
      }
    }
    
    if (fs.existsSync(mapsDir)) {
      const files = fs.readdirSync(mapsDir);
      const yamlFiles = files.filter((file: string) => file.endsWith('.yaml'));
      
      for (const yamlFile of yamlFiles) {
        const yamlPath = path.join(mapsDir, yamlFile);
        const yamlContent = fs.readFileSync(yamlPath, 'utf8');
        
        // 解析YAML文件
        const lines = yamlContent.split('\n');
        const mapName = path.basename(yamlFile, '.yaml');
        
        // 获取文件创建时间
        const stats = fs.statSync(yamlPath);
        
        let mapInfo: any = {
          id: mapName,
          name: mapName,
          yamlPath: yamlPath,
          pgmPath: '',
          resolution: 0.05,
          origin: { x: 0, y: 0, z: 0 },
          width: 1000,
          height: 1000,
          createdAt: stats.birthtime || stats.mtime,
          isActive: mapName === activeMapId,
        };
        
        lines.forEach((line: string) => {
          if (line.startsWith('image:')) {
            const imageName = line.split(':')[1].trim();
            mapInfo.pgmPath = path.join(mapsDir, imageName);
          } else if (line.startsWith('resolution:')) {
            const resValue = parseFloat(line.split(':')[1].trim());
            mapInfo.resolution = isNaN(resValue) ? 0.05 : resValue;
          } else if (line.startsWith('origin:')) {
            try {
              const originStr = line.split(':')[1].trim();
              if (!originStr) {
                mapInfo.origin = { x: 0, y: 0, z: 0 };
              } else {
                const originArray = JSON.parse(originStr);
                if (Array.isArray(originArray) && originArray.length >= 2) {
                  mapInfo.origin = {
                    x: parseFloat(originArray[0]) || 0,
                    y: parseFloat(originArray[1]) || 0,
                    z: parseFloat(originArray[2]) || 0
                  };
                }
              }
            } catch (e) {
              console.error(`Failed to parse origin for ${yamlFile}:`, e);
              mapInfo.origin = { x: 0, y: 0, z: 0 };
            }
          }
        });
        
        // 检查PGM文件是否存在
        if (fs.existsSync(mapInfo.pgmPath)) {
          // 尝试读取PGM文件头获取尺寸
          try {
            const pgmBuffer = fs.readFileSync(mapInfo.pgmPath);
            const pgmHeader = pgmBuffer.toString('utf8', 0, 200); // 读取前200字节作为头部
            const pgmLines = pgmHeader.split('\n').filter((line: string) => !line.startsWith('#')); // 过滤注释
            
            // PGM 格式: P2 (ASCII) 或 P5 (Binary)
            if ((pgmLines[0] === 'P2' || pgmLines[0] === 'P5') && pgmLines[1]) {
              const dimensions = pgmLines[1].trim().split(/\s+/);
              if (dimensions.length >= 2) {
                mapInfo.width = parseInt(dimensions[0]) || 1000;
                mapInfo.height = parseInt(dimensions[1]) || 1000;
              }
            }
          } catch (e) {
            console.warn(`Could not read PGM dimensions for ${mapInfo.name}:`, e);
            // 保持默认值 1000x1000
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
    const { id } = req.params;
    const fs = require('fs');
    const path = require('path');
    
    const mapsDir = '/home/jetson/yahboomcar_ros2_ws/yahboomcar_ws/src/yahboomcar_nav/maps';
    const yamlPath = path.join(mapsDir, `${id}.yaml`);
    const pgmPath = path.join(mapsDir, `${id}.pgm`);
    
    // 检查文件是否存在
    if (!fs.existsSync(yamlPath)) {
      return res.status(404).json({ error: 'Map not found' });
    }
    
    // 删除 YAML 文件
    if (fs.existsSync(yamlPath)) {
      fs.unlinkSync(yamlPath);
      console.log(`Deleted YAML file: ${yamlPath}`);
    }
    
    // 删除 PGM 文件
    if (fs.existsSync(pgmPath)) {
      fs.unlinkSync(pgmPath);
      console.log(`Deleted PGM file: ${pgmPath}`);
    }
    
    res.json({ 
      message: 'Map deleted successfully',
      deletedFiles: {
        yaml: yamlPath,
        pgm: pgmPath
      }
    });
  } catch (error) {
    console.error('Error deleting map:', error);
    res.status(500).json({ error: 'Failed to delete map' });
  }
};

export const loadMap = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const fs = require('fs');
    const path = require('path');
    const { spawn } = require('child_process');
    
    const mapsDir = '/home/jetson/yahboomcar_ros2_ws/yahboomcar_ws/src/yahboomcar_nav/maps';
    const yamlPath = path.join(mapsDir, `${id}.yaml`);
    
    // 检查地图是否存在
    if (!fs.existsSync(yamlPath)) {
      return res.status(404).json({ error: 'Map not found' });
    }
    
    // 设置为激活地图
    const activeMapState = {
      activeMapId: id,
      activeMapPath: yamlPath,
      setAt: new Date().toISOString()
    };
    fs.writeFileSync('/tmp/active_map_state.json', JSON.stringify(activeMapState));
    
    // 启动导航系统（这会自动加载激活的地图）
    // 注意：实际的导航启动逻辑可能需要根据具体情况调整
    const workspacePath = '/home/jetson/yahboomcar_ros2_ws/yahboomcar_ws';
    const setupCommand = `source ${workspacePath}/install/setup.bash && `;
    
    // 这里只是设置激活地图，实际加载由导航系统完成
    // 如果需要立即启动导航，可以取消下面的注释
    /*
    spawn('bash', ['-c', 
      setupCommand + `ros2 launch yahboomcar_nav navigation_dwa_launch.py map:=${yamlPath}`
    ], {
      stdio: ['ignore', 'ignore', 'ignore'],
      detached: true
    });
    */
    
    console.log(`Map loaded: ${id}`);
    
    res.json({ 
      message: 'Map loaded successfully',
      mapId: id,
      mapPath: yamlPath
    });
  } catch (error) {
    console.error('Error loading map:', error);
    res.status(500).json({ error: 'Failed to load map' });
  }
};
