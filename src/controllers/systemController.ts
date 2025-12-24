import { Request, Response } from 'express';
import { exec, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { SystemConfig } from '../models';

// 系统状态接口
interface SystemStatus {
  mode: 'idle' | 'mapping' | 'navigation' | 'supply';
  basicServices: {
    chassis: boolean;
    cmdVelMux: boolean;
    rosbridge: boolean;
    webBackend: boolean;
    webFrontend: boolean;
    systemMonitor: boolean;
  };
  functionalNodes: {
    mapping: boolean;
    navigation: boolean;
    supply: boolean;
    sensors: {
      camera: boolean;
      lidar: boolean;
      webVideo: boolean;
    };
  };
  lastModeChange: string;
  uptime: string;
  hostname: string;
}

// PID管理
const PID_DIR = '/tmp/robot_system_pids';
const MODE_FILE = '/tmp/robot_system_mode';
const START_TIME_FILE = '/tmp/robot_system_start_time';

// 检查进程是否运行
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0); // 发送信号0检查进程是否存在
    return true;
  } catch (e) {
    return false;
  }
}

// 读取PID文件
function readPidFile(filename: string): number | null {
  try {
    const pidPath = path.join(PID_DIR, filename);
    if (fs.existsSync(pidPath)) {
      const pid = parseInt(fs.readFileSync(pidPath, 'utf8').trim());
      return isNaN(pid) ? null : pid;
    }
  } catch (e) {
    console.error(`Error reading PID file ${filename}:`, e);
  }
  return null;
}

// 读取当前模式
function getCurrentMode(): string {
  try {
    if (fs.existsSync(MODE_FILE)) {
      return fs.readFileSync(MODE_FILE, 'utf8').trim();
    }
  } catch (e) {
    console.error('Error reading mode file:', e);
  }
  return 'unknown';
}

