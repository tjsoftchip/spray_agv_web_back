import { Router } from 'express';
import * as beamYardController from '../controllers/beamYardController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', beamYardController.getBeamYards);
router.get('/:id', beamYardController.getBeamYard);
router.post('/', beamYardController.createBeamYard);
router.put('/:id', beamYardController.updateBeamYard);
router.delete('/:id', beamYardController.deleteBeamYard);

router.get('/:id/positions', beamYardController.getNavigationPoints);
router.post('/:id/positions', beamYardController.createNavigationPoint);
router.put('/:id/positions/:posId', beamYardController.updateNavigationPoint);
router.delete('/:id/positions/:posId', beamYardController.deleteNavigationPoint);

export default router;
