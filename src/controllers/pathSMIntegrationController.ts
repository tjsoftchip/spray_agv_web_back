import { Request, Response } from 'express';
import rosbridgeService from '../services/rosbridgeService';

interface AuthRequest extends Request {
  userId?: number;
}

export const startPathTask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { taskId, pathId, mode } = req.body;

    console.log('[Path SM Integration] Start task request:', {
      taskId,
      pathId,
      mode,
    });

    if (!pathId) {
      res.status(400).json({ error: 'Path ID is required' });
      return;
    }

    if (!mode || !['spray', 'resupply', 'patrol'].includes(mode)) {
      res.status(400).json({ error: 'Invalid mode. Must be spray, resupply, or patrol' });
      return;
    }

    const taskRequest = {
      task_id: taskId || `task_${Date.now()}`,
      path_id: pathId,
      mode: mode,
    };

    console.log('[Path SM Integration] Publishing to ROS:', taskRequest);

    try {
      const result = await new Promise<any>((resolve, reject) => {
        const id = `path_sm_start_${Date.now()}`;
        
        const messageHandler = (data: any) => {
          try {
            const message = JSON.parse(data.toString());
            if (message.op === 'service_response' && message.id === id) {
              rosbridgeService.getRosbridge()?.removeListener('message', messageHandler);
              
              if (message.values && message.values.result) {
                const resultData = JSON.parse(message.values.result);
                resolve(resultData);
              } else {
                reject(new Error('Service call failed'));
              }
            }
          } catch (error) {
            console.error('[Path SM Integration] Error parsing service response:', error);
            reject(error);
          }
        };

        rosbridgeService.getRosbridge()?.on('message', messageHandler);

        setTimeout(() => {
          rosbridgeService.getRosbridge()?.removeListener('message', messageHandler);
          reject(new Error('Service call timeout'));
        }, 30000);

        rosbridgeService.callService(
          '/path_sm_integration/start_path_task',
          'std_srvs/Trigger',
          { request: JSON.stringify(taskRequest) }
        );
      });

      console.log('[Path SM Integration] ROS response received:', result);

      if (!result.success) {
        res.status(400).json({
          error: 'Failed to start path task',
          message: result.message,
        });
        return;
      }

      res.json({
        success: true,
        message: result.message,
        taskId: taskRequest.task_id,
      });
    } catch (rosError) {
      console.error('[Path SM Integration] ROS service call failed:', rosError);
      
      if (rosError instanceof Error && rosError.message.includes('timeout')) {
        res.status(504).json({
          error: 'Path SM integration service timeout',
          message: 'The path task start request timed out. Please try again.',
        });
      } else {
        res.status(503).json({
          error: 'Path SM integration service not available',
          message: 'The path state machine integration ROS node is not running. Please start the path_sm_integration node.',
        });
      }
    }
  } catch (error) {
    console.error('[Path SM Integration] Internal error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const completePathTask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    console.log('[Path SM Integration] Complete task request');

    try {
      const result = await new Promise<any>((resolve, reject) => {
        const id = `path_sm_complete_${Date.now()}`;
        
        const messageHandler = (data: any) => {
          try {
            const message = JSON.parse(data.toString());
            if (message.op === 'service_response' && message.id === id) {
              rosbridgeService.getRosbridge()?.removeListener('message', messageHandler);
              
              if (message.values && message.values.result) {
                const resultData = JSON.parse(message.values.result);
                resolve(resultData);
              } else {
                reject(new Error('Service call failed'));
              }
            }
          } catch (error) {
            console.error('[Path SM Integration] Error parsing service response:', error);
            reject(error);
          }
        };

        rosbridgeService.getRosbridge()?.on('message', messageHandler);

        setTimeout(() => {
          rosbridgeService.getRosbridge()?.removeListener('message', messageHandler);
          reject(new Error('Service call timeout'));
        }, 10000);

        rosbridgeService.callService(
          '/path_sm_integration/complete_path_task',
          'std_srvs/Trigger',
          { request: '{}' }
        );
      });

      console.log('[Path SM Integration] ROS response received:', result);

      if (!result.success) {
        res.status(400).json({
          error: 'Failed to complete path task',
          message: result.message,
        });
        return;
      }

      res.json({
        success: true,
        message: result.message,
      });
    } catch (rosError) {
      console.error('[Path SM Integration] ROS service call failed:', rosError);
      
      if (rosError instanceof Error && rosError.message.includes('timeout')) {
        res.status(504).json({
          error: 'Path SM integration service timeout',
          message: 'The path task complete request timed out. Please try again.',
        });
      } else {
        res.status(503).json({
          error: 'Path SM integration service not available',
          message: 'The path state machine integration ROS node is not running.',
        });
      }
    }
  } catch (error) {
    console.error('[Path SM Integration] Internal error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const abortPathTask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    console.log('[Path SM Integration] Abort task request');

    try {
      const result = await new Promise<any>((resolve, reject) => {
        const id = `path_sm_abort_${Date.now()}`;
        
        const messageHandler = (data: any) => {
          try {
            const message = JSON.parse(data.toString());
            if (message.op === 'service_response' && message.id === id) {
              rosbridgeService.getRosbridge()?.removeListener('message', messageHandler);
              
              if (message.values && message.values.result) {
                const resultData = JSON.parse(message.values.result);
                resolve(resultData);
              } else {
                reject(new Error('Service call failed'));
              }
            }
          } catch (error) {
            console.error('[Path SM Integration] Error parsing service response:', error);
            reject(error);
          }
        };

        rosbridgeService.getRosbridge()?.on('message', messageHandler);

        setTimeout(() => {
          rosbridgeService.getRosbridge()?.removeListener('message', messageHandler);
          reject(new Error('Service call timeout'));
        }, 10000);

        rosbridgeService.callService(
          '/path_sm_integration/abort_path_task',
          'std_srvs/Trigger',
          { request: '{}' }
        );
      });

      console.log('[Path SM Integration] ROS response received:', result);

      if (!result.success) {
        res.status(400).json({
          error: 'Failed to abort path task',
          message: result.message,
        });
        return;
      }

      res.json({
        success: true,
        message: result.message,
      });
    } catch (rosError) {
      console.error('[Path SM Integration] ROS service call failed:', rosError);
      
      if (rosError instanceof Error && rosError.message.includes('timeout')) {
        res.status(504).json({
          error: 'Path SM integration service timeout',
          message: 'The path task abort request timed out. Please try again.',
        });
      } else {
        res.status(503).json({
          error: 'Path SM integration service not available',
          message: 'The path state machine integration ROS node is not running.',
        });
      }
    }
  } catch (error) {
    console.error('[Path SM Integration] Internal error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getTaskStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    console.log('[Path SM Integration] Get task status request');

    try {
      const result = await new Promise<any>((resolve, reject) => {
        const id = `path_sm_status_${Date.now()}`;
        
        const messageHandler = (data: any) => {
          try {
            const message = JSON.parse(data.toString());
            if (message.op === 'service_response' && message.id === id) {
              rosbridgeService.getRosbridge()?.removeListener('message', messageHandler);
              
              if (message.values && message.values.result) {
                const resultData = JSON.parse(message.values.result);
                resolve(resultData);
              } else {
                reject(new Error('Service call failed'));
              }
            }
          } catch (error) {
            console.error('[Path SM Integration] Error parsing service response:', error);
            reject(error);
          }
        };

        rosbridgeService.getRosbridge()?.on('message', messageHandler);

        setTimeout(() => {
          rosbridgeService.getRosbridge()?.removeListener('message', messageHandler);
          reject(new Error('Service call timeout'));
        }, 10000);

        rosbridgeService.callService(
          '/path_sm_integration/get_task_status',
          'std_srvs/Trigger',
          { request: '{}' }
        );
      });

      console.log('[Path SM Integration] ROS response received:', result);

      if (!result.success) {
        res.status(400).json({
          error: 'Failed to get task status',
          message: result.message,
        });
        return;
      }

      const statusData = JSON.parse(result.message);
      
      res.json({
        success: true,
        taskStatus: statusData,
      });
    } catch (rosError) {
      console.error('[Path SM Integration] ROS service call failed:', rosError);
      
      if (rosError instanceof Error && rosError.message.includes('timeout')) {
        res.status(504).json({
          error: 'Path SM integration service timeout',
          message: 'The task status request timed out. Please try again.',
        });
      } else {
        res.status(503).json({
          error: 'Path SM integration service not available',
          message: 'The path state machine integration ROS node is not running.',
        });
      }
    }
  } catch (error) {
    console.error('[Path SM Integration] Internal error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
