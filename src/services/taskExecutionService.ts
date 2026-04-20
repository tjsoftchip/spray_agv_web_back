import Task from '../models/Task';
import rosbridgeService from './rosbridgeService';
import * as path from 'path';

/**
 * 任务执行服务
 *
 * 核心原则: Web端只负责发指令和监听状态，导航和喷淋由ROS2端节点执行。
 *
 * 执行路径 (V4.0 统一入口):
 * - 所有任务统一发送到 /navigation_task/start
 * - beam_position_task_node 接收并执行 (已合并 route_executor 功能)
 * - 支持 YAML 路线文件 (route_file) 和梁位数据 (beam_positions)
 *
 * 状态同步:
 * - 订阅 /navigation_task/status 获取任务进度（rosbridgeService 已处理）
 * - ROS2端状态映射: idle->pending, navigating->running, spraying->running, paused->paused, completed->completed, failed->failed
 */

const MAPS_DIR = '/home/jetson/yahboomcar_ros2_ws/yahboomcar_ws/src/yahboomcar_nav/maps';

/** ROS2端 beam_position_task_node 发布的状态字段 */
interface RosTaskStatus {
 task_id: string | null;
 status: string; // idle, navigating, spraying, paused, completed, failed
 state: string; // 别名，同status
 total_segments: number;
 current_segment: number;
 progress: number;
 spray_active: boolean;
 beam_positions: string[];
 errorMessage: string | null;
}

/** ROS2状态 -> Web数据库状态 映射 */
function mapRosStatusToDbStatus(rosStatus: string): 'pending' | 'running' | 'paused' | 'completed' | 'failed' {
 switch (rosStatus) {
 case 'navigating':
 case 'spraying':
 return 'running';
 case 'paused':
 return 'paused';
 case 'completed':
 return 'completed';
 case 'failed':
 return 'failed';
 case 'idle':
 default:
 return 'pending';
 }
}

class TaskExecutionService {
 private currentTask: Task | null = null;
 /** 当前正在被ROS2端执行的任务ID（用于状态同步） */
 private activeRosTaskId: string | null = null;
 /** 状态轮询定时器 */
 private statusPollTimer: NodeJS.Timeout | null = null;

 /**
 * 执行任务
 *
 * 将任务参数发送到ROS2端，由ROS2节点执行导航和喷淋。
 * Web端通过订阅 /navigation_task/status 来同步进度。
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

 if (!rosbridgeService.isConnected()) {
 throw new Error('ROS bridge not connected');
 }

 await task.update({
 status: 'running',
 startTime: new Date(),
 progress: 0,
 });

 this.currentTask = task;
 this.activeRosTaskId = taskId;

 await this.addExecutionLog(task, 'info', '任务开始执行，发送指令到ROS2端');

 // 统一通过 /navigation_task/start 发送给 beam_position_task_node
 // beam_position_task_node 已合并 route_executor 功能,支持 YAML 路线文件和梁位数据
 if (task.routeFilePath) {
 // 有路线文件 -> 发送路线文件路径
 await this.executeViaNavigationTask(task);
 } else if ((task.executionParams as any)?.beamPositions?.length > 0) {
 // 有梁位数据 -> 发送梁位数据
 await this.executeViaNavigationTask(task);
 } else {
 // 无有效执行参数
 await this.completeTask(task, 'failed', '任务缺少路线文件或梁位数据');
 return;
 }

 // 启动状态轮询（从ROS2端同步进度到数据库）
 this.startStatusPolling();

 } catch (error) {
 console.error(`[TaskExecutionService] Execute task error:`, error);
 throw error;
 }
 }

 /**
 * 通过 beam_position_task_node 执行任务 (统一入口)
 *
 * 发送任务到 /navigation_task/start 话题,
 * beam_position_task_node 会根据参数类型自动处理:
 * - 有 route_file -> 加载 YAML 路线文件并执行段级导航
 * - 有 beam_positions -> 使用梁位数据规划路线
 */
 private async executeViaNavigationTask(task: Task): Promise<void> {
 const routeFilePath = task.routeFilePath
 ? path.join(MAPS_DIR, task.routeFilePath)
 : null;

 const beamPositions = (task.executionParams as any)?.beamPositions || [];
 const route = (task.executionParams as any)?.route || null;

 console.log(`[TaskExecutionService] Sending task to beam_position_task_node via /navigation_task/start`);

 const startData: any = {
 route_id: task.id,
 };

 // 优先使用路线文件
 if (routeFilePath) {
 startData.route_file = routeFilePath;
 console.log(`[TaskExecutionService] Route file: ${routeFilePath}`);
 } else if (beamPositions.length > 0) {
 startData.beam_positions = beamPositions;
 startData.route = route;
 console.log(`[TaskExecutionService] Beam positions: ${beamPositions.length}`);
 }

 rosbridgeService.publish('/navigation_task/start', 'std_msgs/String', {
 data: JSON.stringify(startData),
 });

 const logMessage = routeFilePath
 ? `已发送路线文件到beam_position_task_node: ${task.routeFilePath}`
 : `已发送梁位数据到beam_position_task_node: ${beamPositions.length}个梁位`;

 await this.addExecutionLog(task, 'info', logMessage);
 }

