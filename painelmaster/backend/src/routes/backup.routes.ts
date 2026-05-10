import { Router } from 'express';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.js';
import {
  createBackup,
  getBackups,
  restoreBackupFile,
  removeBackup,
  downloadBackup,
  // resetDatabase, // Temporariamente desabilitado
} from '../controllers/backup.controller.js';

const router = Router();

// Todas as rotas requerem autenticação e apenas SUPER_ADMIN ou ADMIN
router.use(authMiddleware);
router.use(requireRole('SUPER_ADMIN', 'ADMIN'));

router.post('/', createBackup);
router.get('/', getBackups);
router.post('/restore/:filename', restoreBackupFile);
// router.post('/reset', resetDatabase); // Temporariamente desabilitado
router.delete('/:filename', removeBackup);
router.get('/download/:filename', downloadBackup);

export default router;
