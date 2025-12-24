import { Request, Response } from 'express';
import rosbridgeService from '../services/rosbridgeService';

export const getRobotStatus = async (req: Request, res: Response) => {
  try {
    res.json({
      connected: rosbridgeService.isConnected(),
      position: { x: 0, y: 0, z: 0 },
      battery: 85,
      waterLevel: 70,
      mode: 'auto',
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get robot status' });
  }
};

export const controlMotion = async (req: Request, res: Response) => {
  try {
    const { linear, angular } = req.body;
    
    rosbridgeService.publish('/manual/cmd_vel', 'geometry_msgs/Twist', {
      linear: { x: linear.x || 0, y: linear.y || 0, z: linear.z || 0 },
      angular: { x: angular.x || 0, y: angular.y || 0, z: angular.z || 0 },
    });

    res.json({ message: 'Motion command sent' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to control motion' });
  }
};

export const stopMotion = async (req: Request, res: Response) => {
  try {
    rosbridgeService.publish('/manual/cmd_vel', 'geometry_msgs/Twist', {
      linear: { x: 0, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: 0 },
    });

    res.json({ message: 'Robot stopped' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to stop robot' });
  }
};

export const controlSpray = async (req: Request, res: Response) => {
  try {
    const { pump, leftArm, rightArm, leftValve, rightValve, height } = req.body;

    if (pump !== undefined) {
      rosbridgeService.publish('/spray/pump_control', 'std_msgs/Bool', { data: pump });
    }
    if (leftArm !== undefined) {
      rosbridgeService.publish('/spray/left_arm_control', 'std_msgs/String', { data: leftArm });
    }
    if (rightArm !== undefined) {
      rosbridgeService.publish('/spray/right_arm_control', 'std_msgs/String', { data: rightArm });
    }
    if (leftValve !== undefined) {
      rosbridgeService.publish('/spray/left_valve_control', 'std_msgs/Bool', { data: leftValve });
    }
    if (rightValve !== undefined) {
      rosbridgeService.publish('/spray/right_valve_control', 'std_msgs/Bool', { data: rightValve });
    }
    if (height !== undefined) {
      rosbridgeService.publish('/spray/height_control', 'std_msgs/Float32', { data: height });
    }

    res.json({ message: 'Spray control command sent' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to control spray' });
  }
};

export const startNavigation = async (req: Request, res: Response) => {
  try {
    const { spawn } = require('child_process');
    const fs = require('fs');
    
    console.log('Starting navigation using system manager...');
    
    // 使用模式切换系统启动导航模式
    const projectDir = process.env.PROJECT_DIR || '/home/jetson/yahboomcar_ros2_ws';
    const switchScript = `${projectDir}/switch_mode.sh`;
    
    // 先检查当前模式
    let currentMode = 'unknown';
    if (fs.existsSync('/tmp/robot_system_mode')) {
      currentMode = fs.readFileSync('/tmp/robot_system_mode', 'utf8').trim();
    }
    
    // 如果不是导航模式，先切换到导航模式
    if (currentMode !== 'navigation') {
      console.log('Switching to navigation mode...');
      
      const switchChild = spawn('bash', [switchScript, 'navigation'], {
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
          console.log('Successfully switched to navigation mode');
        } else {
          console.error('Failed to switch to navigation mode:', stderr);
        }
      });
      
      // 等待模式切换完成
      await new Promise(resolve => setTimeout(resolve, 8000));
      
      // 更新系统模式文件
      fs.writeFileSync('/tmp/robot_system_mode', 'navigation');
    }
    
    // 如果提供了导航目标，发送目标点
    if (req.body.goal) {
      const { goal } = req.body;
      
      // 获取当前时间戳
      const now = Date.now();
      const sec = Math.floor(now / 1000);
      const nanosec = (now % 1000) * 1000000;
      
      // 使用话题发布导航目标
      const goalMessage = {
        header: {
          stamp: { sec, nanosec },
          frame_id: 'map'
        },
        pose: {
          position: {
            x: goal.position?.x || 0,
            y: goal.position?.y || 0,
            z: goal.position?.z || 0
          },
          orientation: {
            x: goal.orientation?.x || 0,
            y: goal.orientation?.y || 0,
            z: goal.orientation?.z || 0,
            w: goal.orientation?.w || 1
          }
        }
      };
      
      // 发布导航目标到Nav2
      rosbridgeService.publish('/goal_pose', 'geometry_msgs/PoseStamped', goalMessage);
      
      console.log('Navigation mode started and goal sent');
      
      res.json({ 
        message: '导航模式已启动，目标点已发送',
        mode: 'navigation',
        goal: goalMessage,
        timestamp: new Date().toISOString()
      });
    } else {
      // 只切换模式，不发送目标
      console.log('Navigation mode started without goal');
      
      res.json({ 
        message: '导航模式已启动',
        mode: 'navigation',
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    console.error('Error starting navigation:', error);
    res.status(500).json({ error: 'Failed to start navigation' });
  }
};

export const stopNavigation = async (req: Request, res: Response) => {
  try {
    const { spawn } = require('child_process');
    
    console.log('Stopping navigation using system manager...');
    
    // 使用模式切换系统退出导航模式，切换到待机模式
    const projectDir = process.env.PROJECT_DIR || '/home/jetson/yahboomcar_ros2_ws';
    const switchScript = `${projectDir}/switch_mode.sh`;
    
    // 先取消当前导航任务
    try {
      rosbridgeService.callService('/cancel_navigation', 'std_srvs/Empty', {});
    } catch (error) {
      console.log('Navigation service not available, proceeding with mode switch');
    }
    
    // 切换到待机模式，停止所有导航相关节点
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
        console.log('Successfully switched to idle mode from navigation');
      } else {
        console.error('Failed to switch to idle mode:', stderr);
      }
    });
    
    // 等待模式切换完成
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // 更新系统模式文件
    const fs = require('fs');
    fs.writeFileSync('/tmp/robot_system_mode', 'idle');
    
    console.log('Navigation mode stopped successfully via system manager');
    
    res.json({ 
      message: '导航已停止，已切换到待机模式',
      mode: 'idle',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error stopping navigation:', error);
    res.status(500).json({ error: 'Failed to stop navigation' });
  }
};

// 紧急停止控制
export const emergencyStop = async (req: Request, res: Response) => {
  try {
    const { action } = req.body; // 'stop' 或 'reset'
    
    if (action === 'stop') {
      // 触发紧急停止
      const result = await rosbridgeService.callService('/emergency_stop', 'std_srvs/SetBool', { data: true });
      
      res.json({
        success: true,
        message: '紧急停止已激活 - 所有运动和喷淋已停止',
        timestamp: new Date().toISOString(),
        action: 'stop'
      });
      
    } else if (action === 'reset') {
      // 复位紧急停止
      const result = await rosbridgeService.callService('/emergency_stop', 'std_srvs/SetBool', { data: false });
      
      res.json({
        success: true,
        message: '紧急停止已复位 - 系统可正常操作',
        timestamp: new Date().toISOString(),
        action: 'reset'
      });
      
    } else {
      res.status(400).json({ 
        success: false,
        error: '无效的操作类型，仅支持 "stop" 或 "reset"' 
      });
    }
    
  } catch (error) {
    console.error('Emergency stop error:', error);
    res.status(500).json({ 
      success: false,
      error: '紧急停止操作失败' 
    });
  }
};
