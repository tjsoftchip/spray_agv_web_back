import { Server as SocketIOServer } from 'socket.io';
import WebSocket from 'ws';

class RosbridgeService {
  private io: SocketIOServer | null = null;
  private rosbridge: WebSocket | null = null;
  private reconnectInterval: NodeJS.Timeout | null = null;
  private rosbridgeUrl: string;
  private messageThrottle: Map<string, number> = new Map();
  private throttleInterval: number = 100;

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
          
          if (now - lastSent >= this.throttleInterval) {
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
      this.rosbridge.send(JSON.stringify(data));
    } else {
      console.error('Rosbridge not connected');
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
}

export default new RosbridgeService();
