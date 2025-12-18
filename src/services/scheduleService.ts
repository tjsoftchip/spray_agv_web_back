import Task from '../models/Task';
import { Op } from 'sequelize';

class ScheduleService {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  public start(): void {
    if (this.isRunning) {
      console.log('Schedule service is already running');
      return;
    }

    console.log('Starting schedule service...');
    this.isRunning = true;

    this.intervalId = setInterval(() => {
      this.checkAndExecuteTasks();
    }, 60000);

    this.checkAndExecuteTasks();
  }

  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log('Schedule service stopped');
  }

  private async checkAndExecuteTasks(): Promise<void> {
    try {
      const now = new Date();
      
      const scheduledTasks = await Task.findAll({
        where: {
          executionType: 'scheduled',
          isScheduleEnabled: true,
          status: {
            [Op.notIn]: ['running', 'paused']
          },
          isDeleted: false
        }
      });

      console.log(`Checking ${scheduledTasks.length} scheduled tasks at ${now.toISOString()}`);

      for (const task of scheduledTasks) {
        if (this.shouldExecuteTask(task, now)) {
          console.log(`Executing scheduled task: ${task.name} (${task.id})`);
          await this.executeTask(task);
        }
      }
    } catch (error) {
      console.error('Error checking scheduled tasks:', error);
    }
  }

  private shouldExecuteTask(task: any, now: Date): boolean {
    const config = task.scheduleConfig;
    if (!config || !config.startTime) {
      return false;
    }

    const startTime = new Date(config.startTime);
    
    if (config.endTime) {
      const endTime = new Date(config.endTime);
      if (now > endTime) {
        return false;
      }
    }

    const { scheduleType } = config;

    if (scheduleType === 'once') {
      const timeDiff = Math.abs(now.getTime() - startTime.getTime());
      return timeDiff < 60000;
    }

    if (scheduleType === 'daily') {
      return now.getHours() === startTime.getHours() && 
             now.getMinutes() === startTime.getMinutes();
    }

    if (scheduleType === 'weekly') {
      const dayOfWeek = now.getDay();
      const daysOfWeek = config.daysOfWeek || [];
      return daysOfWeek.includes(dayOfWeek) &&
             now.getHours() === startTime.getHours() && 
             now.getMinutes() === startTime.getMinutes();
    }

    if (scheduleType === 'monthly') {
      const dayOfMonth = now.getDate();
      return dayOfMonth === (config.repeatInterval || 1) &&
             now.getHours() === startTime.getHours() && 
             now.getMinutes() === startTime.getMinutes();
    }

    return false;
  }

  private async executeTask(task: any): Promise<void> {
    try {
      await task.update({
        status: 'running',
        startTime: new Date(),
        progress: 0
      });

      console.log(`Task ${task.id} execution started`);
    } catch (error) {
      console.error(`Failed to execute task ${task.id}:`, error);
    }
  }
}

export default new ScheduleService();
