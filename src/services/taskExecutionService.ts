import Task from '../models/Task';
import Template from '../models/Template';
import rosbridgeService from './rosbridgeService';

interface NavigationWaypoint {
  pointId: string;
  pointName: string;
  position: { x: number; y: number; z: number };
  orientation: { x: number; y: number; z: number; w: number };
  status: 'pending' | 'navigating' | 'arrived' | 'failed';
  startTime?: Date;
  endTime?: Date;
  retryCount?: number;
  roadSegment?: {
    id: string;
    sprayParams: {
      pumpStatus: boolean;
      leftArmStatus: 'open' | 'close' | 'adjusting';
      rightArmStatus: 'open' | 'close' | 'adjusting';
      leftValveStatus: boolean;
      rightValveStatus: boolean;
      armHeight: number;
    };
    operationSpeed: number;
  };
  order: number;
}

class TaskExecutionService {
  private currentTask: Task | null = null;
  private taskQueue: Task[] = [];
  private isExecuting: boolean = false;

  /**
   * 执行任务
   */
  public async executeTask(taskId: string): Promise<void> {
    try {
      console.log(`[TaskExecutionService] Starting task execution: ${taskId}`);
      
      const task = await Task.findByPk(taskId);
      
      if (!task || task.isDeleted) {
        throw new Error('Task not found');
      }

      console.log(`[TaskExecutionService] Task found: ${task.name}, status: ${task.status}`);

      // 如果任务已完成或失败，重置状态
      if (task.status === 'completed' || task.status === 'failed') {
        console.log(`[TaskExecutionService] Resetting task status from ${task.status} to pending`);
        await task.update({
          status: 'pending',
          progress: 0,
          startTime: undefined,
          endTime: undefined,
          currentNavigationIndex: 0,
          executionLogs: [],
        });
      }

      // 构建完整的导航和喷淋序列
      console.log(`[TaskExecutionService] Building navigation sequence`);
      const navigationSequence = await this.buildNavigationSequence(task);
      console.log(`[TaskExecutionService] Navigation sequence built: ${navigationSequence.length} waypoints`);
      
      await task.update({
        status: 'running',
        startTime: new Date(),
        navigationSequence,
        currentNavigationIndex: 0,
      });

      this.currentTask = task;

      // 添加执行日志
      await this.addExecutionLog(task, 'info', '任务开始执行');

      // 开始导航到第一个点（起点）
      console.log(`[TaskExecutionService] Starting navigation`);
      await this.startNavigation(task, navigationSequence);
    } catch (error) {
      console.error(`[TaskExecutionService] Execute task error:`, error);
      throw error;
    }
  }

