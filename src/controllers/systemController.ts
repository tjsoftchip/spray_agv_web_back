import { Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const startChassis = async (req: Request, res: Response) => {
  try {
    execAsync('ros2 launch yahboomcar_bringup yahboomcar_bringup_R2_launch.py &').catch(() => {});
    res.json({ message: 'Chassis starting' });
  } catch (error) {
    console.error('Error starting chassis:', error);
    res.status(500).json({ error: 'Failed to start chassis' });
  }
};

export const stopChassis = async (req: Request, res: Response) => {
  try {
    try {
      await execAsync('pkill -f yahboomcar_base_node');
    } catch (e) {}
    res.json({ message: 'Chassis stopped' });
  } catch (error) {
    console.error('Error stopping chassis:', error);
    res.status(500).json({ error: 'Failed to stop chassis' });
  }
};

export const startCamera = async (req: Request, res: Response) => {
  try {
    execAsync('ros2 launch astra_camera astro_pro_plus.launch.xml &').catch(() => {});
    res.json({ message: 'Camera starting' });
  } catch (error) {
    console.error('Error starting camera:', error);
    res.status(500).json({ error: 'Failed to start camera' });
  }
};

export const stopCamera = async (req: Request, res: Response) => {
  try {
    try {
      await execAsync('pkill -f astra_camera');
    } catch (e) {}
    res.json({ message: 'Camera stopped' });
  } catch (error) {
    console.error('Error stopping camera:', error);
    res.status(500).json({ error: 'Failed to stop camera' });
  }
};

export const startLaser = async (req: Request, res: Response) => {
  try {
    execAsync('ros2 launch yahboomcar_nav laser_bringup_launch.py &').catch(() => {});
    res.json({ message: 'Laser starting' });
  } catch (error) {
    console.error('Error starting laser:', error);
    res.status(500).json({ error: 'Failed to start laser' });
  }
};

export const stopLaser = async (req: Request, res: Response) => {
  try {
    try {
      await execAsync('pkill -f laser_node');
    } catch (e) {}
    res.json({ message: 'Laser stopped' });
  } catch (error) {
    console.error('Error stopping laser:', error);
    res.status(500).json({ error: 'Failed to stop laser' });
  }
};

export const startPerception = async (req: Request, res: Response) => {
  try {
    execAsync('ros2 launch astra_camera astro_pro_plus.launch.xml &').catch(() => {});
    execAsync('ros2 launch yahboomcar_nav laser_bringup_launch.py &').catch(() => {});
    res.json({ message: 'Perception system starting' });
  } catch (error) {
    console.error('Error starting perception:', error);
    res.status(500).json({ error: 'Failed to start perception' });
  }
};

export const stopPerception = async (req: Request, res: Response) => {
  try {
    try {
      await execAsync('pkill -f "astra_camera|laser_node"');
    } catch (e) {}
    res.json({ message: 'Perception system stopped' });
  } catch (error) {
    console.error('Error stopping perception:', error);
    res.status(500).json({ error: 'Failed to stop perception' });
  }
};

export const getConfig = async (req: Request, res: Response) => {
  try {
    const config = {
      operationSpeed: 0.35,
      sprayDuration: 300,
      waterThreshold: 10,
      batteryThreshold: 20,
      autoSupplyEnabled: true,
      armHeightMin: 0.5,
      armHeightMax: 2.5,
      armHeightDefault: 1.8,
      maxLinearSpeed: 0.5,
      maxAngularSpeed: 1.0,
    };
    res.json(config);
  } catch (error) {
    console.error('Error fetching config:', error);
    res.status(500).json({ error: 'Failed to fetch config' });
  }
};

export const updateConfig = async (req: Request, res: Response) => {
  try {
    res.json({ message: 'Config updated', config: req.body });
  } catch (error) {
    console.error('Error updating config:', error);
    res.status(500).json({ error: 'Failed to update config' });
  }
};

export const getLogs = async (req: Request, res: Response) => {
  try {
    const { stdout } = await execAsync('tail -100 /tmp/backend.log');
    res.json({ logs: stdout.split('\n') });
  } catch (error) {
    console.error('Error fetching logs:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
};
