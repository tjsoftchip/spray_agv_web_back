import { Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import rosbridgeService from '../services/rosbridgeService';

const execAsync = promisify(exec);

// GPU监控接口
export const getGPUMetrics = async (req: Request, res: Response) => {
  try {
    // 获取GPU使用情况
    const { stdout: gpuInfo } = await execAsync('nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits');
    
    // 获取进程信息
    const { stdout: processInfo } = await execAsync('nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader');
    
    // 解析GPU信息
    const gpuData = gpuInfo.trim().split('\n')[0].split(', ');
    const gpuMetrics = {
      utilization: parseInt(gpuData[0]),
      memoryUsed: parseInt(gpuData[1]),
      memoryTotal: parseInt(gpuData[2]),
      temperature: parseInt(gpuData[3]),
      powerDraw: parseFloat(gpuData[4]),
      processes: processInfo.trim().split('\n').map(line => {
        const [pid, name, memory] = line.split(', ');
        return { pid: parseInt(pid), name, memory: parseInt(memory) };
      })
    };
    
    res.json(gpuMetrics);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch GPU metrics' });
  }
};

// 补给管理状态监控
export const getSupplyStatus = async (req: Request, res: Response) => {
  try {
    // 返回缓存的状态
    const supplyState = rosbridgeService.latestNavigationStatus || {};
    const obstacleStatus = rosbridgeService.latestObstacleStatus || {};
    
    // 获取机器人位姿
    const robotPose = await rosbridgeService.getRobotPose();
    
    res.json({
      supply: {
        state: 'idle', // 需要从实际话题获取
        status: '系统已初始化',
        lastUpdate: new Date().toISOString()
      },
      task: {
        state: 'idle', // 需要从实际话题获取
        status: '等待任务',
        lastUpdate: new Date().toISOString()
      },
      perception: {
        arucoDetected: false, // 需要从实际话题获取
        arucoPose: null,
        aligned: false,
        approaching: false,
        distance: 0,
        lastUpdate: new Date().toISOString()
      },
      robot: {
        pose: robotPose,
        connected: rosbridgeService.isConnected(),
        lastUpdate: new Date().toISOString()
      },
      navigation: supplyState,
      obstacle: obstacleStatus
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch supply status' });
  }
};

// 启动补给流程
export const startSupply = async (req: Request, res: Response) => {
  try {
    // 检查当前系统模式，如果不是补给模式则切换
    const { spawn } = require('child_process');
    const fs = require('fs');
    
    const currentMode = fs.existsSync('/tmp/robot_system_mode') 
      ? fs.readFileSync('/tmp/robot_system_mode', 'utf8').trim() 
      : 'unknown';
    
    if (currentMode !== 'supply') {
      console.log(`Switching from ${currentMode} to supply mode...`);
      
      const projectDir = process.cwd();
      const switchScript = `${projectDir}/switch_mode.sh`;
      
      // 切换到补给模式
      const switchChild = spawn('bash', [switchScript, 'supply'], {
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
          console.log('Successfully switched to supply mode');
        } else {
          console.error('Failed to switch to supply mode:', stderr);
        }
      });
      
      // 等待模式切换完成
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    rosbridgeService.callService('/automation/manual_supply', 'std_srvs/Trigger', {});
    res.json({ 
      success: true, 
      message: 'Supply start command sent',
      modeSwitched: currentMode !== 'supply'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start supply' });
  }
};

// 暂停补给流程
export const pauseSupply = async (req: Request, res: Response) => {
  try {
    rosbridgeService.callService('/automation/manual_supply', 'std_srvs/Trigger', {});
    res.json({ success: true, message: 'Supply pause command sent' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to pause supply' });
  }
};

// 恢复补给流程
export const resumeSupply = async (req: Request, res: Response) => {
  try {
    rosbridgeService.callService('/automation/manual_supply', 'std_srvs/Trigger', {});
    res.json({ success: true, message: 'Supply resume command sent' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to resume supply' });
  }
};

// 停止补给流程
export const stopSupply = async (req: Request, res: Response) => {
  try {
    rosbridgeService.callService('/automation/cancel_supply', 'std_srvs/Trigger', {});
    res.json({ success: true, message: 'Supply stop command sent' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to stop supply' });
  }
};

// 暂停任务（对应 beam_position_task_node 的 /task_manager/pause_task 服务）
export const pauseTask = async (req: Request, res: Response) => {
  try {
    rosbridgeService.callService('/task_manager/pause_task', 'std_srvs/Trigger', {});
    res.json({ success: true, message: 'Task pause command sent' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to pause task' });
  }
};

// 恢复任务
export const resumeTask = async (req: Request, res: Response) => {
  try {
    rosbridgeService.callService('/task_manager/resume_task', 'std_srvs/Trigger', {});
    res.json({ success: true, message: 'Task resume command sent' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to resume task' });
  }
};

// 停止任务（对应 beam_position_task_node 的 /task_manager/stop_task 服务）
export const stopTask = async (req: Request, res: Response) => {
  try {
    rosbridgeService.callService('/task_manager/stop_task', 'std_srvs/Trigger', {});
    res.json({ success: true, message: 'Task stop command sent' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to stop task' });
  }
};

// 获取任务路径
export const getTaskPath = async (req: Request, res: Response) => {
  try {
    // 返回示例路径数据
    res.json({
      header: {
        stamp: { sec: Date.now() / 1000, nanosec: 0 },
        frame_id: "map"
      },
      poses: [
        {
          header: { frame_id: "map" },
          pose: {
            position: { x: 1.0, y: 0.0, z: 0.0 },
            orientation: { x: 0, y: 0, z: 0, w: 1 }
          }
        },
        {
          header: { frame_id: "map" },
          pose: {
            position: { x: 2.0, y: 1.0, z: 0.0 },
            orientation: { x: 0, y: 0, z: 0.382683, w: 0.92388 }
          }
        }
      ]
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch task path' });
  }
};

// 手动控制机器人
export const manualControl = async (req: Request, res: Response) => {
  try {
    const { linear_x, linear_y, angular_z } = req.body;
    rosbridgeService.publish('/manual/cmd_vel', 'geometry_msgs/Twist', {
      linear: { x: linear_x || 0, y: linear_y || 0, z: 0 },
      angular: { x: 0, y: 0, z: angular_z || 0 }
    });
    res.json({ success: true, message: 'Control command sent' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send control command' });
  }
};

// 系统性能监控
export const getSystemMetrics = async (req: Request, res: Response) => {
  try {
    // 获取CPU使用率
    const { stdout: cpuInfo } = await execAsync("top -bn1 | grep 'Cpu(s)' | sed 's/.*, *\\([0-9.]*\\)%* id.*/\\1/' | awk '{print 100 - $1}'");
    
    // 获取内存使用情况
    const { stdout: memInfo } = await execAsync("free -m | awk 'NR==2{printf \"%.2f\", $3*100/$2}'");
    
    // 获取磁盘使用情况
    const { stdout: diskInfo } = await execAsync("df -h / | awk 'NR==2{print $5}' | sed 's/%//'");

    const metrics = {
      cpu: parseFloat(cpuInfo.trim()),
      memory: parseFloat(memInfo.trim()),
      disk: parseFloat(diskInfo.trim()),
      timestamp: new Date().toISOString()
    };
    
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch system metrics' });
  }
};

// 获取节点列表和状态
export const getNodeStatus = async (req: Request, res: Response) => {
  try {
    // 返回示例节点数据
    res.json([
      { name: '/automation_manager_node', info: { subscribers: [], publishers: [], services: [], actionServers: [], actionClients: [] } },
      { name: '/beam_position_task_node', info: { subscribers: [], publishers: [], services: [], actionServers: [], actionClients: [] } },
      { name: '/spray_controller', info: { subscribers: [], publishers: [], services: [], actionServers: [], actionClients: [] } },
      { name: '/aruco_pose_estimator_node', info: { subscribers: [], publishers: [], services: [], actionServers: [], actionClients: [] } },
      { name: '/water_level_monitor_node', info: { subscribers: [], publishers: [], services: [], actionServers: [], actionClients: [] } }
    ]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch node status' });
  }
};

// 水位监控状态
interface WaterLevelData {
  level_cm: number;
  percentage: number;
  status: 'critical' | 'low' | 'normal' | 'high';
  timestamp: number;
  hardware_connected: boolean;
}

// 全局水位状态缓存
let latestWaterLevel: WaterLevelData | null = null;

// 获取水位状态
export const getWaterLevelStatus = async (req: Request, res: Response) => {
  try {
    // 返回缓存的水位状态
    const waterLevel = latestWaterLevel || {
      level_cm: 0,
      percentage: 0,
      status: 'normal' as const,
      timestamp: Date.now() / 1000,
      hardware_connected: false
    };
    
    res.json({
      water: waterLevel,
      lastUpdate: new Date(waterLevel.timestamp * 1000).toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch water level status' });
  }
};

// 获取水位历史数据（最近24小时）
export const getWaterLevelHistory = async (req: Request, res: Response) => {
  try {
    // 返回示例历史数据
    const history = [];
    const now = Date.now();
    
    // 生成最近24小时的数据点（每小时一个）
    for (let i = 24; i >= 0; i--) {
      const timestamp = now - i * 3600 * 1000;
      const percentage = 50 + Math.random() * 40; // 50-90% 之间的随机值
      const level_cm = 5 + (percentage / 100) * 91; // 5-96cm 之间的对应值
      
      let status: 'critical' | 'low' | 'normal' | 'high';
      if (percentage < 10) {
        status = 'critical';
      } else if (percentage < 30) {
        status = 'low';
      } else if (percentage < 80) {
        status = 'normal';
      } else {
        status = 'high';
      }
      
      history.push({
        timestamp: timestamp / 1000,
        level_cm: Math.round(level_cm * 100) / 100,
        percentage: Math.round(percentage * 10) / 10,
        status
      });
    }
    
    res.json({
      history,
      count: history.length
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch water level history' });
  }
};

// 导出更新水位状态的函数（供rosbridgeService调用）
export const updateWaterLevelStatus = (data: WaterLevelData) => {
  latestWaterLevel = data;
};

// ==================== 补水站继电器控制 ====================

interface RelayStatus {
  status: string;
  relay: boolean;
  mode: number;
  ip: string;
  apIp: string;
}

interface WifiInfo {
  status: string;
  sta: {
    connected: boolean;
    ssid: string;
    ip: string;
  };
  ap: {
    ssid: string;
    ip: string;
    stations: number;
  };
}

// 获取补水站继电器状态
export const getRelayStatus = async (req: Request, res: Response) => {
  try {
    const { relayIp } = req.query;
    const ipAddress = relayIp || process.env.RELAY_IP || '192.168.4.1';
    
    console.log('[Relay Status] Received params:', req.query);
    console.log('[Relay Status] Using IP:', ipAddress);
    
    // 设置3秒超时（减少超时时间，避免前端超时）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    
    const response = await fetch(`http://${ipAddress}/relay/status`, {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json() as RelayStatus;
    
    // 添加设备连接状态
    res.json({
      ...data,
      connected: true,
      ip: ipAddress,
      lastUpdate: new Date().toISOString()
    });
  } catch (error: any) {
    // 只在特定情况下输出错误日志，减少日志 spam
    if (error.name !== 'AbortError' && error.message !== 'fetch failed') {
      console.error('[Relay Status] Failed to connect to', req.query.relayIp || process.env.RELAY_IP || '192.168.4.1', ':', error.message);
    }
    
    // 返回设备离线状态
    const ipAddress = req.query.relayIp || process.env.RELAY_IP || '192.168.4.1';
    res.json({
      status: 'error',
      relay: false,
      mode: 0,
      ip: ipAddress,
      apIp: '',
      connected: false,
      error: error.name === 'AbortError' ? 'Connection timeout' : error.message,
      lastUpdate: new Date().toISOString()
    });
  }
};

// 打开补水站继电器（开始注水）
export const startWateringRelay = async (req: Request, res: Response) => {
  try {
    const { relayIp } = req.body;
    const ipAddress = relayIp || process.env.RELAY_IP || '192.168.4.1';
    
    const response = await fetch(`http://${ipAddress}/relay/on`);
    const data = await response.json() as RelayStatus;
    
    if (data.status === 'success') {
      res.json({ success: true, message: '补水站继电器已打开，开始注水', relay: true });
    } else {
      res.status(500).json({ error: 'Failed to open relay', relay: false });
    }
  } catch (error) {
    console.error('Failed to open relay:', error);
    res.status(500).json({ error: 'Failed to open relay', relay: false });
  }
};

// 关闭补水站继电器（停止注水）
export const stopWateringRelay = async (req: Request, res: Response) => {
  try {
    const { relayIp } = req.body;
    const ipAddress = relayIp || process.env.RELAY_IP || '192.168.4.1';
    
    const response = await fetch(`http://${ipAddress}/relay/off`);
    const data = await response.json() as RelayStatus;
    
    if (data.status === 'success') {
      res.json({ success: true, message: '补水站继电器已关闭，停止注水', relay: false });
    } else {
      res.status(500).json({ error: 'Failed to close relay', relay: true });
    }
  } catch (error) {
    console.error('Failed to close relay:', error);
    res.status(500).json({ error: 'Failed to close relay', relay: true });
  }
};

// 获取补水站WiFi信息
export const getRelayWifiInfo = async (req: Request, res: Response) => {
  try {
    const { relayIp } = req.query;
    const ipAddress = relayIp || process.env.RELAY_IP || '192.168.4.1';
    
    const response = await fetch(`http://${ipAddress}/wifi/info`);
    const data = await response.json() as WifiInfo;
    
    res.json(data);
  } catch (error) {
    console.error('Failed to get relay WiFi info:', error);
    res.status(500).json({ error: 'Failed to get relay WiFi info' });
  }
};

// ==================== 充电桩Modbus控制 ====================

interface ChargingStatus {
  chargingStatus: number; // 0 未在充电 1 正在充电 2 充电完成
  brushStatus: number; // 0 已经缩回 1 正在伸出 2 正在缩回 3 已经伸出
  chargingMode: number; // 0 手动 1 自动
  batteryVoltage: number; // 电池电压*10
  chargingCurrent: number; // 充电电流(mA)
  endCurrent: number; // 充电结束电流(mA)
  heartbeat: number; // 心跳，1秒加一
  lastUpdate: string;
}

// 全局充电桩状态缓存
let latestChargingStatus: ChargingStatus | null = null;

// 获取充电桩状态
export const getChargingStatus = async (req: Request, res: Response) => {
  const startTime = Date.now();
  const { chargingIp } = req.query;
  const ipAddress = chargingIp || process.env.CHARGING_IP || '192.168.0.95';
  const port = parseInt(process.env.CHARGING_PORT || '502');
  
  console.log('[Charging Status] Received params:', req.query);
  console.log('[Charging Status] Using IP:', ipAddress, 'Port:', port);
  
  try {
    // 通过代理服务器获取充电桩状态
    const proxyUrl = `http://localhost:5001/api/charging/status?ip=${ipAddress}&port=${port}`;
    console.log('[Charging Status] Requesting via proxy:', proxyUrl);
    
    const response = await fetch(proxyUrl);
    const result = await response.json() as { success: boolean; data: any; error?: string };
    
    if (!result.success) {
      throw new Error(result.error || 'Proxy request failed');
    }
    
    const status: ChargingStatus = {
      chargingStatus: result.data.chargingStatus,
      brushStatus: result.data.brushStatus,
      batteryVoltage: result.data.batteryVoltage,
      chargingCurrent: result.data.chargingCurrent,
      endCurrent: result.data.endCurrent,
      chargingMode: result.data.chargingMode,
      heartbeat: result.data.heartbeat,
      lastUpdate: new Date().toISOString()
    };
    
    // 缓存状态
    latestChargingStatus = status;
    
    const elapsed = Date.now() - startTime;
    console.log('[Charging Status] Success! Elapsed:', elapsed, 'ms');
    
    res.json({
      ...status,
      connected: true,
      ipAddress,
      port,
      responseTime: elapsed
    });
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    console.error('[Charging Status] Failed after', elapsed, 'ms:', error.message);
    
    // 返回设备离线状态
    res.json({
      chargingStatus: 0,
      brushStatus: 0,
      chargingMode: 0,
      batteryVoltage: 0,
      chargingCurrent: 0,
      endCurrent: 0,
      heartbeat: 0,
      lastUpdate: new Date().toISOString(),
      connected: false,
      error: error.message || 'Unknown error',
      ipAddress,
      port,
      responseTime: elapsed
    });
  }
};

// 开始充电
export const startCharging = async (req: Request, res: Response) => {
  const { chargingIp } = req.body;
  const ipAddress = chargingIp || process.env.CHARGING_IP || '192.168.0.95';
  const port = parseInt(process.env.CHARGING_PORT || '502');
  
  console.log('[Start Charging] IP:', ipAddress, 'Port:', port);
  
  try {
    // 通过代理服务器开始充电
    const proxyUrl = 'http://localhost:5001/api/charging/start';
    console.log('[Start Charging] Requesting via proxy:', proxyUrl);
    
    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ip: ipAddress, port })
    });
    
    const result = await response.json() as { success: boolean; error?: string };
    
    if (!result.success) {
      throw new Error(result.error || 'Proxy request failed');
    }
    
    console.log('[Start Charging] Success');
    res.json({ success: true, message: '充电桩已启动' });
  } catch (error: any) {
    console.error('[Start Charging] Failed:', error.message);
    res.status(500).json({ 
      error: 'Failed to start charging', 
      message: error.message,
      ipAddress,
      port
    });
  }
};

// 停止充电
export const stopCharging = async (req: Request, res: Response) => {
  const { chargingIp } = req.body;
  const ipAddress = chargingIp || process.env.CHARGING_IP || '192.168.0.95';
  const port = parseInt(process.env.CHARGING_PORT || '502');
  
  console.log('[Stop Charging] IP:', ipAddress, 'Port:', port);
  
  try {
    // 通过代理服务器停止充电
    const proxyUrl = 'http://localhost:5001/api/charging/stop';
    console.log('[Stop Charging] Requesting via proxy:', proxyUrl);
    
    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ip: ipAddress, port })
    });
    
    const result = await response.json() as { success: boolean; error?: string };
    
    if (!result.success) {
      throw new Error(result.error || 'Proxy request failed');
    }
    
    console.log('[Stop Charging] Success');
    res.json({ success: true, message: '充电桩已停止' });
  } catch (error: any) {
    console.error('[Stop Charging] Failed:', error.message);
    res.status(500).json({ 
      error: 'Failed to stop charging', 
      message: error.message,
      ipAddress,
      port
    });
  }
};

// 导出更新充电状态的函数（供rosbridgeService调用）
export const updateChargingStatus = (data: Partial<ChargingStatus>) => {
  if (latestChargingStatus) {
    latestChargingStatus = { ...latestChargingStatus, ...data, lastUpdate: new Date().toISOString() };
  } else {
    latestChargingStatus = {
      chargingStatus: 0,
      brushStatus: 0,
      chargingMode: 0,
      batteryVoltage: 0,
      chargingCurrent: 0,
      endCurrent: 0,
      heartbeat: 0,
      lastUpdate: new Date().toISOString(),
      ...data
    };
  }
};