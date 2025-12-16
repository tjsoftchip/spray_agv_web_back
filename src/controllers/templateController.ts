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

    const navigationPoints = [...(template.navigationPoints || [])];
    const newPoint = {
      id: `nav_${Date.now()}`,
      ...req.body,
    };

    navigationPoints.push(newPoint);
    
    // 使用 set + changed 确保 Sequelize 检测到 JSON 字段的变化
    template.set('navigationPoints', navigationPoints);
    template.changed('navigationPoints', true);
    await template.save();
    
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

    const navigationPoints = [...(template.navigationPoints || [])];
    const pointIndex = navigationPoints.findIndex((p: any) => p.id === pointId);
    
    if (pointIndex === -1) {
      res.status(404).json({ error: 'Navigation point not found' });
      return;
    }

    navigationPoints[pointIndex] = { ...navigationPoints[pointIndex], ...req.body };
    
    template.set('navigationPoints', navigationPoints);
    template.changed('navigationPoints', true);
    await template.save();
    
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

    const navigationPoints = [...(template.navigationPoints || [])];
    const filteredPoints = navigationPoints.filter((p: any) => p.id !== pointId);
    
    // 级联删除：删除所有引用该导航点的路段
    const roadSegments = [...(template.roadSegments || [])];
    const filteredSegments = roadSegments.filter(
      (s: any) => s.startNavPointId !== pointId && s.endNavPointId !== pointId
    );
    
    const deletedSegmentsCount = roadSegments.length - filteredSegments.length;
    
    template.set('navigationPoints', filteredPoints);
    template.changed('navigationPoints', true);
    
    if (deletedSegmentsCount > 0) {
      template.set('roadSegments', filteredSegments);
      template.changed('roadSegments', true);
    }
    
    await template.save();
    
    res.json({ 
      message: 'Navigation point deleted successfully',
      deletedSegmentsCount 
    });
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

    const navigationPoints = [...(template.navigationPoints || [])];
    const reorderedPoints: any[] = [];
    
    pointIds.forEach((id: string, index: number) => {
      const point = navigationPoints.find((p: any) => p.id === id);
      if (point) {
        reorderedPoints.push({ ...point, order: index + 1 });
      }
    });
    
    template.set('navigationPoints', reorderedPoints);
    template.changed('navigationPoints', true);
    await template.save();
    
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
    
    template.set('roadSegments', roadSegments);
    template.changed('roadSegments', true);
    await template.save();
    
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

    const updatedSegments = [...roadSegments];
    updatedSegments[segmentIndex] = { ...updatedSegments[segmentIndex], ...req.body };
    
    template.set('roadSegments', updatedSegments);
    template.changed('roadSegments', true);
    await template.save();
    
    res.json(updatedSegments[segmentIndex]);
  } catch (error) {
    console.error('Update road segment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const addRoadSegment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { templateId } = req.params;
    const template = await Template.findByPk(templateId);
    
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    const roadSegments = [...(template.roadSegments || [])];
    const newSegment = {
      id: `segment_${Date.now()}`,
      ...req.body,
    };

    roadSegments.push(newSegment);
    
    template.set('roadSegments', roadSegments);
    template.changed('roadSegments', true);
    await template.save();
    
    res.status(201).json(newSegment);
  } catch (error) {
    console.error('Add road segment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deleteRoadSegment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { templateId, segmentId } = req.params;
    const template = await Template.findByPk(templateId);
    
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    const roadSegments = [...(template.roadSegments || [])];
    const filteredSegments = roadSegments.filter((s: any) => s.id !== segmentId);
    
    template.set('roadSegments', filteredSegments);
    template.changed('roadSegments', true);
    await template.save();
    
    res.json({ message: 'Road segment deleted successfully' });
  } catch (error) {
    console.error('Delete road segment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 获取当前机器人位置
export const getCurrentRobotPosition = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // 从ROS2获取当前机器人位置
    const rosbridgeService = require('../services/rosbridgeService').default;
    
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
    res.json({
      position: { x: 0, y: 0, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    });
  }
};

export const generatePathPreview = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const template = await Template.findByPk(id);
    
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    const points = template.navigationPoints || [];
    if (points.length < 2) {
      res.json({
        points: [],
        totalDistance: 0,
        estimatedTime: 0,
      });
      return;
    }

    const pathPoints = [];
    let totalDistance = 0;
    
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i].position;
      const p2 = points[i + 1].position;
      
      pathPoints.push({ x: p1.x, y: p1.y });
      
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      totalDistance += distance;
    }
    
    pathPoints.push({ 
      x: points[points.length - 1].position.x, 
      y: points[points.length - 1].position.y 
    });

    const avgSpeed = 0.26;
    const estimatedTime = totalDistance / avgSpeed;

    res.json({
      points: pathPoints,
      totalDistance: totalDistance.toFixed(2),
      estimatedTime: Math.ceil(estimatedTime),
    });
  } catch (error) {
    console.error('Generate path preview error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const validateNavigation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const template = await Template.findByPk(id);
    
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    const points = template.navigationPoints || [];
    const issues = [];

    if (points.length === 0) {
      issues.push({ pointId: null, issue: '没有配置导航点' });
    }

    for (const point of points) {
      if (!point.position || point.position.x === undefined || point.position.y === undefined) {
        issues.push({ pointId: point.id, issue: '位置坐标不完整' });
      }
      
      if (!point.orientation || point.orientation.w === undefined) {
        issues.push({ pointId: point.id, issue: '朝向数据不完整' });
      }
      
      const qNorm = Math.sqrt(
        Math.pow(point.orientation.x, 2) +
        Math.pow(point.orientation.y, 2) +
        Math.pow(point.orientation.z, 2) +
        Math.pow(point.orientation.w, 2)
      );
      
      if (Math.abs(qNorm - 1.0) > 0.01) {
        issues.push({ pointId: point.id, issue: '四元数未归一化' });
      }
    }

    res.json({
      valid: issues.length === 0,
      issues,
    });
  } catch (error) {
    console.error('Validate navigation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