// 计算系统运行时间
function getUptime(): string {
  try {
    if (fs.existsSync(START_TIME_FILE)) {
      const startTimeStr = fs.readFileSync(START_TIME_FILE, 'utf8').trim();
      const startTime = new Date(startTimeStr);
      const now = new Date();
      
      // 检查时间是否有效
      if (isNaN(startTime.getTime())) {
        console.error('Invalid start time format:', startTimeStr);
        return '未知';
      }
      
      const uptime = now.getTime() - startTime.getTime();
      
      // 如果 uptime 为负数，说明时间有问题
      if (uptime < 0) {
        console.error('Negative uptime detected, updating start time');
        // 更新启动时间为当前时间
        fs.writeFileSync(START_TIME_FILE, now.toISOString());
        return '0小时0分钟';
      }
      
      const days = Math.floor(uptime / (1000 * 60 * 60 * 24));
      const hours = Math.floor((uptime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
      
      if (days > 0) {
        return `${days}天${hours}小时${minutes}分钟`;
      } else if (hours > 0) {
        return `${hours}小时${minutes}分钟`;
      } else {
        return `${minutes}分钟`;
      }
    }
  } catch (e) {
    console.error('Error calculating uptime:', e);
  }
  return '未知';
}

// 获取系统状态
export const getSystemStatus = async (req: Request, res: Response) => {
  try {
    // 获取系统配置
    let hostname = 'KWS-R2'; // 默认主机名
    
    try {
      const hostnameConfig = await SystemConfig.findOne({ where: { key: 'hostname' } });
      if (hostnameConfig) {
        hostname = hostnameConfig.value;
      } else {
        // 如果没有配置，创建默认配置
        await SystemConfig.create({
          key: 'hostname',
          value: hostname,
          description: '系统主机名',
          category: 'system'
        });
      }
    } catch (e) {
      console.error('Error getting hostname from database:', e);
    }

    // 强制读取模式文件
    const currentMode = getCurrentMode();
    console.log('Current mode from file:', currentMode);

    const status: SystemStatus = {
      mode: currentMode as any,
      basicServices: {
        chassis: false,
        cmdVelMux: false,
        rosbridge: false,
        webBackend: true, // 如果这个API能响应，说明后端在运行
        webFrontend: false,
        systemMonitor: false
      },
      functionalNodes: {
        mapping: false,
        navigation: false,
        supply: false,
        sensors: {
          camera: false,
          lidar: false,
          webVideo: false
        }
      },
      lastModeChange: '',
      uptime: getUptime(),
      hostname: hostname
    };

    // 检查基础服务
    let chassisPid = readPidFile('chassis_driver.pid');
    if (!chassisPid) {
      // 兼容旧系统
      chassisPid = readPidFile('chassis.pid');
    }
    if (chassisPid) status.basicServices.chassis = isProcessRunning(chassisPid);

    const muxPid = readPidFile('cmd_vel_mux.pid');
    if (muxPid) status.basicServices.cmdVelMux = isProcessRunning(muxPid);

    const rosbridgePid = readPidFile('rosbridge.pid');
    if (rosbridgePid) status.basicServices.rosbridge = isProcessRunning(rosbridgePid);

    const monitorPid = readPidFile('system_monitor.pid');
    if (monitorPid) status.basicServices.systemMonitor = isProcessRunning(monitorPid);

    // 检查Web前端服务
    try {
      const { spawn } = require('child_process');
      const frontendCheck = spawn('curl', ['-s', '--connect-timeout', '2', 'http://localhost:5173'], {
        stdio: 'pipe'
      });
      
      frontendCheck.on('close', (code: number | null) => {
        if (code === 0) {
          status.basicServices.webFrontend = true;
        }
      });
      
      // 同步检查
      const { execSync } = require('child_process');
      try {
        execSync('curl -s --connect-timeout 2 http://localhost:5173 > /dev/null', { timeout: 3000 });
        status.basicServices.webFrontend = true;
      } catch (e) {
        status.basicServices.webFrontend = false;
      }
    } catch (e) {
      status.basicServices.webFrontend = false;
    }

    // 检查功能节点
    status.functionalNodes.mapping = await processExists('cartographer_node');
    status.functionalNodes.navigation = await processExists('nav2');
    status.functionalNodes.supply = await processExists('supply_manager');
    
    // 检查传感器 - 使用更精确的检测
    const cameraCount = await new Promise<number>((resolve) => {
      exec('pgrep -f "astra_camera_node" | wc -l', (error, stdout) => {
        resolve(parseInt(stdout.trim()));
      });
    });
    const lidarCount = await new Promise<number>((resolve) => {
      exec('pgrep -f "ydlidar_ros2_driver" | wc -l', (error, stdout) => {
        resolve(parseInt(stdout.trim()));
      });
    });
    const webVideoCount = await new Promise<number>((resolve) => {
      exec('pgrep -f "web_video_server" | wc -l', (error, stdout) => {
        resolve(parseInt(stdout.trim()));
      });
    });
    
    // 设置传感器状态
    status.functionalNodes.sensors.camera = cameraCount > 0;
    status.functionalNodes.sensors.lidar = lidarCount > 0;
    status.functionalNodes.sensors.webVideo = webVideoCount > 0;

    res.json(status);
  } catch (error) {
    console.error('Error getting system status:', error);
    res.status(500).json({ error: 'Failed to get system status' });
  }
};

// 检查进程是否存在
function processExists(processName: string): boolean {
  return new Promise((resolve) => {
    // 使用更精确的进程检测
    let command = '';
    switch (processName) {
      case 'cartographer_node':
        command = 'pgrep -f "cartographer_node" | wc -l';
        break;
      case 'nav2':
        command = 'pgrep -f "nav2" | wc -l';
        break;
      case 'supply_manager':
        command = 'pgrep -f "supply_manager" | wc -l';
        break;
      case 'astra_camera_node':
        command = 'pgrep -f "astra_camera_node" | wc -l';
        break;
      case 'ydlidar_ros2_driver':
        command = 'pgrep -f "ydlidar_ros2_driver" | wc -l';
        break;
      case 'web_video_server':
        command = 'pgrep -f "web_video_server" | wc -l';
        break;
      default:
        command = `pgrep -f "${processName}" | wc -l`;
    }
    
    exec(command, (error, stdout) => {
      if (!error) {
        const count = parseInt(stdout.trim());
        if (count > 0) {
          // 验证进程是否真的在运行
          exec(`pgrep -f "${processName}" | head -1 | xargs ps -p -o comm=`, (pidError, pidStdout) => {
            resolve(!pidError && pidStdout.trim().length > 0);
          });
        } else {
          resolve(false);
        }
      } else {
        resolve(false);
      }
    });
  }) as any;
}

// 切换系统模式
export const switchMode = async (req: Request, res: Response) => {
  try {
    const { mode } = req.body;
    
    if (!['idle', 'mapping', 'navigation', 'supply'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid mode' });
    }

    const projectDir = process.env.PROJECT_DIR || '/home/jetson/yahboomcar_ros2_ws';
    const switchScript = path.join(projectDir, 'switch_mode.sh');

    // 执行模式切换
    const child = spawn('bash', [switchScript, mode], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('exit', (code) => {
      if (code === 0) {
        console.log(`Mode switched to ${mode} successfully`);
      } else {
        console.error(`Failed to switch mode to ${mode}:`, stderr);
      }
    });

    // 等待一段时间让脚本执行，然后根据模式切换速度命令路由
    setTimeout(async () => {
      try {
        // 如果是导航模式，enhanced_cmd_vel_mux_node会自动处理速度源切换
        if (mode === 'navigation') {
          console.log('[System Mode Switch] Navigation mode activated - enhanced_cmd_vel_mux_node will handle speed source priority');
          stdout += '\n[INFO] Navigation mode activated - speed priority managed by enhanced_cmd_vel_mux_node';
        }
        
        res.json({ 
          message: `Switching to ${mode} mode`,
          mode: mode,
          stdout: stdout,
          stderr: stderr
        });
      } catch (error) {
        console.error('Error in post-switch processing:', error);
        res.status(500).json({ error: 'Failed to complete mode switch' });
      }
    }, 3000);

  } catch (error) {
    console.error('Error switching mode:', error);
    res.status(500).json({ error: 'Failed to switch mode' });
  }
};

// 获取当前模式
export const getCurrentModeApi = async (req: Request, res: Response) => {
  try {
    const mode = getCurrentMode();
    res.json({ mode: mode });
  } catch (error) {
    console.error('Error getting current mode:', error);
    res.status(500).json({ error: 'Failed to get current mode' });
  }
};

// 重启系统层
export const restartLayer = async (req: Request, res: Response) => {
  try {
    const { layer } = req.body;
    
    if (!['basic', 'sensor', 'function'].includes(layer)) {
      return res.status(400).json({ error: 'Invalid layer' });
    }

    const projectDir = process.cwd();
    
    switch (layer) {
      case 'basic':
        // 重启基础系统（谨慎使用）
        res.status(400).json({ error: 'Cannot restart basic layer via API' });
        break;
        
      case 'sensor':
        // 重启传感器
        exec('pkill -f "astra_camera_node" && pkill -f "ydlidar_ros2_driver" && pkill -f "web_video_server"', (error) => {
          if (error) {
            console.error('Error restarting sensors:', error);
            return res.status(500).json({ error: 'Failed to restart sensors' });
          }
          res.json({ message: 'Sensors restarted successfully' });
        });
        break;
        
      case 'function':
        // 重启所有功能节点
        exec('pkill -f "cartographer" && pkill -f "nav2" && pkill -f "supply_manager" && pkill -f "aruco"', (error) => {
          if (error) {
            console.error('Error restarting function nodes:', error);
            return res.status(500).json({ error: 'Failed to restart function nodes' });
          }
          res.json({ message: 'Function nodes restarted successfully' });
        });
        break;
    }
  } catch (error) {
    console.error('Error restarting layer:', error);
    res.status(500).json({ error: 'Failed to restart layer' });
  }
};

// 获取系统日志
export const getSystemLogs = async (req: Request, res: Response) => {
  try {
    const { lines = 100 } = req.query;
    
    // 获取系统日志
    exec(`journalctl -u robot-system --no-pager -n ${lines}`, (error, stdout, stderr) => {
      if (error) {
        console.error('Error getting system logs:', error);
        return res.status(500).json({ error: 'Failed to get system logs' });
      }
      
      res.json({
        logs: stdout.split('\n').filter(line => line.trim()),
        lines: parseInt(lines as string)
      });
    });
  } catch (error) {
    console.error('Error getting system logs:', error);
    res.status(500).json({ error: 'Failed to get system logs' });
  }
};

// 获取节点列表
export const getNodeList = async (req: Request, res: Response) => {
  try {
    exec('ros2 node list', (error, stdout, stderr) => {
      if (error) {
        console.error('Error getting node list:', error);
        return res.status(500).json({ error: 'Failed to get node list' });
      }
      
      const nodes = stdout.split('\n').filter(node => node.trim());
      res.json({ nodes: nodes });
    });
  } catch (error) {
    console.error('Error getting node list:', error);
    res.status(500).json({ error: 'Failed to get node list' });
  }
};

// 获取话题列表
export const getTopicList = async (req: Request, res: Response) => {
  try {
    exec('ros2 topic list', (error, stdout, stderr) => {
      if (error) {
        console.error('Error getting topic list:', error);
        return res.status(500).json({ error: 'Failed to get topic list' });
      }
      
      const topics = stdout.split('\n').filter(topic => topic.trim());
      res.json({ topics: topics });
    });
  } catch (error) {
    console.error('Error getting topic list:', error);
    res.status(500).json({ error: 'Failed to get topic list' });
  }
};

// 获取系统配置
export const getSystemConfig = async (req: Request, res: Response) => {
  try {
    // 默认系统配置
    const defaultConfig = {
      system: {
        name: '梁场养护机器人',
        version: '1.0.0',
        autoStart: true,
        logLevel: 'info'
      },
      navigation: {
        defaultSpeed: 0.5,
        maxSpeed: 1.0,
        obstacleAvoidance: true,
        planningTimeout: 30
      },
      mapping: {
        resolution: 0.05,
        updateRate: 5,
        scanRange: 10.0
      },
      supply: {
        markerSize: 0.168,
        alignmentTolerance: 0.05,
        maxRetryAttempts: 3
      },
      camera: {
        width: 640,
        height: 480,
        fps: 30,
        enableDepth: true
      },
      network: {
        rosbridgePort: 9090,
        webVideoPort: 8080,
        apiPort: 3000,
        frontendPort: 5173
      }
    };
    
    res.json(defaultConfig);
  } catch (error) {
    console.error('Error getting system config:', error);
    res.status(500).json({ error: 'Failed to get system config' });
  }
};

// 更新系统配置
export const updateSystemConfig = async (req: Request, res: Response) => {
  try {
    const config = req.body;
    
    // 这里可以将配置保存到文件或数据库
    // 目前只是返回成功响应
    console.log('System config updated:', config);
    
    res.json({ 
      message: 'System configuration updated successfully',
      config: config
    });
  } catch (error) {
    console.error('Error updating system config:', error);
    res.status(500).json({ error: 'Failed to update system config' });
  }
};