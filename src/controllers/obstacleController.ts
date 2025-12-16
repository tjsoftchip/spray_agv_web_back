import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import rosbridgeService from '../services/rosbridgeService';

export const getObstacleStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const latestStatus = rosbridgeService.latestObstacleStatus;
    
    if (!latestStatus) {
      res.json({
        status: 'UNKNOWN',
        message: 'No obstacle detection data available',
        laser_detected: false,
        camera_detected: false,
        timestamp: new Date(),
      });
      return;
    }

    res.json(latestStatus);
  } catch (error) {
    console.error('Get obstacle status error:', error);
    res.status(500).json({ error: 'Internal server error' });
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
      message: 'Obstacle detection configured',
      params,
    });
  } catch (error) {
    console.error('Config obstacle detection error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
