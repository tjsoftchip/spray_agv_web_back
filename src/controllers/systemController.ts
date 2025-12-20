import { Request, Response } from 'express';
import { exec, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

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
      const startTime = new Date(fs.readFileSync(START_TIME_FILE, 'utf8').trim());
      const now = new Date();
      const uptime = now.getTime() - startTime.getTime();
      
      const hours = Math.floor(uptime / (1000 * 60 * 60));
      const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
      
      return `${hours}小时${minutes}分钟`;
    }
  } catch (e) {
    console.error('Error calculating uptime:', e);
  }
  return '未知';
}

// 获取系统状态
export const getSystemStatus = async (req: Request, res: Response) => {
  try {
    const status: SystemStatus = {
      mode: getCurrentMode() as any,
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
      uptime: getUptime()
    };

    // 检查基础服务
    const chassisPid = readPidFile('chassis.pid');
    if (chassisPid) status.basicServices.chassis = isProcessRunning(chassisPid);

    const muxPid = readPidFile('cmd_vel_mux.pid');
    if (muxPid) status.basicServices.cmdVelMux = isProcessRunning(muxPid);

    const rosbridgePid = readPidFile('rosbridge.pid');
    if (rosbridgePid) status.basicServices.rosbridge = isProcessRunning(rosbridgePid);

    const monitorPid = readPidFile('system_monitor.pid');
    if (monitorPid) status.basicServices.systemMonitor = isProcessRunning(monitorPid);

    // 检查功能节点
    status.functionalNodes.mapping = processExists('cartographer_node');
    status.functionalNodes.navigation = processExists('nav2');
    status.functionalNodes.supply = processExists('supply_manager');
    
    // 检查传感器
    status.functionalNodes.sensors.camera = processExists('astra_camera_node');
    status.functionalNodes.sensors.lidar = processExists('ydlidar_ros2_driver');
    status.functionalNodes.sensors.webVideo = processExists('web_video_server');

    res.json(status);
  } catch (error) {
    console.error('Error getting system status:', error);
    res.status(500).json({ error: 'Failed to get system status' });
  }
};

// 检查进程是否存在
function processExists(processName: string): boolean {
  return new Promise((resolve) => {
    exec(`pgrep -f "${processName}"`, (error, stdout) => {
      resolve(!error && stdout.trim().length > 0);
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

    const projectDir = process.cwd();
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

    // 等待一段时间让脚本执行
    setTimeout(() => {
      res.json({ 
        message: `Switching to ${mode} mode`,
        mode: mode,
        stdout: stdout,
        stderr: stderr
      });
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