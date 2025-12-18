import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import rosbridgeService from '../services/rosbridgeService';

export const getObstacleStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const latestStatus = rosbridgeService.latestObstacleStatus;
    
    if (!latestStatus) {
      res.json({
        status: 'UNKNOWN',
        message: '等待检测数据',
        laser_detected: false,
        camera_detected: false,
        closest_laser_distance: null,
        closest_depth_distance: null,
        action: 'continue',
        timestamp: Date.now(),
      });
      return;
    }

    res.json(latestStatus);
  } catch (error) {
    console.error('Get obstacle status error:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};

export const configObstacleDetection = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      enableFusion = true,
      laserThreshold = 0.5,
      depthThreshold = 0.5,
      confirmationTimeout = 2.0,
    } = req.body;

    const params = {
      enable_fusion: enableFusion,
      laser_threshold: laserThreshold,
      depth_threshold: depthThreshold,
      confirmation_timeout: confirmationTimeout,
    };

    for (const [key, value] of Object.entries(params)) {
      const paramMsg = {
        op: 'set_param',
        name: `/obstacle_fusion_detector/${key}`,
        value: value,
      };
      rosbridgeService.publish('', '', paramMsg);
    }

    res.json({
      success: true,
      message: '障碍物检测配置已更新',
      params,
    });
  } catch (error) {
    console.error('Config obstacle detection error:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};
