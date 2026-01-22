import { Server as SocketIOServer } from 'socket.io';
import WebSocket from 'ws';

class RosbridgeService {
  private io: SocketIOServer | null = null;
  private rosbridge: WebSocket | null = null;
  private reconnectInterval: NodeJS.Timeout | null = null;
  private rosbridgeUrl: string;
  public latestObstacleStatus: any = null;
  public latestNavigationStatus: any = null;
// 消息频率限制（毫秒）
  private messageThrottle = new Map<string, number>();
  private throttleInterval = 100; // 100ms最小间隔
  
  // 特殊话题的频率限制
  private specialTopicIntervals: { [topic: string]: number } = {
    '/map': 500, // 地图消息限制在500ms
    '/amcl_pose': 50, // 机器人位姿消息限制在50ms
    '/robot_pose': 50,
    '/odom': 50,
    '/tf': 50,
    '/tf_static': 1000, // 静态tf消息限制在1s
    '/navigation_task/status': 200, // 导航状态200ms
    '/obstacle_detection': 100, // 障碍物检测100ms
    '/camera/color/image_raw/compressed': 500 // 相机图像限制在500ms (2fps)
  };

  constructor() {
    this.rosbridgeUrl = process.env.ROSBRIDGE_URL || 'ws://localhost:9090';
  }

