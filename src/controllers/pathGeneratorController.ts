import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { MapModel } from '../models';
import rosbridgeService from '../services/rosbridgeService';

export const generateAutoPath = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { mapId, mode, params, coverageArea } = req.body;

    console.log('[Path Generator] Request received:', {
      mapId,
      mode,
      params,
      coverageArea,
    });

    const map = await MapModel.findByPk(mapId);
    if (!map) {
      res.status(404).json({ error: 'Map not found' });
      return;
    }

    const pathGenerationRequest = {
      map_id: mapId,
      mode: mode,
      params: params,
      coverage_area: coverageArea,
    };

    console.log('[Path Generator] Publishing to ROS:', pathGenerationRequest);

    try {
      const result = await new Promise<any>((resolve, reject) => {
        const id = `path_generate_${Date.now()}`;
        
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
            console.error('[Path Generator] Error parsing service response:', error);
            reject(error);
          }
        };

        rosbridgeService.getRosbridge()?.on('message', messageHandler);

        setTimeout(() => {
          rosbridgeService.getRosbridge()?.removeListener('message', messageHandler);
          reject(new Error('Service call timeout'));
        }, 30000);

        rosbridgeService.callService(
          '/path_generator/generate',
          'std_srvs/Trigger',
          { request: JSON.stringify(pathGenerationRequest) }
        );
      });

      console.log('[Path Generator] ROS response received:', result);

      if (!result.success) {
        res.status(400).json({
          error: 'Path generation failed',
          message: result.message,
        });
        return;
      }

      res.json({
        success: true,
        message: 'Path generated successfully',
        pathId: result.path_id,
        points: result.path_points,
        metadata: {
          totalLength: result.total_length,
          estimatedTime: result.estimated_time,
          turnCount: result.turn_count,
        },
      });
    } catch (rosError) {
      console.error('[Path Generator] ROS service call failed:', rosError);
      
      if (rosError instanceof Error && rosError.message.includes('timeout')) {
        res.status(504).json({
          error: 'Path generation service timeout',
          message: 'The path generation request timed out. Please try again.',
        });
      } else {
        res.status(503).json({
          error: 'Path generation service not available',
          message: 'The path generation ROS node is not running. Please start the path_generator_service.',
        });
      }
    }
  } catch (error) {
    console.error('[Path Generator] Internal error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const savePath = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { pathId, name, description, points, metadata } = req.body;

    console.log('[Path Generator] Save path request:', {
      pathId,
      name,
      description,
      pointsCount: points?.length,
      metadata,
    });

    const savedPath = {
      path_id: pathId,
      name: name || `Path_${Date.now()}`,
      description: description || '',
      points: points,
      metadata: metadata || {},
      created_by: req.user?.id || 'system',
      created_at: new Date().toISOString(),
    };

    try {
      const result = await new Promise<any>((resolve, reject) => {
        const id = `path_save_${Date.now()}`;
        
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
            console.error('[Path Generator] Error parsing service response:', error);
            reject(error);
          }
        };

        rosbridgeService.getRosbridge()?.on('message', messageHandler);

        setTimeout(() => {
          rosbridgeService.getRosbridge()?.removeListener('message', messageHandler);
          reject(new Error('Service call timeout'));
        }, 10000);

        rosbridgeService.callService(
          '/path_generator/save',
          'std_srvs/Trigger',
          { request: JSON.stringify(savedPath) }
        );
      });

      res.json({
        success: true,
        message: 'Path saved successfully',
        path: savedPath,
      });
    } catch (rosError) {
      console.error('[Path Generator] Save path failed:', rosError);
      res.status(500).json({
        error: 'Failed to save path',
        message: rosError instanceof Error ? rosError.message : 'Unknown error',
      });
    }
  } catch (error) {
    console.error('[Path Generator] Internal error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const exportPath = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { pathId } = req.params;

    console.log('[Path Generator] Export path request:', { pathId });

    try {
      const result = await new Promise<any>((resolve, reject) => {
        const id = `path_export_${Date.now()}`;
        
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
            console.error('[Path Generator] Error parsing service response:', error);
            reject(error);
          }
        };

        rosbridgeService.getRosbridge()?.on('message', messageHandler);

        setTimeout(() => {
          rosbridgeService.getRosbridge()?.removeListener('message', messageHandler);
          reject(new Error('Service call timeout'));
        }, 10000);

        rosbridgeService.callService(
          '/path_generator/export',
          'std_srvs/Trigger',
          { request: JSON.stringify({ path_id: pathId }) }
        );
      });

      res.json({
        success: true,
        message: 'Path exported successfully',
        nav2Route: result.nav2_route,
        yamlContent: result.yaml_content,
      });
    } catch (rosError) {
      console.error('[Path Generator] Export path failed:', rosError);
      res.status(500).json({
        error: 'Failed to export path',
        message: rosError instanceof Error ? rosError.message : 'Unknown error',
      });
    }
  } catch (error) {
    console.error('[Path Generator] Internal error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const loadPath = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { pathId } = req.params;

    console.log('[Path Generator] Load path request:', { pathId });

    try {
      const result = await new Promise<any>((resolve, reject) => {
        const id = `path_load_${Date.now()}`;
        
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
            console.error('[Path Generator] Error parsing service response:', error);
            reject(error);
          }
        };

        rosbridgeService.getRosbridge()?.on('message', messageHandler);

        setTimeout(() => {
          rosbridgeService.getRosbridge()?.removeListener('message', messageHandler);
          reject(new Error('Service call timeout'));
        }, 10000);

        rosbridgeService.callService(
          '/path_generator/load',
          'std_srvs/Trigger',
          { request: JSON.stringify({ path_id: pathId }) }
        );
      });

      res.json({
        success: true,
        path: {
          pathId: result.path_id,
          name: result.name,
          description: result.description,
          points: result.points,
          metadata: result.metadata,
          createdAt: result.created_at,
        },
      });
    } catch (rosError) {
      console.error('[Path Generator] Load path failed:', rosError);
      res.status(404).json({
        error: 'Path not found',
        message: rosError instanceof Error ? rosError.message : 'Unknown error',
      });
    }
  } catch (error) {
    console.error('[Path Generator] Internal error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const listPaths = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { mapId } = req.query;

    console.log('[Path Generator] List paths request:', { mapId });

    try {
      const result = await new Promise<any>((resolve, reject) => {
        const id = `path_list_${Date.now()}`;
        
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
            console.error('[Path Generator] Error parsing service response:', error);
            reject(error);
          }
        };

        rosbridgeService.getRosbridge()?.on('message', messageHandler);

        setTimeout(() => {
          rosbridgeService.getRosbridge()?.removeListener('message', messageHandler);
          reject(new Error('Service call timeout'));
        }, 10000);

        rosbridgeService.callService(
          '/path_generator/list',
          'std_srvs/Trigger',
          { request: JSON.stringify({ map_id: mapId || '' }) }
        );
      });

      res.json({
        success: true,
        paths: result.paths || [],
      });
    } catch (rosError) {
      console.error('[Path Generator] List paths failed:', rosError);
      res.status(500).json({
        error: 'Failed to list paths',
        message: rosError instanceof Error ? rosError.message : 'Unknown error',
      });
    }
  } catch (error) {
    console.error('[Path Generator] Internal error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deletePath = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { pathId } = req.params;

    console.log('[Path Generator] Delete path request:', { pathId });

    try {
      const result = await new Promise<any>((resolve, reject) => {
        const id = `path_delete_${Date.now()}`;
        
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
            console.error('[Path Generator] Error parsing service response:', error);
            reject(error);
          }
        };

        rosbridgeService.getRosbridge()?.on('message', messageHandler);

        setTimeout(() => {
          rosbridgeService.getRosbridge()?.removeListener('message', messageHandler);
          reject(new Error('Service call timeout'));
        }, 10000);

        rosbridgeService.callService(
          '/path_generator/delete',
          'std_srvs/Trigger',
          { request: JSON.stringify({ path_id: pathId }) }
        );
      });

      res.json({
        success: true,
        message: 'Path deleted successfully',
      });
    } catch (rosError) {
      console.error('[Path Generator] Delete path failed:', rosError);
      res.status(500).json({
        error: 'Failed to delete path',
        message: rosError instanceof Error ? rosError.message : 'Unknown error',
      });
    }
  } catch (error) {
    console.error('[Path Generator] Internal error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const validatePath = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { points, mapId } = req.body;

    console.log('[Path Generator] Validate path request:', {
      pointsCount: points?.length,
      mapId,
    });

    try {
      const result = await new Promise<any>((resolve, reject) => {
        const id = `path_validate_${Date.now()}`;
        
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
            console.error('[Path Generator] Error parsing service response:', error);
            reject(error);
          }
        };

        rosbridgeService.getRosbridge()?.on('message', messageHandler);

        setTimeout(() => {
          rosbridgeService.getRosbridge()?.removeListener('message', messageHandler);
          reject(new Error('Service call timeout'));
        }, 10000);

        rosbridgeService.callService(
          '/path_generator/validate',
          'std_srvs/Trigger',
          { request: JSON.stringify({ points, map_id: mapId }) }
        );
      });

      res.json({
        success: true,
        isValid: result.is_valid,
        issues: result.issues || [],
        warnings: result.warnings || [],
      });
    } catch (rosError) {
      console.error('[Path Generator] Validate path failed:', rosError);
      res.status(500).json({
        error: 'Failed to validate path',
        message: rosError instanceof Error ? rosError.message : 'Unknown error',
      });
    }
  } catch (error) {
    console.error('[Path Generator] Internal error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
