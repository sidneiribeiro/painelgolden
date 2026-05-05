import { Router } from 'express';
import {
  listImportSources,
  getImportSource,
  createImportSource,
  updateImportSource,
  deleteImportSource,
  importFromSource,
  importCascade
} from '../controllers/import-source.controller.js';

const router = Router();

/**
 * 📥 Rotas para gerenciar fontes de importação M3U
 */

// Importação em cascata (todas as fontes) - DEVE vir ANTES de /:id
router.post('/cascade/import', importCascade);

// CRUD básico
router.get('/', listImportSources);
router.get('/:id', getImportSource);
router.post('/', createImportSource);
router.put('/:id', updateImportSource);
router.delete('/:id', deleteImportSource);

// Executar importação de uma fonte específica
router.post('/:id/import', importFromSource);

export default router;
