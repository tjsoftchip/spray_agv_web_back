import { Request, Response } from 'express';
import { BeamYard, NavigationPoint } from '../models';

export const getBeamYards = async (req: Request, res: Response) => {
  try {
    const yards = await BeamYard.findAll({
      include: [{ model: NavigationPoint, as: 'navigationPoints' }],
    });
    res.json(yards);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch beam yards' });
  }
};

export const getBeamYard = async (req: Request, res: Response) => {
  try {
    const yard = await BeamYard.findByPk(req.params.id, {
      include: [{ model: NavigationPoint, as: 'navigationPoints' }],
    });
    if (!yard) {
      return res.status(404).json({ error: 'Beam yard not found' });
    }
    res.json(yard);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch beam yard' });
  }
};

export const createBeamYard = async (req: Request, res: Response) => {
  try {
    const yard = await BeamYard.create(req.body);
    res.status(201).json(yard);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create beam yard' });
  }
};

export const updateBeamYard = async (req: Request, res: Response) => {
  try {
    const yard = await BeamYard.findByPk(req.params.id);
    if (!yard) {
      return res.status(404).json({ error: 'Beam yard not found' });
    }
    await yard.update(req.body);
    res.json(yard);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update beam yard' });
  }
};

export const deleteBeamYard = async (req: Request, res: Response) => {
  try {
    const yard = await BeamYard.findByPk(req.params.id);
    if (!yard) {
      return res.status(404).json({ error: 'Beam yard not found' });
    }
    await yard.destroy();
    res.json({ message: 'Beam yard deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete beam yard' });
  }
};

export const getNavigationPoints = async (req: Request, res: Response) => {
  try {
    const points = await NavigationPoint.findAll({
      where: { yardId: req.params.id },
      order: [['order', 'ASC']],
    });
    res.json(points);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch navigation points' });
  }
};

export const createNavigationPoint = async (req: Request, res: Response) => {
  try {
    const point = await NavigationPoint.create({
      ...req.body,
      yardId: req.params.id,
    });
    res.status(201).json(point);
  } catch (error) {
    console.error('Error creating navigation point:', error);
    res.status(500).json({ error: 'Failed to create navigation point' });
  }
};

export const updateNavigationPoint = async (req: Request, res: Response) => {
  try {
    const point = await NavigationPoint.findByPk(req.params.posId);
    if (!point) {
      return res.status(404).json({ error: 'Navigation point not found' });
    }
    await point.update(req.body);
    res.json(point);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update navigation point' });
  }
};

export const deleteNavigationPoint = async (req: Request, res: Response) => {
  try {
    const point = await NavigationPoint.findByPk(req.params.posId);
    if (!point) {
      return res.status(404).json({ error: 'Navigation point not found' });
    }
    await point.destroy();
    res.json({ message: 'Navigation point deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete navigation point' });
  }
};
