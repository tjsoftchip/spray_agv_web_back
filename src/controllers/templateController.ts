import { Response } from 'express';
import { Template } from '../models';
import { AuthRequest } from '../middleware/auth';

export const getTemplates = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const templates = await Template.findAll({
      where: { isActive: true },
      order: [['createdAt', 'DESC']],
    });
    res.json(templates);
  } catch (error) {
    console.error('Get templates error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getTemplateById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const template = await Template.findByPk(id);
    
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    res.json(template);
  } catch (error) {
    console.error('Get template error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const createTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const template = await Template.create(req.body);
    res.status(201).json(template);
  } catch (error) {
    console.error('Create template error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const template = await Template.findByPk(id);
    
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    await template.update(req.body);
    res.json(template);
  } catch (error) {
    console.error('Update template error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deleteTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const template = await Template.findByPk(id);
    
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    await template.update({ isActive: false });
    res.json({ message: 'Template deleted successfully' });
  } catch (error) {
    console.error('Delete template error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 导航点管理API
export const getNavigationPoints = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { templateId } = req.params;
    const template = await Template.findByPk(templateId);
    
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    res.json(template.navigationPoints || []);
  } catch (error) {
    console.error('Get navigation points error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const addNavigationPoint = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { templateId } = req.params;
    const template = await Template.findByPk(templateId);
    
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    const navigationPoints = template.navigationPoints || [];
    const newPoint = {
      id: `nav_${Date.now()}`,
      ...req.body,
    };

    navigationPoints.push(newPoint);
    await template.update({ navigationPoints });
    
    res.status(201).json(newPoint);
  } catch (error) {
    console.error('Add navigation point error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateNavigationPoint = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { templateId, pointId } = req.params;
    const template = await Template.findByPk(templateId);
    
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    const navigationPoints = template.navigationPoints || [];
    const pointIndex = navigationPoints.findIndex((p: any) => p.id === pointId);
    
    if (pointIndex === -1) {
      res.status(404).json({ error: 'Navigation point not found' });
      return;
    }

    navigationPoints[pointIndex] = { ...navigationPoints[pointIndex], ...req.body };
    await template.update({ navigationPoints });
    
    res.json(navigationPoints[pointIndex]);
  } catch (error) {
    console.error('Update navigation point error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deleteNavigationPoint = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { templateId, pointId } = req.params;
    const template = await Template.findByPk(templateId);
    
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    const navigationPoints = template.navigationPoints || [];
    const filteredPoints = navigationPoints.filter((p: any) => p.id !== pointId);
    
    await template.update({ navigationPoints: filteredPoints });
    
    res.json({ message: 'Navigation point deleted successfully' });
  } catch (error) {
    console.error('Delete navigation point error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const reorderNavigationPoints = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { templateId } = req.params;
    const { pointIds } = req.body;
    const template = await Template.findByPk(templateId);
    
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    const navigationPoints = template.navigationPoints || [];
    const reorderedPoints: any[] = [];
    
    pointIds.forEach((id: string, index: number) => {
      const point = navigationPoints.find((p: any) => p.id === id);
      if (point) {
        reorderedPoints.push({ ...point, order: index + 1 });
      }
    });
    
    await template.update({ navigationPoints: reorderedPoints });
    
    res.json(reorderedPoints);
  } catch (error) {
    console.error('Reorder navigation points error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 路段管理API
export const getRoadSegments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { templateId } = req.params;
    const template = await Template.findByPk(templateId);
    
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    res.json(template.roadSegments || []);
  } catch (error) {
    console.error('Get road segments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const generateRoadSegments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { templateId } = req.params;
    const template = await Template.findByPk(templateId);
    
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    const navigationPoints = template.navigationPoints || [];
    if (navigationPoints.length < 2) {
      res.status(400).json({ error: 'At least 2 navigation points are required' });
      return;
    }

    // 按顺序排序导航点
    const sortedPoints = navigationPoints.sort((a: any, b: any) => a.order - b.order);
    
    // 生成路段
    const roadSegments: any[] = [];
    for (let i = 0; i < sortedPoints.length - 1; i++) {
      const startPoint = sortedPoints[i];
      const endPoint = sortedPoints[i + 1];
      
      roadSegments.push({
        id: `segment_${Date.now()}_${i}`,
        startNavPointId: startPoint.id,
        endNavPointId: endPoint.id,
        sprayParams: {
          pumpStatus: true,
          leftArmStatus: 'open',
          rightArmStatus: 'open',
          leftValveStatus: true,
          rightValveStatus: true,
          armHeight: 1.0,
        },
        operationSpeed: 0.35,
      });
    }
    
    await template.update({ roadSegments });
    
    res.json(roadSegments);
  } catch (error) {
    console.error('Generate road segments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateRoadSegment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { templateId, segmentId } = req.params;
    const template = await Template.findByPk(templateId);
    
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    const roadSegments = template.roadSegments || [];
    const segmentIndex = roadSegments.findIndex((s: any) => s.id === segmentId);
    
    if (segmentIndex === -1) {
      res.status(404).json({ error: 'Road segment not found' });
      return;
    }

    roadSegments[segmentIndex] = { ...roadSegments[segmentIndex], ...req.body };
    await template.update({ roadSegments });
    
    res.json(roadSegments[segmentIndex]);
  } catch (error) {
    console.error('Update road segment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 获取当前机器人位置
export const getCurrentRobotPosition = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // 从ROS2获取当前机器人位置
    const rosbridgeService = require('../services/rosbridgeService');
    
    // 获取机器人位姿
    const pose = await rosbridgeService.getRobotPose();
    
    if (!pose) {
      // 如果无法获取真实位置，返回默认位置
      res.json({
        position: { x: 0, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      });
      return;
    }
    
    res.json({
      position: {
        x: pose.position.x || 0,
        y: pose.position.y || 0,
        z: pose.position.z || 0,
      },
      orientation: {
        x: pose.orientation.x || 0,
        y: pose.orientation.y || 0,
        z: pose.orientation.z || 0,
        w: pose.orientation.w || 1,
      },
    });
  } catch (error) {
    console.error('Get current robot position error:', error);
    // 发生错误时返回默认位置
    res.json({
      position: { x: 0, y: 0, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    });
  }
};
