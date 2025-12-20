import { Response } from 'express';
import { Task } from '../models';
import { AuthRequest } from '../middleware/auth';
import { Op } from 'sequelize';

export const executeTaskSequence = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    console.log('[TaskSequence] 开始执行任务序列');
    
    // 获取所有待执行的任务，按优先级和创建时间排序
    const tasks = await Task.findAll({
      where: { 
        status: 'pending',
        isDeleted: false 
      },
      order: [['priority', 'DESC'], ['createdAt', 'ASC']],
    });

    if (tasks.length === 0) {
      res.json({ message: '没有待执行的任务' });
      return;
    }

    console.log(`[TaskSequence] 找到 ${tasks.length} 个待执行任务`);

    // 获取rosbridge服务
    const rosbridgeService = require('../services/rosbridgeService').default;
    
    if (!rosbridgeService.isConnected()) {
      res.status(503).json({ error: 'ROS bridge not connected' });
      return;
    }

    // 记录第一个任务的初始位置（用于最后返回）
    const firstTaskInitialPosition = tasks[0].initialPosition;
    
    // 执行任务序列
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      console.log(`[TaskSequence] 执行任务 ${i + 1}/${tasks.length}: ${task.name}`);

      try {
        // 更新任务状态为运行中
        await task.update({ 
          status: 'running',
          startTime: new Date()
        });

        // 如果是第一个任务，先导航到初始位置
        if (i === 0 && task.initialPosition) {
          console.log('[TaskSequence] 导航到初始位置:', task.initialPosition);
          await navigateToPosition(rosbridgeService, task.initialPosition);
          
          // 等待到达初始位置
          await waitForArrival(rosbridgeService, 30000); // 等待30秒
        }

        // 执行任务内容
        await executeTaskContent(rosbridgeService, task);

        // 更新任务状态为已完成
        await task.update({ 
          status: 'completed',
          endTime: new Date(),
          progress: 100
        });

        console.log(`[TaskSequence] 任务 ${task.name} 完成`);

        // 如果不是最后一个任务，等待一段时间再继续
        if (i < tasks.length - 1) {
          console.log('[TaskSequence] 等待5秒后执行下一个任务');
          await new Promise(resolve => setTimeout(resolve, 5000));
        }

      } catch (error) {
        console.error(`[TaskSequence] 任务 ${task.name} 执行失败:`, error);
        
        // 更新任务状态为失败
        await task.update({ 
          status: 'failed',
          endTime: new Date()
        });
        
        // 继续执行下一个任务
        continue;
      }
    }

    // 所有任务完成后，返回第一个任务的初始位置
    if (firstTaskInitialPosition) {
      console.log('[TaskSequence] 返回初始位置:', firstTaskInitialPosition);
      await navigateToPosition(rosbridgeService, firstTaskInitialPosition);
    }

    res.json({ 
      message: '任务序列执行完成',
      executedTasks: tasks.length,
      returnedToStart: !!firstTaskInitialPosition
    });

  } catch (error) {
    console.error('[TaskSequence] 执行任务序列失败:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 导航到指定位置
async function navigateToPosition(rosbridgeService: any, position: { x: number; y: number; theta: number }) {
  return new Promise((resolve, reject) => {
    console.log('[Navigate] 导航到位置:', position);
    
    // 将角度转换为四元数
    const halfYaw = position.theta / 2;
    const w = Math.cos(halfYaw);
    const z = Math.sin(halfYaw);

    // 发布导航目标
    const goal = {
      header: {
        stamp: { sec: 0, nanosec: 0 },
        frame_id: 'map'
      },
      pose: {
        position: {
          x: position.x,
          y: position.y,
          z: 0.0
        },
        orientation: {
          x: 0.0,
          y: 0.0,
          z: z,
          w: w
        }
      }
    };

    // 发布到导航目标话题
    rosbridgeService.publish('/goal_pose', 'geometry_msgs/PoseStamped', goal);
    
    // 设置超时
    setTimeout(() => {
      resolve(null);
    }, 1000);
  });
}

// 等待到达目标位置
async function waitForArrival(rosbridgeService: any, timeoutMs: number) {
  return new Promise((resolve) => {
    console.log('[Wait] 等待到达目标位置');
    
    let messageHandler: any;
    let timeoutId: NodeJS.Timeout;
    
    const cleanup = () => {
      if (messageHandler) {
        rosbridgeService.rosbridge?.removeListener('message', messageHandler);
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
    
    // 监听导航状态
    messageHandler = (data: any) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.topic === '/navigation_task/status' && message.msg) {
          const statusData = JSON.parse(message.msg.data);
          
          if (statusData.status === 'goal_reached') {
            console.log('[Wait] 到达目标位置');
            cleanup();
            resolve(null);
          }
        }
      } catch (error) {
        // 忽略解析错误
      }
    };
    
    if (rosbridgeService.rosbridge) {
      rosbridgeService.rosbridge.on('message', messageHandler);
      rosbridgeService.subscribeTopic('/navigation_task/status', 'std_msgs/String');
    }
    
    // 设置超时
    timeoutId = setTimeout(() => {
      console.log('[Wait] 等待超时');
      cleanup();
      resolve(null);
    }, timeoutMs);
  });
}

// 执行任务内容
async function executeTaskContent(rosbridgeService: any, task: any) {
  console.log('[Execute] 执行任务内容:', task.name);
  
  // 这里可以根据模板ID执行具体的作业内容
  // 例如：导航到各个路段，执行喷淋作业等
  
  // 模拟执行时间
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  console.log('[Execute] 任务内容执行完成');
}

export const setInitialPositionAndExecute = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { taskId, initialPosition } = req.body;
    
    const task = await Task.findByPk(taskId);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    // 更新任务的初始位置
    await task.update({ initialPosition });
    
    // 获取rosbridge服务
    const rosbridgeService = require('../services/rosbridgeService').default;
    
    if (!rosbridgeService.isConnected()) {
      res.status(503).json({ error: 'ROS bridge not connected' });
      return;
    }

    // 设置初始位置
    await navigateToPosition(rosbridgeService, initialPosition);
    
    // 等待到达初始位置
    await waitForArrival(rosbridgeService, 30000);
    
    // 执行任务
    await executeTaskContent(rosbridgeService, task);
    
    // 更新任务状态
    await task.update({ 
      status: 'completed',
      endTime: new Date(),
      progress: 100
    });
    
    res.json({ message: '任务执行完成' });
    
  } catch (error) {
    console.error('[SetInitialAndExecute] 执行失败:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};