import { Router } from 'express';
import * as mapController from '../controllers/mapController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', mapController.getMaps);
router.get('/active', mapController.getActiveMap);
router.put('/:id/active', mapController.setActiveMap);
router.post('/start-mapping', mapController.startMapping);
router.post('/stop-mapping', mapController.stopMapping);
router.post('/save', mapController.saveMap);
router.post('/:id/load', mapController.loadMap);

export default router;
