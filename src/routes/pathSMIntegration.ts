import express from 'express';
import * as pathSMIntegrationController from '../controllers/pathSMIntegrationController';
import { authenticate } from '../middleware/auth';

const router = express.Router();

router.post('/start', authenticate, pathSMIntegrationController.startPathTask);
router.post('/complete', authenticate, pathSMIntegrationController.completePathTask);
router.post('/abort', authenticate, pathSMIntegrationController.abortPathTask);
router.get('/status', authenticate, pathSMIntegrationController.getTaskStatus);

export default router;
