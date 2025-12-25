import express from 'express';
import * as pathGeneratorController from '../controllers/pathGeneratorController';
import { authenticate } from '../middleware/auth';

const router = express.Router();

router.post('/generate-auto', authenticate, pathGeneratorController.generateAutoPath);
router.post('/save', authenticate, pathGeneratorController.savePath);
router.get('/export/:pathId', authenticate, pathGeneratorController.exportPath);
router.get('/load/:pathId', authenticate, pathGeneratorController.loadPath);
router.get('/list', authenticate, pathGeneratorController.listPaths);
router.delete('/:pathId', authenticate, pathGeneratorController.deletePath);
router.post('/validate', authenticate, pathGeneratorController.validatePath);

export default router;
