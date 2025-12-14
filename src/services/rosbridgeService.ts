import { Server as SocketIOServer } from 'socket.io';
import WebSocket from 'ws';

class RosbridgeService {
  private io: SocketIOServer | null = null;
  private rosbridge: WebSocket | null = null;
  private reconnectInterval: NodeJS.Timeout | null = null;
  private rosbridgeUrl: string;
// 消息频率限制（毫秒）
  private messageThrottle = new Map<string, number>();
  private throttleInterval = 100; // 100ms最小间隔
  
  // 特殊话题的频率限制
  private specialTopicIntervals: { [topic: string]: number } = {
    '/map': 500, // 地图消息限制在500ms
    '/amcl_pose': 50, // 机器人位姿消息限制在50ms
    '/robot_pose': 50,
    '/robot_pose_k': 50,
    '/odom': 50,
    '/tf': 50,
    '/tf_static': 1000 // 静态tf消息限制在1s
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

  public callService(service: string, serviceType: string, args: any): void {
    const rosMessage = {
      op: 'call_service',
      service,
      type: serviceType,
      args,
    };
    this.sendToRos(rosMessage);
  }

  public isConnected(): boolean {
    return this.rosbridge !== null && this.rosbridge.readyState === WebSocket.OPEN;
  }

  public publish(topic: string, messageType: string, message: any): void {
    this.publishTopic(topic, messageType, message);
  }

  // 获取机器人当前位姿
  public async getRobotPose(): Promise<any> {
    return new Promise((resolve) => {
      if (!this.isConnected()) {
        resolve(null);
        return;
      }

      // 尝试从多个可能的位姿话题获取数据
      const poseTopics = ['/amcl_pose', '/robot_pose', '/robot_pose_k'];
      let timeoutId: NodeJS.Timeout;
      let messageReceived = false;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        // 取消订阅
        poseTopics.forEach(topic => {
          this.unsubscribeTopic(topic);
        });
      };

      // 设置超时
      timeoutId = setTimeout(() => {
        if (!messageReceived) {
          cleanup();
          resolve(null);
        }
      }, 2000); // 2秒超时

      // 创建临时消息处理器
      const tempHandler = (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          const topic = message.topic;
          
          if (poseTopics.includes(topic) && message.msg && message.msg.pose) {
            messageReceived = true;
            cleanup();
            resolve(message.msg.pose);
          }
        } catch (error) {
          console.error('Error parsing pose message:', error);
        }
      };

      // 临时添加消息监听器
      if (this.rosbridge) {
        this.rosbridge.on('message', tempHandler);
        
        // 订阅位姿话题
        poseTopics.forEach(topic => {
          this.subscribeTopic(topic, 'geometry_msgs/PoseWithCovarianceStamped');
        });

        // 2秒后移除监听器
        setTimeout(() => {
          if (this.rosbridge) {
            this.rosbridge.removeListener('message', tempHandler);
          }
        }, 2000);
      }
    });
  }
}

export default new RosbridgeService();