  /**
   * 构建导航序列（包含路段和喷淋参数）
   */
  private async buildNavigationSequence(task: Task): Promise<NavigationWaypoint[]> {
    try {
      console.log(`[TaskExecutionService] Building navigation sequence for task ${task.id}`);
      const navigationSequence: NavigationWaypoint[] = [];

      if (!task.templateIds || task.templateIds.length === 0) {
        throw new Error('No templates configured for this task');
      }

      console.log(`[TaskExecutionService] Task has ${task.templateIds.length} template(s)`);

      // 遍历所有模板
      for (const templateId of task.templateIds) {
        console.log(`[TaskExecutionService] Loading template: ${templateId}`);
        const template = await Template.findByPk(templateId);
        
        if (!template) {
          console.warn(`[TaskExecutionService] Template ${templateId} not found, skipping`);
          await this.addExecutionLog(task, 'warning', `模板 ${templateId} 未找到，跳过`);
          continue;
        }

        console.log(`[TaskExecutionService] Template loaded: ${template.name}`);
        console.log(`[TaskExecutionService] Navigation points: ${template.navigationPoints?.length || 0}`);
        console.log(`[TaskExecutionService] Road segments: ${template.roadSegments?.length || 0}`);

        // 验证模板数据
        if (!template.navigationPoints || !Array.isArray(template.navigationPoints)) {
          console.warn(`[TaskExecutionService] Template ${templateId} has no navigation points`);
          await this.addExecutionLog(task, 'warning', `模板 ${template.name} 没有导航点，跳过`);
          continue;
        }

        if (template.navigationPoints.length === 0) {
          console.warn(`[TaskExecutionService] Template ${templateId} has empty navigation points`);
          await this.addExecutionLog(task, 'warning', `模板 ${template.name} 导航点为空，跳过`);
          continue;
        }

        // 按顺序排列导航点
        const sortedNavPoints = [...template.navigationPoints].sort((a, b) => a.order - b.order);
        console.log(`[TaskExecutionService] Sorted ${sortedNavPoints.length} navigation points`);

        // 为每个导航点添加对应的路段喷淋参数
        for (let i = 0; i < sortedNavPoints.length; i++) {
          const navPoint = sortedNavPoints[i];
          console.log(`[TaskExecutionService] Processing nav point ${i + 1}/${sortedNavPoints.length}: ${navPoint.name}`);
          
          const waypoint: NavigationWaypoint = {
            pointId: navPoint.id,
            pointName: navPoint.name,
            position: navPoint.position,
            orientation: navPoint.orientation,
            status: 'pending',
            order: navigationSequence.length,
          };

          // 如果不是最后一个点，查找到下一个点的路段
          if (i < sortedNavPoints.length - 1) {
            const nextNavPoint = sortedNavPoints[i + 1];
            const roadSegment = template.roadSegments?.find(
              seg => seg.startNavPointId === navPoint.id && seg.endNavPointId === nextNavPoint.id
            );

            if (roadSegment) {
              console.log(`[TaskExecutionService] Found road segment for ${navPoint.name} -> ${nextNavPoint.name}`);
              waypoint.roadSegment = {
                id: roadSegment.id,
                sprayParams: roadSegment.sprayParams,
                operationSpeed: roadSegment.operationSpeed,
              };
            } else {
              console.log(`[TaskExecutionService] No road segment found for ${navPoint.name} -> ${nextNavPoint.name}`);
            }
          }

          navigationSequence.push(waypoint);
        }
      }

      console.log(`[TaskExecutionService] Navigation sequence built with ${navigationSequence.length} waypoints`);
      return navigationSequence;
    } catch (error) {
      console.error(`[TaskExecutionService] Error building navigation sequence:`, error);
      throw error;
    }
  }

  /**
   * 开始导航
   */
  private async startNavigation(task: Task, navigationSequence: NavigationWaypoint[]): Promise<void> {
    if (navigationSequence.length === 0) {
      await this.completeTask(task, 'failed', '没有有效的导航点');
      return;
    }

    const currentIndex = task.currentNavigationIndex || 0;
    const currentWaypoint = navigationSequence[currentIndex];

    await this.addExecutionLog(
      task,
      'info',
      `导航到第 ${currentIndex + 1}/${navigationSequence.length} 个点: ${currentWaypoint.pointName}`
    );

    // 发送导航目标到ROS2
    rosbridgeService.publish('/move_base_simple/goal', 'geometry_msgs/PoseStamped', {
      header: {
        frame_id: 'map',
        stamp: {
          sec: Math.floor(Date.now() / 1000),
          nanosec: (Date.now() % 1000) * 1000000,
        },
      },
      pose: {
        position: currentWaypoint.position,
        orientation: currentWaypoint.orientation,
      },
    });

    // 如果有路段喷淋参数，在开始导航时设置喷淋
    if (currentWaypoint.roadSegment) {
      await this.controlSpraySystem(task, currentWaypoint.roadSegment);
    }

    // 订阅导航状态，监听到达事件
    this.subscribeNavigationStatus(task, navigationSequence);
  }

