import { Request, Response } from 'express';
import rosbridgeService from '../services/rosbridgeService';

export const getRobotStatus = async (req: Request, res: Response) => {
  try {
    res.json({
      connected: rosbridgeService.isConnected(),
      position: { x: 0, y: 0, z: 0 },
      battery: 85,
      waterLevel: 70,
      mode: 'auto',
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get robot status' });
  }
};

export const controlMotion = async (req: Request, res: Response) => {
  try {
    const { linear, angular } = req.body;
    
    rosbridgeService.publish('/cmd_vel', 'geometry_msgs/Twist', {
      linear: { x: linear.x || 0, y: linear.y || 0, z: linear.z || 0 },
      angular: { x: angular.x || 0, y: angular.y || 0, z: angular.z || 0 },
    });

    res.json({ message: 'Motion command sent' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to control motion' });
  }
};

export const stopMotion = async (req: Request, res: Response) => {
  try {
    rosbridgeService.publish('/cmd_vel', 'geometry_msgs/Twist', {
      linear: { x: 0, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: 0 },
    });

    res.json({ message: 'Robot stopped' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to stop robot' });
  }
};

export const controlSpray = async (req: Request, res: Response) => {
  try {
    const { pump, leftArm, rightArm, leftValve, rightValve, height } = req.body;

    if (pump !== undefined) {
      rosbridgeService.publish('/spray/pump_control', 'std_msgs/Bool', { data: pump });
    }
    if (leftArm !== undefined) {
      rosbridgeService.publish('/spray/left_arm_control', 'std_msgs/String', { data: leftArm });
    }
    if (rightArm !== undefined) {
      rosbridgeService.publish('/spray/right_arm_control', 'std_msgs/String', { data: rightArm });
    }
    if (leftValve !== undefined) {
      rosbridgeService.publish('/spray/left_valve_control', 'std_msgs/Bool', { data: leftValve });
    }
    if (rightValve !== undefined) {
      rosbridgeService.publish('/spray/right_valve_control', 'std_msgs/Bool', { data: rightValve });
    }
    if (height !== undefined) {
      rosbridgeService.publish('/spray/height_control', 'std_msgs/Float32', { data: height });
    }

    res.json({ message: 'Spray control command sent' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to control spray' });
  }
};

export const startNavigation = async (req: Request, res: Response) => {
  try {
    const { goal } = req.body;
    
    rosbridgeService.callService('/navigate_to_pose', 'nav2_msgs/NavigateToPose', {
      pose: {
        header: { frame_id: 'map' },
        pose: goal,
      },
    });

    res.json({ message: 'Navigation started' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start navigation' });
  }
};

export const stopNavigation = async (req: Request, res: Response) => {
  try {
    rosbridgeService.callService('/cancel_navigation', 'std_srvs/Empty', {});
    res.json({ message: 'Navigation cancelled' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to stop navigation' });
  }
};
