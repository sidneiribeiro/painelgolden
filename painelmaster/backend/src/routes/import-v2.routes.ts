/**
 * Rotas de Importação v2 (NOVA VERSÃO REFATORADA)
 * 
 * SEGURO: Rota separada para testar o novo sistema
 * Não interfere com o sistema atual
 * 
 * Endpoints:
 *   GET  /api/import-v2/preview     - Preview M3U sem importar
 *   POST /api/import-v2/movies      - Importar filmes
 *   POST /api/import-v2/series      - Importar séries
 *   POST /api/import-v2/live        - Importar canais LIVE
 *   GET  /api/import-v2/categories  - Listar categorias
 *   GET  /api/import-v2/bouquets    - Listar bouquets
 */

import { Router, Request, Response } from 'express';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.js';
import { prisma } from '../config/database.js';
import { createLogger } from '../utils/logger.js';
import { 
  ImportService, 
  CategoryManager, 
  BouquetManager,
  M3UParser 
} from '../services/import/index.js';

const logger = createLogger('ImportV2Routes');
const router = Router();

// ⚠️ PROTEÇÃO: Todas as rotas requerem autenticação
// Apenas SUPER_ADMIN, ADMIN e MASTER_RESELLER podem acessar
router.use(authMiddleware);
router.use(requireRole('SUPER_ADMIN'));

/**
 * GET /api/import-v2/preview
 * Preview do M3U sem importar
 */
