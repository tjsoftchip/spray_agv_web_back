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
    rosbridgeService.callService('/supply_manager/start_supply', 'std_srvs/Trigger', {});
    res.json({ success: true, message: 'Supply start command sent' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start supply' });
  }
};

// 暂停补给流程
export const pauseSupply = async (req: Request, res: Response) => {
  try {
    rosbridgeService.callService('/supply_manager/pause_supply', 'std_srvs/Trigger', {});
    res.json({ success: true, message: 'Supply pause command sent' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to pause supply' });
  }
};

// 恢复补给流程
export const resumeSupply = async (req: Request, res: Response) => {
  try {
    rosbridgeService.callService('/supply_manager/resume_supply', 'std_srvs/Trigger', {});
    res.json({ success: true, message: 'Supply resume command sent' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to resume supply' });
  }
};

// 停止补给流程
export const stopSupply = async (req: Request, res: Response) => {
  try {
    rosbridgeService.callService('/supply_manager/stop_supply', 'std_srvs/Trigger', {});
    res.json({ success: true, message: 'Supply stop command sent' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to stop supply' });
  }
};

// 创建任务
export const createTask = async (req: Request, res: Response) => {
  try {
    rosbridgeService.callService('/task_manager/create_task', 'std_srvs/Trigger', {});
    res.json({ success: true, message: 'Task creation command sent' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create task' });
  }
};

// 启动任务
export const startTask = async (req: Request, res: Response) => {
  try {
    rosbridgeService.callService('/task_manager/start_task', 'std_srvs/Trigger', {});
    res.json({ success: true, message: 'Task start command sent' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start task' });
  }
};

// 暂停任务
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

// 保存任务状态
export const saveTask = async (req: Request, res: Response) => {
  try {
    rosbridgeService.callService('/task_manager/save_task', 'std_srvs/Trigger', {});
    res.json({ success: true, message: 'Task save command sent' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save task' });
  }
};

// 加载任务状态
export const loadTask = async (req: Request, res: Response) => {
  try {
    rosbridgeService.callService('/task_manager/load_task', 'std_srvs/Trigger', {});
    res.json({ success: true, message: 'Task load command sent' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load task' });
  }
};

// 停止任务
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
    rosbridgeService.publish('/cmd_vel', 'geometry_msgs/Twist', {
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
      { name: '/supply_manager_node', info: { subscribers: [], publishers: [], services: [], actionServers: [], actionClients: [] } },
      { name: '/task_manager_node', info: { subscribers: [], publishers: [], services: [], actionServers: [], actionClients: [] } },
      { name: '/aruco_pose_estimator_node', info: { subscribers: [], publishers: [], services: [], actionServers: [], actionClients: [] } }
    ]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch node status' });
  }
};