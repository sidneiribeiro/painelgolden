import { Router } from 'express';
import { getPanelSettings, getPublicPanelSettings, updatePanelName, updatePublicBaseUrl, uploadLogo, removeLogo } from '../controllers/settings.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { upload } from '../middleware/upload.js';
import { asyncHandler } from '../middleware/error.middleware.js';

const router = Router();

// Rota pública para tela de login
router.get('/panel/public', asyncHandler(getPublicPanelSettings));

// Todas as outras rotas requerem autenticação
router.use(authMiddleware);

router.get('/panel', asyncHandler(getPanelSettings));
router.put('/panel/name', asyncHandler(updatePanelName));
router.put('/panel/public-base-url', asyncHandler(updatePublicBaseUrl));
router.post('/panel/logo', upload.single('logo'), asyncHandler(uploadLogo));
router.delete('/panel/logo', asyncHandler(removeLogo));

export default router;
