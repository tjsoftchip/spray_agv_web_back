import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { Task, NavigationPoint } from '../models';
import rosbridgeService from '../services/rosbridgeService';

export const startNavigation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { taskId, startFromPoint = 0 } = req.body;
    
    const task = await Task.findByPk(taskId);
    if (!task || task.isDeleted) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    // 检查当前系统模式，如果不是导航模式则切换
    const { spawn } = require('child_process');
    const fs = require('fs');
    
    const currentMode = fs.existsSync('/tmp/robot_system_mode') 
      ? fs.readFileSync('/tmp/robot_system_mode', 'utf8').trim() 
      : 'unknown';
    
    if (currentMode !== 'navigation') {
      console.log(`Switching from ${currentMode} to navigation mode...`);
      
      const projectDir = process.cwd();
      const switchScript = `${projectDir}/switch_mode.sh`;
      
      // 切换到导航模式
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
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    if (!task.navigationSequence || task.navigationSequence.length === 0) {
      res.status(400).json({ error: 'Task has no navigation sequence' });
      return;
    }

    // 切换速度命令路由到导航模式
    console.log('[Start Navigation] Switching cmd_vel_mux to navigation mode...');
    try {
      await rosbridgeService.callServiceAsync('/cmd_vel_mux/switch', 'std_srvs/SetBool', { data: false });
      console.log('[Start Navigation] Successfully switched cmd_vel_mux to navigation mode');
    } catch (muxError) {
      console.error('[Start Navigation] Failed to switch cmd_vel_mux:', muxError);
      // 继续执行导航任务，不因为速度路由切换失败而中断
    }

    const startData = {
      taskId: task.id,
      navigationSequence: task.navigationSequence,
      startFromPoint,
    };

    rosbridgeService.publish('/navigation_task/start', 'std_msgs/String', {
      data: JSON.stringify(startData),
    });

    await task.update({
      status: 'running',
      startTime: new Date(),
      currentNavigationIndex: startFromPoint,
    });

    res.json({
      success: true,
      message: 'Navigation started',
      taskId: task.id,
      modeSwitched: currentMode !== 'navigation'
    });
  } catch (error) {
    console.error('Start navigation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const pauseNavigation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { taskId } = req.body;
    
    const task = await Task.findByPk(taskId);
    if (!task || task.isDeleted) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    rosbridgeService.publish('/navigation_task/pause', 'std_msgs/Empty', {});

    await task.update({ status: 'paused' });

    res.json({
      success: true,
      message: 'Navigation paused',
    });
  } catch (error) {
    console.error('Pause navigation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const resumeNavigation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { taskId } = req.body;
    
    const task = await Task.findByPk(taskId);
    if (!task || task.isDeleted) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    rosbridgeService.publish('/navigation_task/resume', 'std_msgs/Empty', {});

    await task.update({ status: 'running' });

    res.json({
      success: true,
      message: 'Navigation resumed',
    });
  } catch (error) {
    console.error('Resume navigation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const stopNavigation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { taskId } = req.body;
    
    const task = await Task.findByPk(taskId);
    if (!task || task.isDeleted) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    rosbridgeService.publish('/navigation_task/stop', 'std_msgs/Empty', {});

    await task.update({
      status: 'completed',
      endTime: new Date(),
    });

    res.json({
      success: true,
      message: 'Navigation stopped',
    });
  } catch (error) {
    console.error('Stop navigation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getNavigationStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { taskId } = req.params;
    
    const task = await Task.findByPk(taskId);
    if (!task || task.isDeleted) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const currentPoint = task.navigationSequence && task.currentNavigationIndex !== undefined
      ? task.navigationSequence[task.currentNavigationIndex]
      : null;

    res.json({
      taskId: task.id,
      status: task.status,
      currentIndex: task.currentNavigationIndex || 0,
      totalPoints: task.navigationSequence?.length || 0,
      progress: task.progress,
      currentPoint,
      startTime: task.startTime,
      endTime: task.endTime,
    });
  } catch (error) {
    console.error('Get navigation status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const gotoPoint = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { pointId } = req.body;

    console.log('[Goto Point Request]', { pointId, body: req.body });

    if (!pointId) {
      res.status(400).json({ error: 'Missing required parameter: pointId' });
      return;
    }

    const point = await NavigationPoint.findByPk(pointId);

    if (!point) {
      console.log('[Goto Point Error] Navigation point not found:', pointId);
      res.status(404).json({ error: 'Navigation point not found' });
      return;
    }

    let positionObj, orientationObj;
    if (typeof point.position === 'string') {
      positionObj = JSON.parse(point.position);
    } else {
      positionObj = point.position;
    }

    if (typeof point.orientation === 'string') {
      orientationObj = JSON.parse(point.orientation);
    } else {
      orientationObj = point.orientation;
    }

    const testTask = {
      taskId: `test_${Date.now()}`,
      navigationSequence: [{
        pointId: point.id,
        name: point.name,
        position: positionObj,
        orientation: orientationObj,
        status: 'pending',
      }],
      startFromPoint: 0,
    };

    console.log('[Goto Point] Publishing navigation task:', testTask);

    try {
      console.log('[Goto Point] Switching cmd_vel_mux to navigation mode...');
      try {
        await rosbridgeService.callServiceAsync('/cmd_vel_mux/switch', 'std_srvs/SetBool', { data: false });
        console.log('[Goto Point] Successfully switched cmd_vel_mux to navigation mode');
      } catch (muxError) {
        console.error('[Goto Point] Failed to switch cmd_vel_mux:', muxError);
      }

      rosbridgeService.publish('/navigation_task/start', 'std_msgs/String', {
        data: JSON.stringify(testTask),
      });
      console.log('[Goto Point] Navigation task published successfully');
    } catch (rosError) {
      console.error('[Goto Point Error] Failed to publish to ROS:', rosError);
      res.status(500).json({ error: 'Failed to publish navigation task to ROS' });
      return;
    }

    res.json({
      success: true,
      message: 'Navigation to point started',
      point: {
        id: point.id,
        name: point.name,
        position: point.position,
      },
    });
  } catch (error) {
    console.error('[Goto Point Error] Unexpected error:', error);
    res.status(500).json({ error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' });
  }
};

export const setInitialPose = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { x, y, theta } = req.body;

    const poseData = {
      header: {
        frame_id: 'map',
        stamp: {
          sec: Math.floor(Date.now() / 1000),
          nanosec: (Date.now() % 1000) * 1000000,
        },
      },
      pose: {
        pose: {
          position: { x, y, z: 0.0 },
          orientation: {
            x: 0.0,
            y: 0.0,
            z: Math.sin(theta / 2),
            w: Math.cos(theta / 2),
          },
        },
      },
    };

    rosbridgeService.publish('/initialpose', 'geometry_msgs/PoseWithCovarianceStamped', poseData);

    res.json({
      success: true,
      message: 'Initial pose set',
      pose: { x, y, theta },
    });
  } catch (error) {
    console.error('Set initial pose error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getRobotPosition = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const pose = await rosbridgeService.getRobotPose();
    if (pose && pose.position) {
      res.json({ position: pose.position });
    } else {
      res.status(404).json({ error: 'Robot position not available' });
    }
  } catch (error) {
    console.error('Get robot position error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
