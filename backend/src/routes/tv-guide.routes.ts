import { Router } from 'express';
import { refreshTVGuide, getTVEvents, getTVChannels, upsertTVChannel } from '../controllers/tv-guide.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

// Requer autenticação
router.post('/refresh', authMiddleware, refreshTVGuide);
router.get('/events', authMiddleware, getTVEvents);
router.get('/channels', authMiddleware, getTVChannels);
router.post('/channels', authMiddleware, upsertTVChannel);

export default router;

