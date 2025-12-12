import { Router } from 'express';
import { login, logout, refreshToken } from '../controllers/authController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/login', login);
router.post('/logout', authenticate, logout);
router.post('/refresh', refreshToken);

export default router;
