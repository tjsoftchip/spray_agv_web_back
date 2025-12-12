import { Request, Response } from 'express';
import { SupplyStation } from '../models';

export const getSupplyStations = async (req: Request, res: Response) => {
  try {
    const stations = await SupplyStation.findAll();
    res.json(stations);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch supply stations' });
  }
};

export const getSupplyStation = async (req: Request, res: Response) => {
  try {
    const station = await SupplyStation.findByPk(req.params.id);
    if (!station) {
      return res.status(404).json({ error: 'Supply station not found' });
    }
    res.json(station);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch supply station' });
  }
};

export const createSupplyStation = async (req: Request, res: Response) => {
  try {
    const station = await SupplyStation.create(req.body);
    res.status(201).json(station);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create supply station' });
  }
};

export const updateSupplyStation = async (req: Request, res: Response) => {
  try {
    const station = await SupplyStation.findByPk(req.params.id);
    if (!station) {
      return res.status(404).json({ error: 'Supply station not found' });
    }
    await station.update(req.body);
    res.json(station);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update supply station' });
  }
};

export const deleteSupplyStation = async (req: Request, res: Response) => {
  try {
    const station = await SupplyStation.findByPk(req.params.id);
    if (!station) {
      return res.status(404).json({ error: 'Supply station not found' });
    }
    await station.destroy();
    res.json({ message: 'Supply station deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete supply station' });
  }
};
