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

    // 获取模板数据并发送到ROS2
    if (task.templateIds && task.templateIds.length > 0) {
      const template = await require('../models').Template.findByPk(task.templateIds[0]);
      if (template && template.navigationPoints && template.navigationPoints.length > 0) {
        const rosbridgeService = require('../services/rosbridgeService');
        
        // 发送模板执行指令到ROS2
        const templateMessage = {
          id: template.id,
          name: template.name,
          navigationPoints: template.navigationPoints,
          roadSegments: template.roadSegments || [],
          yardName: template.yardName,
          yardDimensions: template.yardDimensions,
        };
        
        rosbridgeService.publish('/execute_template', 'std_msgs/String', {
          data: JSON.stringify(templateMessage)
        });
        
        console.log('Template execution sent to ROS2:', templateMessage);
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

    res.json({ message: 'Task stopped', task });
  } catch (error) {
    console.error('Stop task error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
