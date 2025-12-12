import { Request, Response } from 'express';
import { Schedule } from '../models';

export const getSchedules = async (req: Request, res: Response) => {
  try {
    const schedules = await Schedule.findAll({
      where: { isDeleted: false },
    });
    res.json(schedules);
  } catch (error) {
    console.error('Error fetching schedules:', error);
    res.status(500).json({ error: 'Failed to fetch schedules' });
  }
};

export const getSchedule = async (req: Request, res: Response) => {
  try {
    const schedule = await Schedule.findByPk(req.params.id);
    if (!schedule || schedule.isDeleted) {
      return res.status(404).json({ error: 'Schedule not found' });
    }
    res.json(schedule);
  } catch (error) {
    console.error('Error fetching schedule:', error);
    res.status(500).json({ error: 'Failed to fetch schedule' });
  }
};

export const createSchedule = async (req: Request, res: Response) => {
  try {
    const schedule = await Schedule.create({
      ...req.body,
      executionCount: 0,
      isDeleted: false,
    });
    res.status(201).json(schedule);
  } catch (error) {
    console.error('Error creating schedule:', error);
    res.status(500).json({ error: 'Failed to create schedule' });
  }
};

export const updateSchedule = async (req: Request, res: Response) => {
  try {
    const schedule = await Schedule.findByPk(req.params.id);
    if (!schedule || schedule.isDeleted) {
      return res.status(404).json({ error: 'Schedule not found' });
    }
    await schedule.update(req.body);
    res.json(schedule);
  } catch (error) {
    console.error('Error updating schedule:', error);
    res.status(500).json({ error: 'Failed to update schedule' });
  }
};

export const deleteSchedule = async (req: Request, res: Response) => {
  try {
    const schedule = await Schedule.findByPk(req.params.id);
    if (!schedule) {
      return res.status(404).json({ error: 'Schedule not found' });
    }
    await schedule.update({ isDeleted: true });
    res.json({ message: 'Schedule deleted successfully' });
  } catch (error) {
    console.error('Error deleting schedule:', error);
    res.status(500).json({ error: 'Failed to delete schedule' });
  }
};

export const enableSchedule = async (req: Request, res: Response) => {
  try {
    const schedule = await Schedule.findByPk(req.params.id);
    if (!schedule || schedule.isDeleted) {
      return res.status(404).json({ error: 'Schedule not found' });
    }
    await schedule.update({ status: 'active' });
    res.json(schedule);
  } catch (error) {
    console.error('Error enabling schedule:', error);
    res.status(500).json({ error: 'Failed to enable schedule' });
  }
};

export const disableSchedule = async (req: Request, res: Response) => {
  try {
    const schedule = await Schedule.findByPk(req.params.id);
    if (!schedule || schedule.isDeleted) {
      return res.status(404).json({ error: 'Schedule not found' });
    }
    await schedule.update({ status: 'inactive' });
    res.json(schedule);
  } catch (error) {
    console.error('Error disabling schedule:', error);
    res.status(500).json({ error: 'Failed to disable schedule' });
  }
};