 /**
 * 启动状态轮询
 *
 * 定期检查 rosbridgeService.latestNavigationStatus 中来自ROS2端的状态，
 * 同步进度到数据库。
 */
 private startStatusPolling(): void {
 this.stopStatusPolling();

 this.statusPollTimer = setInterval(async () => {
 await this.syncRosStatus();
 }, 2000); // 每2秒同步一次
 }

 /**
 * 停止状态轮询
 */
 private stopStatusPolling(): void {
 if (this.statusPollTimer) {
 clearInterval(this.statusPollTimer);
 this.statusPollTimer = null;
 }
 }

 /**
 * 从ROS2端同步状态到数据库
 */
 private async syncRosStatus(): Promise<void> {
 if (!this.currentTask || !this.activeRosTaskId) {
 return;
 }

 try {
 const rosStatus = rosbridgeService.latestNavigationStatus as RosTaskStatus | null;

 if (!rosStatus) {
 return;
 }

 // 检查是否是当前任务的状态（通过task_id匹配）
 if (rosStatus.task_id && rosStatus.task_id !== this.activeRosTaskId) {
 return;
 }

 const dbStatus = mapRosStatusToDbStatus(rosStatus.status);
 const progress = Math.round(rosStatus.progress || 0);

 // 获取当前数据库中的任务状态
 const task = await Task.findByPk(this.activeRosTaskId);
 if (!task || task.status !== 'running') {
 // 任务已不在运行状态，停止轮询
 this.stopStatusPolling();
 return;
 }

 // 更新进度
 if (progress !== task.progress) {
 await task.update({ progress });
 }

 // 如果ROS2端任务完成或失败，更新数据库
 if (dbStatus === 'completed') {
 await this.completeTask(task, 'completed', '任务执行完成');
 this.stopStatusPolling();
 await this.checkAndStartNextTask();
 } else if (dbStatus === 'failed') {
 const reason = rosStatus.errorMessage || '未知错误';
 await this.completeTask(task, 'failed', `任务失败: ${reason}`);
 this.stopStatusPolling();
 }

 } catch (error) {
 console.error('[TaskExecutionService] Error syncing ROS status:', error);
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

 // 通知ROS2端暂停
 rosbridgeService.publish('/navigation_task/pause', 'std_msgs/Empty', {});

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

 // 通知ROS2端恢复
 rosbridgeService.publish('/navigation_task/resume', 'std_msgs/Empty', {});

 await task.update({ status: 'running' });
 await this.addExecutionLog(task, 'info', '任务已恢复');

 // 重新启动状态轮询
 this.activeRosTaskId = taskId;
 this.currentTask = task;
 this.startStatusPolling();
 }

 /**
 * 停止任务
 */
 public async stopTask(taskId: string): Promise<void> {
 const task = await Task.findByPk(taskId);

 if (!task || (task.status !== 'running' && task.status !== 'paused')) {
 throw new Error('Task is not running or paused');
 }

 // 通知ROS2端停止
 rosbridgeService.publish('/navigation_task/stop', 'std_msgs/Empty', {});

 this.stopStatusPolling();
 await this.completeTask(task, 'completed', '任务已手动停止');
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

 if (this.activeRosTaskId === task.id) {
 this.activeRosTaskId = null;
 this.currentTask = null;
 }
 }

 /**
 * 检查并启动下一个任务
 */
 private async checkAndStartNextTask(): Promise<void> {
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
 }
 }
}

export default new TaskExecutionService();
