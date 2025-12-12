import { Router } from 'express';
import * as supplyStationController from '../controllers/supplyStationController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', supplyStationController.getSupplyStations);
router.get('/:id', supplyStationController.getSupplyStation);
router.post('/', supplyStationController.createSupplyStation);
router.put('/:id', supplyStationController.updateSupplyStation);
router.delete('/:id', supplyStationController.deleteSupplyStation);

export default router;
