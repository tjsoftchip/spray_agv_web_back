import { Request, Response } from 'express';
import { TaskQueue } from '../models';
import rosbridgeService from '../services/rosbridgeService';

export const getTaskQueue = async (req: Request, res: Response) => {
  try {
    const queue = await TaskQueue.findOne({ where: { isActive: true } });
    if (!queue) {
      const newQueue = await TaskQueue.create({ 
        name: 'Default Queue', 
        tasks: [] as Array<{ taskId: string; order: number; status: 'pending' | 'running' | 'completed' | 'failed' }>,
        status: 'idle',
        isActive: true,
      });
      return res.json(newQueue);
    }
    res.json(queue);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch task queue' });
  }
};

export const addTaskToQueue = async (req: Request, res: Response) => {
  try {
    const queue = await TaskQueue.findOne({ where: { isActive: true } });
    if (!queue) {
      return res.status(404).json({ error: 'Task queue not found' });
    }

    const { taskId } = req.body;
    const tasks = queue.tasks || [];
    const maxOrder = tasks.length > 0 ? Math.max(...tasks.map((t: any) => t.order)) : 0;
    
    tasks.push({
      taskId,
      order: maxOrder + 1,
      status: 'pending',
    });

    await queue.update({ tasks });
    res.json(queue);
  } catch (error) {
    res.status(500).json({ error: 'Failed to add task to queue' });
  }
};

export const removeTaskFromQueue = async (req: Request, res: Response) => {
  try {
    const queue = await TaskQueue.findOne({ where: { isActive: true } });
    if (!queue) {
      return res.status(404).json({ error: 'Task queue not found' });
    }

    const { taskId } = req.params;
    const tasks = queue.tasks.filter((t: any) => t.taskId !== taskId);
    
    await queue.update({ tasks });
    res.json(queue);
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove task from queue' });
  }
};

export const reorderQueue = async (req: Request, res: Response) => {
  try {
    const queue = await TaskQueue.findOne({ where: { isActive: true } });
    if (!queue) {
      return res.status(404).json({ error: 'Task queue not found' });
    }

    const { tasks } = req.body;
    await queue.update({ tasks });
    res.json(queue);
  } catch (error) {
    res.status(500).json({ error: 'Failed to reorder queue' });
  }
};

export const startQueue = async (req: Request, res: Response) => {
  try {
    const queue = await TaskQueue.findOne({ where: { isActive: true } });
    if (!queue) {
      return res.status(404).json({ error: 'Task queue not found' });
    }

    await queue.update({ status: 'running' });
    
    rosbridgeService.publish('/task_command', 'std_msgs/String', {
      data: JSON.stringify({ action: 'start_queue', queueId: queue.id }),
    });

    res.json({ message: 'Queue started', queue });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start queue' });
  }
};

export const pauseQueue = async (req: Request, res: Response) => {
  try {
    const queue = await TaskQueue.findOne({ where: { isActive: true } });
    if (!queue) {
      return res.status(404).json({ error: 'Task queue not found' });
    }

    await queue.update({ status: 'paused' });
    
    rosbridgeService.publish('/task_command', 'std_msgs/String', {
      data: JSON.stringify({ action: 'pause_queue', queueId: queue.id }),
    });

    res.json({ message: 'Queue paused', queue });
  } catch (error) {
    res.status(500).json({ error: 'Failed to pause queue' });
  }
};

export const resumeQueue = async (req: Request, res: Response) => {
  try {
    const queue = await TaskQueue.findOne({ where: { isActive: true } });
    if (!queue) {
      return res.status(404).json({ error: 'Task queue not found' });
    }

    await queue.update({ status: 'running' });
    
    rosbridgeService.publish('/task_command', 'std_msgs/String', {
      data: JSON.stringify({ action: 'resume_queue', queueId: queue.id }),
    });

    res.json({ message: 'Queue resumed', queue });
  } catch (error) {
    res.status(500).json({ error: 'Failed to resume queue' });
  }
};

export const stopQueue = async (req: Request, res: Response) => {
  try {
    const queue = await TaskQueue.findOne({ where: { isActive: true } });
    if (!queue) {
      return res.status(404).json({ error: 'Task queue not found' });
    }

    await queue.update({ status: 'idle' });
    
    rosbridgeService.publish('/task_command', 'std_msgs/String', {
      data: JSON.stringify({ action: 'stop_queue', queueId: queue.id }),
    });

    res.json({ message: 'Queue stopped', queue });
  } catch (error) {
    res.status(500).json({ error: 'Failed to stop queue' });
  }
};
