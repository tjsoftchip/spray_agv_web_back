import { Request, Response } from 'express';
import { exec, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { SystemConfig } from '../models';

// 系统状态接口
interface SystemStatus {
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
  uptime: string;
  hostname: string;
}

// PID管理
const PID_DIR = '/tmp/robot_system_pids';
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

    const status: SystemStatus = {
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

    // 检查Web前端服务（异步，带超时）
    status.basicServices.webFrontend = await new Promise<boolean>((resolve) => {
      const frontendCheck = spawn('curl', ['-s', '--connect-timeout', '2', 'http://localhost:5173'], {
        stdio: 'pipe'
      });
      const timer = setTimeout(() => {
        frontendCheck.kill();
        resolve(false);
      }, 5000);
      frontendCheck.on('close', (code: number | null) => {
        clearTimeout(timer);
        resolve(code === 0);
      });
      frontendCheck.on('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
    });

    // 检查功能节点
    status.functionalNodes.mapping = await processExists('cartographer_node');
    status.functionalNodes.navigation = await processExists('nav2');
    status.functionalNodes.supply = await processExists('automation_manager');
    
    // 检查传感器 - 使用 ROS2 节点列表检测（更准确，带超时）
    const ros2NodeList = await new Promise<string>((resolve) => {
      const child = exec('ros2 node list 2>/dev/null', { timeout: 5000 }, (error, stdout) => {
        resolve(error ? '' : stdout);
      });
      child.on('error', () => resolve(''));
    });
    
    const hasCameraNode = ros2NodeList.includes('camera') || ros2NodeList.includes('astra');
    const hasLidarNode = ros2NodeList.includes('ydlidar') || ros2NodeList.includes('lidar');
    const hasWebVideo = await new Promise<boolean>((resolve) => {
      exec('pgrep web_video_serve 2>/dev/null | wc -l', { timeout: 5000 }, (error, stdout) => {
        resolve(!error && parseInt(stdout.trim()) > 0);
      });
    });
    
    // 设置传感器状态
    status.functionalNodes.sensors.camera = hasCameraNode;
    status.functionalNodes.sensors.lidar = hasLidarNode;
    status.functionalNodes.sensors.webVideo = hasWebVideo;

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
        command = 'pgrep -x cartographer_node 2>/dev/null || pgrep -f "cartographer_node$" 2>/dev/null | wc -l';
        break;
      case 'nav2':
        command = 'pgrep -x nav2 2>/dev/null || pgrep -f "nav2$" 2>/dev/null | wc -l';
        break;
      case 'supply_manager':
        command = 'pgrep -x automation_manager 2>/dev/null || pgrep -f "automation_manager$" 2>/dev/null | wc -l';
        break;
      case 'astra_camera_node':
        command = 'pgrep -x astra_camera_node 2>/dev/null || pgrep -f "astra_camera_node$" 2>/dev/null | wc -l';
        break;
      case 'ydlidar_ros2_driver':
        command = 'pgrep -x ydlidar_ros2_driver 2>/dev/null || pgrep -f "ydlidar_ros2_driver$" 2>/dev/null | wc -l';
        break;
      case 'web_video_server':
        command = 'pgrep web_video_serve 2>/dev/null | wc -l';
        break;
      default:
        command = `pgrep -x "${processName}" 2>/dev/null || pgrep -f "${processName}$" 2>/dev/null | wc -l`;
    }
    
    exec(command, { timeout: 5000 }, (error, stdout) => {
      if (!error) {
        const count = parseInt(stdout.trim());
        if (count > 0) {
          // 验证进程是否真的在运行
          exec(`pgrep -x "${processName}" 2>/dev/null || pgrep -f "${processName}$" 2>/dev/null | head -1 | xargs ps -p -o comm=`, { timeout: 5000 }, (pidError, pidStdout) => {
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
        exec('pkill -f "astra_camera_node" && pkill -f "ydlidar_ros2_driver" && pkill web_video_serve && pkill -f "ros2 run.*web_video_server"', (error) => {
          if (error) {
            console.error('Error restarting sensors:', error);
            return res.status(500).json({ error: 'Failed to restart sensors' });
          }
          res.json({ message: 'Sensors restarted successfully' });
        });
        break;
        
      case 'function':
        // 重启所有功能节点
        exec('pkill -f "cartographer" && pkill -f "nav2" && pkill -f "automation_manager" && pkill -f "aruco"', (error) => {
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

// web_video_server 进程引用
let webVideoProcess: any = null;

// 启动 web_video_server（按需）
export const startWebVideoServer = async (req: Request, res: Response) => {
  const projectDir = process.env.PROJECT_DIR || '/home/jetson/yahboomcar_ros2_ws';

  try {
    // 检查是否已在运行（匹配进程名 web_video_serve，Linux 截断至 15 字符）
    const running = await new Promise<boolean>((resolve) => {
      exec('pgrep web_video_serve 2>/dev/null | wc -l', (error, stdout) => {
        resolve(!error && parseInt(stdout.trim()) > 0);
      });
    });

    if (running) {
      return res.json({ message: 'web_video_server is already running' });
    }

    // 构建 ROS2 环境加载命令
    const rosSetup = `source /opt/ros/humble/setup.bash && source ${projectDir}/software/library_ws/install/setup.bash`;
    const cmd = `${rosSetup} && ros2 run web_video_server web_video_server`;

    // 使用 bash -c 确保 ROS2 环境正确加载
    webVideoProcess = spawn('bash', ['-c', cmd], {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    // 等待启动确认（或进程退出）
    const startupResult = await new Promise<'started' | 'failed'>((resolve) => {
      let settled = false;

      const onOutput = (data: Buffer) => {
        const output = data.toString();
        console.log('[web_video_server]', output);
        if (!settled && output.includes('Waiting For connections')) {
          settled = true;
          resolve('started');
        }
      };

      webVideoProcess.stdout?.on('data', onOutput);
      webVideoProcess.stderr?.on('data', onOutput);

      webVideoProcess.on('error', (err: Error) => {
        console.error('[web_video_server] Failed to start:', err.message);
        if (!settled) {
          settled = true;
          resolve('failed');
        }
      });

      webVideoProcess.on('exit', (code: number | null) => {
        console.log(`[web_video_server] exited with code ${code}`);
        webVideoProcess = null;
        if (!settled) {
          settled = true;
          resolve(code === 0 ? 'started' : 'failed');
        }
      });

      // 超时保护：最多等待 8 秒
      setTimeout(() => {
        if (!settled) {
          settled = true;
          // 超时时检查进程是否仍在运行
          if (webVideoProcess && webVideoProcess.exitCode === null) {
            resolve('started');
          } else {
            resolve('failed');
          }
        }
      }, 8000);
    });

    if (startupResult === 'started') {
      res.json({ message: 'web_video_server started successfully' });
    } else {
      res.status(500).json({ error: 'Failed to start web_video_server' });
    }
  } catch (error) {
    console.error('[web_video_server] Error starting:', error);
    res.status(500).json({ error: 'Failed to start web_video_server' });
  }
};

// 停止 web_video_server（关闭预览时）
export const stopWebVideoServer = async (req: Request, res: Response) => {
  try {
    if (webVideoProcess) {
      webVideoProcess.kill('SIGTERM');
      webVideoProcess = null;
      // 额外清理 ros2 wrapper 和实际 server 进程
      exec('pkill web_video_serve 2>/dev/null; pkill -f "ros2 run.*web_video_server" 2>/dev/null');
    } else {
      // 通过 pkill 确保关闭（匹配进程名或 ros2 wrapper）
      await new Promise<void>((resolve) => {
        exec('pkill web_video_serve 2>/dev/null; pkill -f "ros2 run.*web_video_server" 2>/dev/null', (error) => {
          resolve();
        });
      });
    }

    res.json({ message: 'web_video_server stopped successfully' });
  } catch (error) {
    console.error('[web_video_server] Error stopping:', error);
    res.status(500).json({ error: 'Failed to stop web_video_server' });
  }
};

// 记录客户端错误日志
export const logClientError = async (req: Request, res: Response) => {
  try {
    const { errors } = req.body;
    
    if (errors && Array.isArray(errors)) {
      errors.forEach((error: any) => {
        console.error('[Client Error]', {
          message: error.message,
          url: error.url,
          userAgent: error.userAgent,
          timestamp: error.timestamp,
          stack: error.stack?.substring(0, 500) // 限制日志长度
        });
      });
    }
    
    res.json({ success: true, logged: errors?.length || 0 });
  } catch (error) {
    console.error('Error logging client error:', error);
    res.status(500).json({ error: 'Failed to log client error' });
  }
};