router.get('/preview', async (req: Request, res: Response) => {
  try {
    const { url, serverId } = req.query;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL do M3U é obrigatória' });
    }

    // Buscar servidor
    const server = await getServer(serverId as string);
    if (!server) {
      return res.status(404).json({ error: 'Servidor não encontrado' });
    }

    const importService = new ImportService(server);
    
    try {
      const preview = await importService.previewM3U(url);
      await importService.disconnect();
      
      return res.json({
        success: true,
        data: preview,
      });
    } finally {
      await importService.disconnect();
    }
  } catch (error: any) {
    logger.error('[ImportV2] Erro no preview:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

// Armazenar jobs de importação em andamento
interface ImportJob {
  status: string;
  result?: any;
  error?: string;
  startedAt: Date;
  logs: string[];
  progress?: {
    phase: string;
    current: number;
    total: number;
  };
}
const importJobs = new Map<string, ImportJob>();

// Helper para adicionar log ao job
function addJobLog(jobId: string, message: string) {
  const job = importJobs.get(jobId);
  if (job) {
    const timestamp = new Date().toLocaleTimeString('pt-BR');
    job.logs.push(`[${timestamp}] ${message}`);
    logger.info(`[Job ${jobId}] ${message}`);
  }
}

function normalizeBouquetIds(input: any, fallbackSingle?: any): number[] | undefined {
  const raw: any[] = Array.isArray(input) ? input : (input != null ? [input] : []);
  if (raw.length === 0 && fallbackSingle != null && fallbackSingle !== '') {
    raw.push(fallbackSingle);
  }

  const ids = raw
    .map((v) => (typeof v === 'string' ? parseInt(v, 10) : Number(v)))
    .filter((v) => Number.isFinite(v) && v > 0);

  if (ids.length === 0) return undefined;
  return Array.from(new Set(ids));
}

/**
 * POST /api/import-v2/movies
 * Importar filmes do M3U (ASSÍNCRONO - retorna imediatamente)
 */
router.post('/movies', async (req: Request, res: Response) => {
  try {
    const { 
      m3uUrl, 
      serverId,
      streamServerId,
      bouquetId,
      bouquetIds,
      enrichWithTMDB,
      maxItems,
      autoCreateCategories,
      selectedCategories,
      sourceType,
      importMode,
      deleteCategories,
      categoryMappings,
      generateMarketing,
    } = req.body;

    if (!m3uUrl) {
      return res.status(400).json({ error: 'URL do M3U é obrigatória' });
    }

    // Buscar servidor
    const server = await getServer(serverId);
    if (!server) {
      return res.status(404).json({ error: 'Servidor não encontrado' });
    }

    const effectiveSourceType = sourceType === 'secondary' ? 'secondary' : 'primary';
    const effectiveImportMode = importMode === 'replace' ? 'replace' : (importMode === 'update' ? 'update' : 'append');
    if (effectiveSourceType === 'secondary' && effectiveImportMode === 'replace') {
      return res.status(400).json({ error: 'Não é permitido apagar dados ao importar fonte secundária' });
    }

    // Gerar ID único para o job
    const jobId = `import-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Registrar job como "em andamento"
    importJobs.set(jobId, { status: 'processing', startedAt: new Date(), logs: [] });
    
    // Retornar imediatamente com o jobId
    res.json({
      success: true,
      jobId,
      message: 'Importação iniciada em background. Use GET /api/import-v2/jobs/:jobId para verificar o status.',
    });

    // Executar importação em background (não bloqueia a resposta)
    const importService = new ImportService(server);
    
    try {
      const effectiveEnrichWithTMDB = effectiveSourceType === 'primary' ? true : enrichWithTMDB === true;
      addJobLog(jobId, `Iniciando importação de FILMES (fonte: ${sourceType || 'primary'})`);
      addJobLog(jobId, `URL: ${m3uUrl.substring(0, 50)}...`);
      addJobLog(jobId, `TMDB: ${effectiveEnrichWithTMDB ? (effectiveSourceType === 'primary' ? 'Ativado (automático)' : 'Ativado') : 'Desativado'}`);
      addJobLog(jobId, `Modo: ${effectiveImportMode === 'replace' ? 'Apagar e importar' : (effectiveImportMode === 'update' ? 'Atualizar (sem apagar)' : 'Importar (sem apagar)')}`);
      if (effectiveImportMode === 'replace') {
        addJobLog(jobId, `Categorias: ${deleteCategories === true ? 'Apagar e recriar' : 'Manter'}`);
      }
      
      // Converter mapeamento de categorias para Map
      let categoryMappingsMap: Map<string, number> | undefined;
      if (categoryMappings && typeof categoryMappings === 'object') {
        categoryMappingsMap = new Map(Object.entries(categoryMappings).map(([k, v]) => [k, Number(v)]));
      }

      const normalizedBouquetIds = normalizeBouquetIds(bouquetIds, bouquetId);
      
      const result = await importService.importFromM3U(m3uUrl, {
        vodType: 'movie',
        serverId: streamServerId ? parseInt(streamServerId) : undefined,
        bouquetIds: normalizedBouquetIds,
        bouquetId: normalizedBouquetIds && normalizedBouquetIds.length > 0 ? normalizedBouquetIds[0] : (bouquetId ? parseInt(bouquetId) : undefined),
        enrichWithTMDB: effectiveEnrichWithTMDB,
        importMode: effectiveImportMode,
        deleteCategories: deleteCategories === true,
        maxItems: maxItems ? parseInt(maxItems) : undefined,
        autoCreateCategories: autoCreateCategories !== false,
        selectedCategories: Array.isArray(selectedCategories) ? selectedCategories : undefined,
        sourceType: effectiveSourceType,
        categoryMappings: categoryMappingsMap,
        generateMarketing: generateMarketing === true,
        onProgress: (progress) => {
          const job = importJobs.get(jobId);
          if (job) {
            job.progress = {
              phase: progress.phase || 'processing',
              current: progress.current || 0,
              total: progress.total || 0,
            };
            if (progress.message) {
              addJobLog(jobId, progress.message);
            }
          }
        },
      });

      addJobLog(jobId, `✅ Importação concluída!`);
      addJobLog(jobId, `📊 Adicionados (novos): ${result.details?.movies ?? result.inserted}`);
      if (effectiveImportMode === 'update') {
        addJobLog(jobId, `♻️ Atualizados: ${result.details?.moviesUpdated ?? 0}`);
      }
      addJobLog(jobId, `⏭️ Ignorados: ${result.skipped} | ❌ Erros: ${result.errors}`);
      addJobLog(jobId, `⏱️ Duração: ${result.duration}ms`);
      
      // Atualizar job com resultado
      const job = importJobs.get(jobId)!;
      importJobs.set(jobId, {
        ...job,
        status: 'completed',
        result: {
          inserted: result.inserted,
          skipped: result.skipped,
          errors: result.errors,
          duration: result.duration,
          details: result.details,
        },
      });
      
      logger.info(`[ImportV2] Job ${jobId} concluído: ${result.inserted} inseridos, ${result.skipped} ignorados`);
    } catch (error: any) {
      // Atualizar job com erro
      addJobLog(jobId, `❌ Erro: ${error.message}`);
      const job = importJobs.get(jobId)!;
      importJobs.set(jobId, {
        ...job,
        status: 'failed',
        error: error.message,
      });
      logger.error(`[ImportV2] Job ${jobId} falhou:`, error.message);
    } finally {
      await importService.disconnect();
      
      // Limpar jobs antigos (mais de 1 hora)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      for (const [id, job] of importJobs.entries()) {
        if (job.startedAt < oneHourAgo) {
          importJobs.delete(id);
        }
      }
    }
  } catch (error: any) {
    logger.error('[ImportV2] Erro na importação de filmes:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/import-v2/jobs/:jobId
 * Verificar status de um job de importação
 */
router.get('/jobs/:jobId', (req: Request, res: Response) => {
  const { jobId } = req.params;
  const job = importJobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job não encontrado ou expirado' });
  }
  
  return res.json({
    jobId,
    status: job.status,
    result: job.result,
    error: job.error,
    startedAt: job.startedAt,
    logs: job.logs || [],
    progress: job.progress,
  });
});

/**
 * POST /api/import-v2/series
 * Importar séries do M3U (assíncrono com logs)
 */
router.post('/series', async (req: Request, res: Response) => {
  try {
    const { 
      m3uUrl, 
      serverId,
      streamServerId,
      bouquetId,
      bouquetIds,
      enrichWithTMDB,
      maxItems,
      autoCreateCategories,
      selectedCategories,
      sourceType,
      importMode,
      deleteCategories,
      categoryMappings,
      updateExistingSeries,
      generateMarketing,
    } = req.body;

    if (!m3uUrl) {
      return res.status(400).json({ error: 'URL do M3U é obrigatória' });
    }

    const server = await getServer(serverId);
    if (!server) {
      return res.status(404).json({ error: 'Servidor não encontrado' });
    }

    const effectiveSourceType = sourceType === 'secondary' ? 'secondary' : 'primary';
    const effectiveImportMode = importMode === 'replace' ? 'replace' : (importMode === 'update' ? 'update' : 'append');
    if (effectiveSourceType === 'secondary' && effectiveImportMode === 'replace') {
      return res.status(400).json({ error: 'Não é permitido apagar dados ao importar fonte secundária' });
    }

    // Criar job assíncrono
    const jobId = `import-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    importJobs.set(jobId, { status: 'processing', startedAt: new Date(), logs: [] });

    // Retornar jobId imediatamente
    res.json({ success: true, jobId });

    // Executar importação em background
    const importService = new ImportService(server);
    
    try {
      const effectiveEnrichWithTMDB = effectiveSourceType === 'primary' ? true : enrichWithTMDB === true;
      const effectiveUpdateExistingSeries = updateExistingSeries === true || effectiveImportMode === 'update';
      addJobLog(jobId, `🎬 Iniciando importação de SÉRIES (fonte: ${sourceType || 'primary'})`);
      addJobLog(jobId, `📡 URL: ${m3uUrl.substring(0, 50)}...`);
      addJobLog(jobId, `🎯 TMDB: ${effectiveEnrichWithTMDB ? (effectiveSourceType === 'primary' ? 'Ativado (automático)' : 'Ativado') : 'Desativado'}`);
      addJobLog(jobId, `🧭 Modo: ${effectiveImportMode === 'replace' ? 'Apagar e importar' : (effectiveImportMode === 'update' ? 'Atualizar sem apagar' : 'Importar sem apagar')}`);
      if (effectiveImportMode === 'replace') {
        addJobLog(jobId, `🗂️ Categorias: ${deleteCategories === true ? 'Apagar e recriar' : 'Manter'}`);
      }
      addJobLog(jobId, `🔄 Atualizar existentes: ${effectiveUpdateExistingSeries ? 'SIM' : 'NÃO'}`);
      
      // Converter mapeamento de categorias para Map
      let categoryMappingsMap: Map<string, number> | undefined;
      if (categoryMappings && typeof categoryMappings === 'object') {
        categoryMappingsMap = new Map(Object.entries(categoryMappings).map(([k, v]) => [k, Number(v)]));
      }

      const normalizedBouquetIds = normalizeBouquetIds(bouquetIds, bouquetId);
      
      const result = await importService.importFromM3U(m3uUrl, {
        vodType: 'series',
        serverId: streamServerId ? parseInt(streamServerId) : undefined,
        bouquetIds: normalizedBouquetIds,
        bouquetId: normalizedBouquetIds && normalizedBouquetIds.length > 0 ? normalizedBouquetIds[0] : (bouquetId ? parseInt(bouquetId) : undefined),
        enrichWithTMDB: effectiveEnrichWithTMDB,
        importMode: effectiveImportMode,
        deleteCategories: deleteCategories === true,
        maxItems: maxItems ? parseInt(maxItems) : undefined,
        autoCreateCategories: autoCreateCategories !== false,
        selectedCategories: Array.isArray(selectedCategories) ? selectedCategories : undefined,
        sourceType: effectiveSourceType,
        categoryMappings: categoryMappingsMap,
        updateExistingSeries: effectiveUpdateExistingSeries,
        generateMarketing: generateMarketing === true,
        onProgress: (progress) => {
          const job = importJobs.get(jobId);
          if (job) {
            job.progress = {
              phase: progress.phase || 'processing',
              current: progress.current || 0,
              total: progress.total || 0,
            };
            if (progress.message) {
              addJobLog(jobId, progress.message);
            }
          }
        },
      });

      addJobLog(jobId, `✅ Importação concluída!`);
      addJobLog(jobId, `📊 Séries inseridas: ${result.details?.series || 0}`);
      addJobLog(jobId, `📺 Episódios inseridos: ${result.details?.episodes || 0}`);
      addJobLog(jobId, `⏭️ Ignorados: ${result.skipped}`);
      addJobLog(jobId, `⏱️ Duração: ${result.duration}`);

      const job = importJobs.get(jobId);
      if (job) {
        job.status = 'completed';
        job.result = result;
      }
    } catch (error: any) {
      logger.error('[ImportV2] Erro na importação de séries:', error.message);
      addJobLog(jobId, `❌ Erro: ${error.message}`);
      const job = importJobs.get(jobId);
      if (job) {
        job.status = 'failed';
        job.error = error.message;
      }
    } finally {
      await importService.disconnect();
    }
  } catch (error: any) {
    logger.error('[ImportV2] Erro na importação de séries:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/import-v2/live
 * Importar canais LIVE do M3U
 */
router.post('/live', async (req: Request, res: Response) => {
  try {
    const { 
      m3uUrl, 
      serverId,
      streamServerId,
      bouquetId,
      bouquetIds,
      maxItems,
    } = req.body;

    if (!m3uUrl) {
      return res.status(400).json({ error: 'URL do M3U é obrigatória' });
    }

    const server = await getServer(serverId);
    if (!server) {
      return res.status(404).json({ error: 'Servidor não encontrado' });
    }

    const importService = new ImportService(server);
    
    try {
      const normalizedBouquetIds = normalizeBouquetIds(bouquetIds, bouquetId);
      const result = await importService.importFromM3U(m3uUrl, {
        vodType: 'live',
        serverId: streamServerId ? parseInt(streamServerId) : undefined,
        bouquetIds: normalizedBouquetIds,
        bouquetId: normalizedBouquetIds && normalizedBouquetIds.length > 0 ? normalizedBouquetIds[0] : (bouquetId ? parseInt(bouquetId) : undefined),
        maxItems: maxItems ? parseInt(maxItems) : undefined,
      });

      return res.json({
        success: result.success,
        data: {
          inserted: result.inserted,
          skipped: result.skipped,
          errors: result.errors,
          duration: result.duration,
          details: result.details,
        },
      });
    } finally {
      await importService.disconnect();
    }
  } catch (error: any) {
    logger.error('[ImportV2] Erro na importação de canais:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/import-v2/categories
 * Listar categorias do XUI
 */
router.get('/categories', async (req: Request, res: Response) => {
  try {
    const { serverId, type } = req.query;

    const server = await getServer(serverId as string);
    if (!server) {
      return res.status(404).json({ error: 'Servidor não encontrado' });
    }

    const categoryManager = new CategoryManager(server);
    
    try {
      const categoryType = (type as 'movie' | 'series' | 'live') || 'movie';
      const categories = await categoryManager.getCategories(categoryType);

      return res.json({
        success: true,
        data: categories,
      });
    } finally {
      await categoryManager.disconnect();
    }
  } catch (error: any) {
    logger.error('[ImportV2] Erro ao listar categorias:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/import-v2/bouquets
 * Listar bouquets do XUI
 */
router.get('/bouquets', async (req: Request, res: Response) => {
  try {
    const { serverId } = req.query;

    const server = await getServer(serverId as string);
    if (!server) {
      return res.status(404).json({ error: 'Servidor não encontrado' });
    }

    const bouquetManager = new BouquetManager(server);
    
    try {
      const bouquets = await bouquetManager.getBouquets();

      return res.json({
        success: true,
        data: bouquets.map(b => ({
          id: b.id,
          name: b.bouquet_name,
          moviesCount: JSON.parse(b.bouquet_movies || '[]').length,
          seriesCount: JSON.parse(b.bouquet_series || '[]').length,
          channelsCount: JSON.parse(b.bouquet_channels || '[]').length,
        })),
      });
    } finally {
      await bouquetManager.disconnect();
    }
  } catch (error: any) {
    logger.error('[ImportV2] Erro ao listar bouquets:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/import-v2/test-connection
 * Testar conexão com o banco XUI
 */
router.post('/test-connection', async (req: Request, res: Response) => {
  try {
    const { serverId } = req.body;

    const server = await getServer(serverId);
    if (!server) {
      return res.status(404).json({ error: 'Servidor não encontrado' });
    }

    const categoryManager = new CategoryManager(server);
    
    try {
      // Tentar listar categorias como teste
      const categories = await categoryManager.getCategories('movie');

      return res.json({
        success: true,
        message: 'Conexão bem-sucedida',
        data: {
          movieCategories: categories.length,
        },
      });
    } finally {
      await categoryManager.disconnect();
    }
  } catch (error: any) {
    logger.error('[ImportV2] Erro no teste de conexão:', error.message);
    return res.status(500).json({ 
      success: false,
      error: error.message,
    });
  }
});

/**
 * Helper: Buscar servidor por ID ou retornar o padrão
 */
async function getServer(serverId?: string) {
  if (serverId) {
    return await prisma.xuiServer.findUnique({
      where: { id: serverId },
    });
  }
  
  // Retornar servidor padrão ou o primeiro ativo
  return await prisma.xuiServer.findFirst({
    where: { 
      OR: [
        { isDefault: true },
        { isActive: true },
      ],
    },
    orderBy: { isDefault: 'desc' },
  });
}

export default router;
