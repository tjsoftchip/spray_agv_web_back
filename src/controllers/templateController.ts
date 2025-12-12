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