  /**
   * 控制喷淋系统
   */
  private async controlSpraySystem(
    task: Task,
    roadSegment: NavigationWaypoint['roadSegment']
  ): Promise<void> {
    if (!roadSegment) return;

    const { sprayParams } = roadSegment;

    await this.addExecutionLog(task, 'info', '设置喷淋参数');

    // 控制水泵
    rosbridgeService.publish('/spray_control/pump', 'std_msgs/Bool', {
      data: sprayParams.pumpStatus,
    });

    // 控制左臂
    rosbridgeService.publish('/spray_control/left_arm', 'std_msgs/String', {
      data: sprayParams.leftArmStatus,
    });

    // 控制右臂
    rosbridgeService.publish('/spray_control/right_arm', 'std_msgs/String', {
      data: sprayParams.rightArmStatus,
    });

    // 控制左阀
    rosbridgeService.publish('/spray_control/left_valve', 'std_msgs/Bool', {
      data: sprayParams.leftValveStatus,
    });

    // 控制右阀
    rosbridgeService.publish('/spray_control/right_valve', 'std_msgs/Bool', {
      data: sprayParams.rightValveStatus,
    });

    // 控制支架高度
    rosbridgeService.publish('/spray_control/arm_height', 'std_msgs/Float32', {
      data: sprayParams.armHeight,
    });

    // 设置运行速度
    rosbridgeService.publish('/cmd_vel_max', 'std_msgs/Float32', {
      data: roadSegment.operationSpeed,
    });

    await this.addExecutionLog(
      task,
      'info',
      `喷淋参数已设置: 水泵=${sprayParams.pumpStatus}, 左臂=${sprayParams.leftArmStatus}, 右臂=${sprayParams.rightArmStatus}, 速度=${roadSegment.operationSpeed}m/s`
    );
  }

  /**
   * 订阅导航状态
   */
  private subscribeNavigationStatus(task: Task, navigationSequence: NavigationWaypoint[]): void {
    // 这里应该订阅ROS2的导航状态话题
    // 当机器人到达目标点时，会收到通知
    // 实际实现中，应该在rosbridgeService中处理订阅，并通过回调通知这里
    
    // 模拟：在实际应用中，应该通过ROS2话题订阅来触发
    // rosbridgeService.subscribe('/navigation_status', (message) => {
    //   if (message.status === 'goal_reached') {
    //     this.onNavigationGoalReached(task, navigationSequence);
    //   } else if (message.status === 'goal_failed') {
    //     this.onNavigationGoalFailed(task, navigationSequence);
    //   }
    // });
  }

  /**
   * 导航目标到达回调
   */
  public async onNavigationGoalReached(taskId: string): Promise<void> {
    const task = await Task.findByPk(taskId);
    
    if (!task || task.status !== 'running') {
      return;
    }

    const navigationSequence = (task.navigationSequence || []) as any as NavigationWaypoint[];
    const currentIndex = task.currentNavigationIndex || 0;
    const currentWaypoint = navigationSequence[currentIndex];

    if (!currentWaypoint) {
      console.error(`[TaskExecutionService] No waypoint found at index ${currentIndex}`);
      return;
    }

    await this.addExecutionLog(
      task,
      'info',
      `已到达: ${currentWaypoint.pointName}`
    );

    // 如果有路段喷淋参数，在到达后关闭喷淋
    if ((currentWaypoint as any).roadSegment) {
      await this.stopSpraySystem(task);
    }

    // 更新进度
    const progress = Math.round(((currentIndex + 1) / navigationSequence.length) * 100);
    await task.update({
      progress,
      currentNavigationIndex: currentIndex + 1,
    });

    // 检查是否还有下一个点
    if (currentIndex + 1 < navigationSequence.length) {
      // 继续导航到下一个点
      await this.startNavigation(task, navigationSequence);
    } else {
      // 任务完成
      await this.completeTask(task, 'completed', '任务执行完成');
      
      // 检查是否有队列中的下一个任务
      await this.checkAndStartNextTask();
    }
  }

  /**
   * 导航失败回调
   */
  public async onNavigationGoalFailed(taskId: string, reason: string): Promise<void> {
    const task = await Task.findByPk(taskId);
    
    if (!task || task.status !== 'running') {
      return;
    }

    await this.addExecutionLog(task, 'error', `导航失败: ${reason}`);

    // 停止喷淋系统
    await this.stopSpraySystem(task);

    // 标记任务失败
    await this.completeTask(task, 'failed', `导航失败: ${reason}`);
  }

