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
    console.log(`[TaskController] Execute task request: ${id}`);
    
    const task = await Task.findByPk(id);
    
    if (!task || task.isDeleted) {
      console.log(`[TaskController] Task not found: ${id}`);
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    console.log(`[TaskController] Task found, calling execution service`);
    
    // 使用任务执行服务来处理完整的执行流程
    const taskExecutionService = require('../services/taskExecutionService').default;
    await taskExecutionService.executeTask(id);

    // 重新获取任务以获取最新状态
    const updatedTask = await Task.findByPk(id);
    
    console.log(`[TaskController] Task execution started successfully`);
    res.json({ message: 'Task execution started', task: updatedTask });
  } catch (error: any) {
    console.error('[TaskController] Execute task error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message || 'Unknown error',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

export const pauseTask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const taskExecutionService = require('../services/taskExecutionService').default;
    await taskExecutionService.pauseTask(id);
    
    const task = await Task.findByPk(id);
    res.json({ message: 'Task paused', task });
  } catch (error: any) {
    console.error('Pause task error:', error);
    res.status(error.message === 'Task is not running' ? 400 : 500).json({ 
      error: error.message || 'Internal server error' 
    });
  }
};

export const resumeTask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const taskExecutionService = require('../services/taskExecutionService').default;
    await taskExecutionService.resumeTask(id);
    
    const task = await Task.findByPk(id);
    res.json({ message: 'Task resumed', task });
  } catch (error: any) {
    console.error('Resume task error:', error);
    res.status(error.message === 'Task is not paused' ? 400 : 500).json({ 
      error: error.message || 'Internal server error' 
    });
  }
};

export const stopTask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const taskExecutionService = require('../services/taskExecutionService').default;
    await taskExecutionService.stopTask(id);
    
    const task = await Task.findByPk(id);
    res.json({ message: 'Task stopped', task });
  } catch (error: any) {
    console.error('Stop task error:', error);
    res.status(error.message === 'Task is not running or paused' ? 400 : 500).json({ 
      error: error.message || 'Internal server error' 
    });
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
