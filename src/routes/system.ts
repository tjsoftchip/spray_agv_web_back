import { Router } from 'express';
import * as systemController from '../controllers/systemController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.post('/nodes/chassis/start', systemController.startChassis);
router.post('/nodes/chassis/stop', systemController.stopChassis);
router.post('/nodes/camera/start', systemController.startCamera);
router.post('/nodes/camera/stop', systemController.stopCamera);
router.post('/nodes/laser/start', systemController.startLaser);
router.post('/nodes/laser/stop', systemController.stopLaser);
router.post('/nodes/perception/start', systemController.startPerception);
router.post('/nodes/perception/stop', systemController.stopPerception);

router.get('/config', systemController.getConfig);
router.put('/config', systemController.updateConfig);
router.get('/logs', systemController.getLogs);

export default router;
