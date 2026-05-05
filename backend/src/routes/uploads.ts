import { Router } from 'express';
import { serveStorageFile } from '../controllers/storageController.js';

const router = Router();

// Servir arquivos do storage (compatível com uploads antigos)
router.get('/logos/*', serveStorageFile);
router.get('/*', serveStorageFile);

export default router;