  /**
   * 停止喷淋系统
   */
  private async stopSpraySystem(task: Task): Promise<void> {
    await this.addExecutionLog(task, 'info', '关闭喷淋系统');

    // 关闭水泵
    rosbridgeService.publish('/spray_control/pump', 'std_msgs/Bool', {
      data: false,
    });

    // 关闭左阀
    rosbridgeService.publish('/spray_control/left_valve', 'std_msgs/Bool', {
      data: false,
    });

    // 关闭右阀
    rosbridgeService.publish('/spray_control/right_valve', 'std_msgs/Bool', {
      data: false,
    });

    // 收起左臂
    rosbridgeService.publish('/spray_control/left_arm', 'std_msgs/String', {
      data: 'close',
    });

    // 收起右臂
    rosbridgeService.publish('/spray_control/right_arm', 'std_msgs/String', {
      data: 'close',
    });
  }

  /**
   * 完成任务
   */
  private async completeTask(task: Task, status: 'completed' | 'failed', message: string): Promise<void> {
    await task.update({
      status,
      endTime: new Date(),
      progress: status === 'completed' ? 100 : task.progress,
    });

    await this.addExecutionLog(task, status === 'completed' ? 'info' : 'error', message);

    this.currentTask = null;
  }

  /**
   * 检查并启动下一个任务
   */
  private async checkAndStartNextTask(): Promise<void> {
    // 查找队列中的下一个待执行任务
    const nextTask = await Task.findOne({
      where: {
        status: 'pending',
        isDeleted: false,
      },
      order: [['priority', 'DESC'], ['createdAt', 'ASC']],
    });

    if (nextTask) {
      // 自动执行下一个任务
      await this.executeTask(nextTask.id);
    }
  }

  /**
   * 暂停任务
   */
  public async pauseTask(taskId: string): Promise<void> {
    const task = await Task.findByPk(taskId);
    
    if (!task || task.status !== 'running') {
      throw new Error('Task is not running');
    }

    // 取消当前导航
    rosbridgeService.publish('/move_base/cancel', 'actionlib_msgs/GoalID', {});

    // 停止喷淋系统
    await this.stopSpraySystem(task);

    await task.update({ status: 'paused' });
    await this.addExecutionLog(task, 'info', '任务已暂停');
  }

  /**
   * 恢复任务
   */
  public async resumeTask(taskId: string): Promise<void> {
    const task = await Task.findByPk(taskId);
    
    if (!task || task.status !== 'paused') {
      throw new Error('Task is not paused');
    }

    await task.update({ status: 'running' });
    await this.addExecutionLog(task, 'info', '任务已恢复');

    // 从当前位置继续导航
    const navigationSequence = (task.navigationSequence || []) as any as NavigationWaypoint[];
    await this.startNavigation(task, navigationSequence);
  }

  /**
   * 停止任务
   */
  public async stopTask(taskId: string): Promise<void> {
    const task = await Task.findByPk(taskId);
    
    if (!task || (task.status !== 'running' && task.status !== 'paused')) {
      throw new Error('Task is not running or paused');
    }

    // 取消当前导航
    rosbridgeService.publish('/move_base/cancel', 'actionlib_msgs/GoalID', {});

    // 停止喷淋系统
    await this.stopSpraySystem(task);

    await this.completeTask(task, 'completed', '任务已手动停止');
  }

  /**
   * 添加执行日志
   */
  private async addExecutionLog(
    task: Task,
    level: 'info' | 'warning' | 'error',
    message: string
  ): Promise<void> {
    try {
      const logs = task.executionLogs || [];
      logs.push({
        timestamp: new Date(),
        level,
        message,
      });

      await task.update({ executionLogs: logs });

      console.log(`[Task ${task.id}] [${level.toUpperCase()}] ${message}`);
    } catch (error) {
      console.error(`[TaskExecutionService] Failed to add execution log:`, error);
      // 不抛出错误，避免日志记录失败导致整个流程中断
    }
  }
}

export default new TaskExecutionService();
