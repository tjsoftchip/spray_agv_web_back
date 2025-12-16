import { Response } from 'express';
import { Task } from '../models';
import { AuthRequest } from '../middleware/auth';

export const getTasks = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const tasks = await Task.findAll({
      where: { isDeleted: false },
      order: [['priority', 'DESC'], ['createdAt', 'DESC']],
    });
    res.json(tasks);
  } catch (error) {
    console.error('Get tasks error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getTaskById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const task = await Task.findByPk(id);
    
    if (!task || task.isDeleted) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    res.json(task);
  } catch (error) {
    console.error('Get task error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const createTask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const taskData = {
      ...req.body,
      createdBy: req.user?.username || 'unknown',
    };
    
    const task = await Task.create(taskData);
    res.status(201).json(task);
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateTask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const task = await Task.findByPk(id);
    
    if (!task || task.isDeleted) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    await task.update(req.body);
    res.json(task);
  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deleteTask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const task = await Task.findByPk(id);
    
    if (!task || task.isDeleted) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    await task.update({ isDeleted: true });
    res.json({ message: 'Task deleted successfully' });
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const executeTask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const task = await Task.findByPk(id);
    
    if (!task || task.isDeleted) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    await task.update({
      status: 'running',
      startTime: new Date(),
    });

    // 获取模板数据并启动导航
    if (task.templateIds && task.templateIds.length > 0) {
      const template = await require('../models').Template.findByPk(task.templateIds[0]);
      if (template && template.navigationPoints && template.navigationPoints.length > 0) {
        const rosbridgeService = require('../services/rosbridgeService').default;
        
        // 构建导航序列
        const navigationSequence = template.navigationPoints.map((point: any, index: number) => ({
          pointId: point.id,
          pointName: point.name,
          position: point.position,
          orientation: point.orientation,
          navigationParams: point.navigationParams || {},
          actionOnArrival: point.actionOnArrival || 'none',
          order: index,
        }));
        
        // 更新任务的导航序列
        await task.update({
          navigationSequence,
          currentNavigationIndex: 0,
        });
        
        // 发送导航任务到ROS2导航管理节点
        const navigationMessage = {
          task_id: task.id,
          waypoints: navigationSequence.map((point: any) => ({
            name: point.pointName,
            pose: {
              position: point.position,
              orientation: point.orientation,
            },
            params: point.navigationParams,
            action: point.actionOnArrival,
          })),
          start_from_index: 0,
        };
        
        rosbridgeService.publish('/navigation_task/command', 'std_msgs/String', {
          data: JSON.stringify({
            command: 'start',
            ...navigationMessage,
          })
        });
        
        console.log('Navigation task started:', navigationMessage);
      }
    }

    res.json({ message: 'Task execution started', task });
  } catch (error) {
    console.error('Execute task error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const pauseTask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const task = await Task.findByPk(id);
    
    if (!task || task.isDeleted) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    if (task.status !== 'running') {
      res.status(400).json({ error: 'Task is not running' });
      return;
    }

    await task.update({ status: 'paused' });
    
    // 发送暂停命令到ROS2
    const rosbridgeService = require('../services/rosbridgeService').default;
    rosbridgeService.publish('/navigation_task/command', 'std_msgs/String', {
      data: JSON.stringify({
        command: 'pause',
        task_id: task.id,
      })
    });
    
    res.json({ message: 'Task paused', task });
  } catch (error) {
    console.error('Pause task error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const resumeTask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const task = await Task.findByPk(id);
    
    if (!task || task.isDeleted) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    if (task.status !== 'paused') {
      res.status(400).json({ error: 'Task is not paused' });
      return;
    }

    await task.update({ status: 'running' });
    
    // 发送恢复命令到ROS2
    const rosbridgeService = require('../services/rosbridgeService').default;
    rosbridgeService.publish('/navigation_task/command', 'std_msgs/String', {
      data: JSON.stringify({
        command: 'resume',
        task_id: task.id,
      })
    });
    
    res.json({ message: 'Task resumed', task });
  } catch (error) {
    console.error('Resume task error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const stopTask = async (req: AuthRequest, res: Response): Promise<void> => {

  try {

    const { id } = req.params;

    const task = await Task.findByPk(id);

    

    if (!task || task.isDeleted) {

      res.status(404).json({ error: 'Task not found' });

      return;

    }



    if (task.status !== 'running' && task.status !== 'paused') {

      res.status(400).json({ error: 'Task is not running or paused' });

      return;

    }



    await task.update({ 

      status: 'completed',

      endTime: new Date(),

    });

    

    // 发送停止命令到ROS2

    const rosbridgeService = require('../services/rosbridgeService').default;

    rosbridgeService.publish('/navigation_task/command', 'std_msgs/String', {

      data: JSON.stringify({

        command: 'stop',

        task_id: task.id,

      })

    });

    

        res.json({ message: 'Task stopped', task });

    

      } catch (error) {

    

        console.error('Stop task error:', error);

    

        res.status(500).json({ error: 'Internal server error' });

    

      }

    

    };

    

    

    

    export const updateTaskOrder = async (req: AuthRequest, res: Response): Promise<void> => {

    

      try {

    

        const orderUpdates: Array<{ id: string; order: number }> = req.body;

    

    

    

        if (!Array.isArray(orderUpdates)) {

    

          res.status(400).json({ error: 'Invalid request body' });

    

          return;

    

        }

    

    

    

            // 批量更新任务顺序

    

    

    

            await Promise.all(

    

    

    

              orderUpdates.map(({ id, order }) =>

    

    

    

                Task.update({ order } as any, { where: { id } })

    

    

    

              )

    

    

    

            );

    

    

    

        res.json({ message: 'Task order updated successfully' });

    

      } catch (error) {

    

        console.error('Update task order error:', error);

    

        res.status(500).json({ error: 'Internal server error' });

    

      }

    

    };
