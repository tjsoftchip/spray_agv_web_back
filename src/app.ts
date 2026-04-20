import express, { Application } from 'express';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { initDatabase } from './models';
import rosbridgeService from './services/rosbridgeService';
import scheduleService from './services/scheduleService';

import authRoutes from './routes/auth';
import taskRoutes from './routes/tasks';
import supplyStationRoutes from './routes/supplyStations';
import supplyManagementRoutes from './routes/supplyManagement';
import robotRoutes from './routes/robot';
import beamYardRoutes from './routes/beamYards';
import taskQueueRoutes from './routes/taskQueue';
import mapRoutes from './routes/maps';
// import scheduleRoutes from './routes/schedules'; // 已合并到任务管理
import systemRoutes from './routes/system';
import userRoutes from './routes/users';
import navigationRoutes from './routes/navigation';
import obstacleRoutes from './routes/obstacles';
import settingsRoutes from './routes/settings';
import gpsMappingRoutes from './routes/gpsMapping';
import jobPlanningRoutes from './routes/jobPlanning';

dotenv.config();

const app: Application = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: '*', // 允许来自任何地址的连接
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10000, // 提高到 10000，支持 GPS 建图等高频调用场景
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many login attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(compression());
app.use(limiter);
app.use(cors({
  origin: '*', // 允许来自任何地址的连接
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/supply/stations', supplyStationRoutes);
app.use('/api/supply/management', supplyManagementRoutes);
app.use('/api/robot', robotRoutes);
app.use('/api/beam-yards', beamYardRoutes);
app.use('/api/task-queue', taskQueueRoutes);
app.use('/api/maps', mapRoutes);
// app.use('/api/schedules', scheduleRoutes); // 已合并到任务管理
app.use('/api/system', systemRoutes);
app.use('/api/users', userRoutes);
app.use('/api/navigation', navigationRoutes);
app.use('/api/obstacles', obstacleRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/gps-mapping', gpsMappingRoutes);
app.use('/api/job', jobPlanningRoutes);

app.get('/api/health', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
    },
    services: {
      database: 'connected',
      rosbridge: rosbridgeService.isConnected() ? 'connected' : 'disconnected',
      websocket: io ? 'active' : 'inactive',
    },
  };
  res.json(health);
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// 自动检测本机IP地址
const getLocalIP = (): string => {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // 跳过内部和非IPv4地址
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
};

const startServer = async (): Promise<void> => {
  try {
    await initDatabase();
    console.log('Database initialized successfully');

    // 初始化默认系统配置
    const { initializeDefaultConfigs } = require('./controllers/settingsController');
    await initializeDefaultConfigs();

    rosbridgeService.initialize(io);
    console.log('Rosbridge service initialized');

    scheduleService.start();
    console.log('Schedule service started');

    httpServer.listen(Number(PORT), HOST, () => {
      const localIP = getLocalIP();
      console.log(`Server is running on port ${PORT}`);
      console.log(`Listening on: ${HOST}:${PORT}`);
      console.log(`Local IP: ${localIP}`);
      console.log(`Access from: http://${localIP}:${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

export { app, io };