  public initialize(io: SocketIOServer): void {
    this.io = io;
    this.connectToRosbridge();

    this.io.on('connection', (socket) => {
      console.log('Client connected:', socket.id);

      socket.on('ros_command', (data) => {
        this.sendToRos(data);
      });

      socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
      });
    });
  }

  private connectToRosbridge(): void {
    try {
      this.rosbridge = new WebSocket(this.rosbridgeUrl);

      this.rosbridge.on('open', () => {
        console.log('Connected to rosbridge');
        if (this.reconnectInterval) {
          clearInterval(this.reconnectInterval);
          this.reconnectInterval = null;
        }
        
        this.subscribeTopic('/navigation_task/status', 'std_msgs/String');
        this.subscribeTopic('/obstacle_detection', 'std_msgs/String');
        this.subscribeTopic('/water_monitor/level', 'std_msgs/String');
        console.log('Subscribed to navigation, obstacle detection and water level topics');
      });

      this.rosbridge.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          const topic = message.topic || 'unknown';
          const now = Date.now();
          const lastSent = this.messageThrottle.get(topic) || 0;
          
          // 使用特殊话题的频率限制
          const throttleInterval = this.specialTopicIntervals[topic] || this.throttleInterval;
          
          // 添加调试信息
          console.log(`Received ${topic} message:`, message.msg ? 'has msg' : 'no msg');
          if (topic === '/tf' && message.msg && message.msg.transforms) {
            console.log('TF transforms:', message.msg.transforms.length);
          } else if (topic === '/map' && message.msg) {
            console.log('Map info:', {
              hasInfo: !!message.msg.info,
              hasData: !!message.msg.data,
              width: message.msg.info?.width,
              height: message.msg.info?.height,
              resolution: message.msg.info?.resolution
            });
          }
          
          if (now - lastSent >= throttleInterval) {
            this.broadcastToClients('ros_message', message);
            this.messageThrottle.set(topic, now);
            
            if (topic === '/navigation_task/status' && message.msg) {
              try {
                const statusData = JSON.parse(message.msg.data);
                this.latestNavigationStatus = statusData;
                this.broadcastToClients('navigation_status', statusData);
                
                // 处理导航目标到达和失败事件
                if (statusData.status === 'goal_reached' && statusData.task_id) {
                  const taskExecutionService = require('./taskExecutionService').default;
                  taskExecutionService.onNavigationGoalReached(statusData.task_id);
                } else if (statusData.status === 'goal_failed' && statusData.task_id) {
                  const taskExecutionService = require('./taskExecutionService').default;
                  taskExecutionService.onNavigationGoalFailed(statusData.task_id, statusData.reason || 'Unknown error');
                }
              } catch (e) {
                console.error('Parse navigation status error:', e);
              }
            } else if (topic === '/obstacle_detection' && message.msg) {
              try {
                const obstacleData = JSON.parse(message.msg.data);
                this.latestObstacleStatus = obstacleData;
                this.broadcastToClients('obstacle_status', obstacleData);
              } catch (e) {
                console.error('Parse obstacle detection error:', e);
              }
            } else if (topic === '/water_monitor/level' && message.msg) {
              try {
                const waterData = JSON.parse(message.msg.data);
                // 更新全局水位状态
                const supplyManagementController = require('../controllers/supplyManagementController');
                supplyManagementController.updateWaterLevelStatus(waterData);
                this.broadcastToClients('water_level_status', waterData);
                console.log('Water level updated:', waterData);
              } catch (e) {
                console.error('Parse water level error:', e);
              }
            }
          }
        } catch (error) {
          console.error('Error parsing ROS message:', error);
        }
      });

      this.rosbridge.on('error', (error) => {
        console.error('Rosbridge error:', error);
      });

      this.rosbridge.on('close', () => {
        console.log('Disconnected from rosbridge');
        this.scheduleReconnect();
      });
    } catch (error) {
      console.error('Failed to connect to rosbridge:', error);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.reconnectInterval) {
      this.reconnectInterval = setInterval(() => {
        console.log('Attempting to reconnect to rosbridge...');
        this.connectToRosbridge();
      }, 5000);
    }
  }

  private sendToRos(data: any): void {
    if (this.rosbridge && this.rosbridge.readyState === WebSocket.OPEN) {
      console.log('Sending to ROS:', JSON.stringify(data, null, 2));
      this.rosbridge.send(JSON.stringify(data));
    } else {
      console.error('Rosbridge not connected, cannot send:', data);
    }
  }

  private broadcastToClients(event: string, data: any): void {
    if (this.io) {
      this.io.emit(event, data);
    }
  }

  public publishTopic(topic: string, messageType: string, message: any): void {
    const rosMessage = {
      op: 'publish',
      topic,
      msg: message,
      type: messageType,
    };
    this.sendToRos(rosMessage);
  }

  public subscribeTopic(topic: string, messageType: string): void {
    const rosMessage = {
      op: 'subscribe',
      topic,
      type: messageType,
    };
    console.log(`Subscribing to topic: ${topic} (${messageType})`);
    this.sendToRos(rosMessage);
  }

  public unsubscribeTopic(topic: string): void {
    const rosMessage = {
      op: 'unsubscribe',
      topic,
    };
    this.sendToRos(rosMessage);
  }

  public callService(service: string, serviceType: string, args: any, id?: string): void {
    const rosMessage: any = {
      op: 'call_service',
      service,
      type: serviceType,
      args,
    };
    if (id) {
      rosMessage.id = id;
    }
    this.sendToRos(rosMessage);
  }

  // 异步服务调用方法，用于需要等待响应的服务调用
  public async callServiceAsync(service: string, serviceType: string, args: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error('Rosbridge not connected'));
        return;
      }

      const id = `service_call_${Date.now()}_${Math.random()}`;
      
      // 监听服务响应
      const messageHandler = (message: any) => {
        if (message.op === 'service_response' && message.id === id) {
          this.rosbridge?.removeListener('message', messageHandler);
          if (message.values && message.values.result !== undefined) {
            resolve(message.values);
          } else {
            reject(new Error('Service call failed'));
          }
        }
      };

      this.rosbridge?.on('message', messageHandler);

      // 设置超时
      setTimeout(() => {
        this.rosbridge?.removeListener('message', messageHandler);
        reject(new Error('Service call timeout'));
      }, 5000);

      // 发送服务调用请求
      const rosMessage = {
        op: 'call_service',
        id,
        service,
        type: serviceType,
        args,
      };
      this.sendToRos(rosMessage);
    });
  }

  public isConnected(): boolean {
    return this.rosbridge !== null && this.rosbridge.readyState === WebSocket.OPEN;
  }

  // Public method to get the rosbridge instance for event listener access
  public getRosbridge(): WebSocket | null {
    return this.rosbridge;
  }

  public publish(topic: string, messageType: string, message: any): void {
    this.publishTopic(topic, messageType, message);
  }

  // 获取机器人当前位姿（带回退机制）
  public async getRobotPose(): Promise<any> {
    if (!this.isConnected()) {
      console.warn('[getRobotPose] Rosbridge not connected');
      return null;
    }

    // 1. 优先尝试 /amcl_pose（全局定位）
    console.log('[getRobotPose] Trying /amcl_pose first...');
    const amclPose = await this.tryGetPoseFromTopic('/amcl_pose', 'geometry_msgs/PoseWithCovarianceStamped', 1500);
    if (amclPose) {
      console.log('[getRobotPose] Got pose from /amcl_pose (global localization)');
      return {
        ...amclPose,
        source: 'amcl',
        frame: 'map',
        reliable: true
      };
    }

    // 2. 尝试 /odometry/filtered（滤波后的里程计）
    console.log('[getRobotPose] /amcl_pose unavailable, trying /odometry/filtered...');
    const filteredOdomPose = await this.tryGetPoseFromTopic('/odometry/filtered', 'nav_msgs/Odometry', 1000);
    if (filteredOdomPose) {
      console.log('[getRobotPose] Got pose from /odometry/filtered (filtered odometry)');
      return {
        ...filteredOdomPose,
        source: 'filtered_odom',
        frame: 'odom',
        reliable: false,
        warning: 'Using filtered odometry - position may drift. Please set initial pose for global localization.'
      };
    }

    // 3. 回退到 /odom（原始里程计）
    console.log('[getRobotPose] /odometry/filtered unavailable, falling back to /odom...');
    const odomPose = await this.tryGetPoseFromTopic('/odom', 'nav_msgs/Odometry', 1000);
    if (odomPose) {
      console.log('[getRobotPose] Got pose from /odom (raw odometry)');
      return {
        ...odomPose,
        source: 'odom',
        frame: 'odom',
        reliable: false,
        warning: 'Using raw odometry - position may drift. Please set initial pose for global localization.'
      };
    }

    // 4. 都失败，返回 null
    console.warn('[getRobotPose] Failed to get pose from /amcl_pose, /odometry/filtered, and /odom');
    return null;
  }

  // 辅助函数：从指定话题获取位姿
  private async tryGetPoseFromTopic(topic: string, messageType: string, timeout: number): Promise<any> {
    return new Promise((resolve) => {
      let timeoutId: NodeJS.Timeout;
      let messageReceived = false;

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        this.unsubscribeTopic(topic);
      };

      timeoutId = setTimeout(() => {
        if (!messageReceived) {
          cleanup();
          resolve(null);
        }
      }, timeout);

      const tempHandler = (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.topic === topic && message.msg) {
            messageReceived = true;
            cleanup();
            
            // 处理不同消息类型
            if (message.msg.pose) {
              // PoseWithCovarianceStamped 或 Odometry
              const pose = message.msg.pose.pose || message.msg.pose;
              resolve(pose);
            } else {
              resolve(null);
            }
          }
        } catch (error) {
          console.error(`[tryGetPoseFromTopic] Error parsing ${topic}:`, error);
        }
      };

      if (this.rosbridge) {
        this.rosbridge.on('message', tempHandler);
        this.subscribeTopic(topic, messageType);

        setTimeout(() => {
          if (this.rosbridge) {
            this.rosbridge.removeListener('message', tempHandler);
          }
        }, timeout);
      } else {
        resolve(null);
      }
    });
  }
}

export default new RosbridgeService();
