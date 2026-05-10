import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { createLogger } from '../utils/logger.js';
import { XUIVodApiClient } from '../services/vod/xui-vod-api.client.js';
import { M3UImporterService } from '../services/vod/m3u-importer.service.js';
import { XUIVodDBClient } from '../services/vod/xui-vod-db.client.js';
import { socketService } from '../services/socket.service.js';

const logger = createLogger('VODController');

/**
 * ⚠️ DEPRECATED: POST /api/vod/sync
 * Sincronização completa foi removida - não é mais necessária
 * Use importação M3U ou consultas diretas
 */
export const syncVOD = asyncHandler(async (req: Request, res: Response) => {
  throw new AppError(
    410,
    'Sincronização completa foi removida. Use importação M3U ou consultas diretas ao invés.'
  );
});

export const listEnrichmentJobs = asyncHandler(async (req: Request, res: Response) => {
  const { serverId, status, take = '20' } = req.query;
  const takeNum = Math.min(100, Math.max(1, parseInt(String(take), 10) || 20));

  const where: any = {};
  if (serverId) where.serverId = String(serverId);
  if (status) where.status = String(status);

  const jobs = await prisma.vODEnrichmentJob.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: takeNum,
  });

  res.json({ success: true, data: jobs });
});

export const getEnrichmentJob = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const job = await prisma.vODEnrichmentJob.findUnique({
    where: { id },
    include: {
      items: {
        orderBy: { id: 'asc' },
        take: 200,
        include: { vodItem: { select: { id: true, title: true, vodType: true, xuiStreamId: true, hasMetadata: true, needsReview: true } } },
      },
    },
  });

  if (!job) throw new AppError(404, 'Job não encontrado');
  res.json({ success: true, data: job });
});

export const cancelEnrichmentJob = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const job = await prisma.vODEnrichmentJob.findUnique({ where: { id } });
  if (!job) throw new AppError(404, 'Job não encontrado');

  await prisma.vODEnrichmentJob.update({
    where: { id },
    data: { status: 'cancelled', completedAt: new Date() },
  });

  // Deixar itens pendentes como cancelled também (opcional, mas ajuda a não reprocessar)
  await prisma.vODEnrichmentJobItem.updateMany({
    where: { jobId: id, status: { in: ['pending', 'processing'] } },
    data: { status: 'failed', error: 'Cancelado pelo usuário', processedAt: new Date() },
  });

  res.json({ success: true, message: 'Job cancelado' });
});

export const createEnrichmentJobForServer = asyncHandler(async (req: Request, res: Response) => {
  const serverId = (req.body?.serverId || req.query?.serverId) as string | undefined;
  const vodType = (req.body?.vodType || req.query?.vodType) as string | undefined;
  const limitRaw = (req.body?.limit ?? req.query?.limit) as any;
  const limit = Math.min(20000, Math.max(1, parseInt(String(limitRaw || '5000'), 10) || 5000));

  if (!serverId) throw new AppError(400, 'serverId é obrigatório');

  // Usar userId do token se existir; fallback para id do socket/req
  const userId = (req as any).user?.id || (req as any).userId || 'system';

  const server = await prisma.xuiServer.findUnique({ where: { id: String(serverId) } });
  if (!server) throw new AppError(404, 'Servidor XUI não encontrado');

  const where: any = { serverId: String(serverId), hasMetadata: false };
  if (vodType) where.vodType = String(vodType);

  const vodItems = await prisma.vODItem.findMany({
    where,
    select: { id: true },
    take: limit,
    orderBy: { createdAt: 'desc' },
  });

  if (vodItems.length === 0) {
    res.json({ success: true, message: 'Nenhum item pendente para enriquecimento', data: { created: false } });
    return;
  }

  const job = await prisma.vODEnrichmentJob.create({
    data: {
      serverId: String(serverId),
      userId: String(userId),
      jobType: 'tmdb',
      status: 'pending',
      totalItems: vodItems.length,
      progress: 0,
    },
  });

  await prisma.vODEnrichmentJobItem.createMany({
    data: vodItems.map(v => ({
      jobId: job.id,
      vodItemId: v.id,
      status: 'pending',
    })),
  });

  res.json({ success: true, message: 'Job criado', data: { jobId: job.id, totalItems: vodItems.length } });
});

/**
 * GET /api/vod/items
 * Lista itens VOD - Consulta direta no XUI (rápido, sempre atualizado)
 */
export const getVODItems = asyncHandler(async (req: Request, res: Response) => {
  const { serverId, vodType, page = '1', perPage = '20', search } = req.query;

  if (!serverId) {
    throw new AppError(400, 'serverId é obrigatório');
  }

  // Buscar servidor XUI
  const server = await prisma.xuiServer.findUnique({
    where: { id: serverId as string },
  });

  if (!server) {
    throw new AppError(404, 'Servidor XUI não encontrado');
  }

  // Verificar credenciais MySQL
  if (!server.dbHost || !server.dbUser) {
    throw new AppError(
      400,
      'Credenciais MySQL não configuradas. Configure dbHost e dbUser no servidor XUI.'
    );
  }

  const client = new XUIVodApiClient(server);

  try {
    const pageNum = parseInt(page as string, 10) || 1;
    const perPageNum = parseInt(perPage as string, 10) || 20;

    let result;
    if (vodType === 'movie') {
      result = await client.getMovies({
        page: pageNum,
        perPage: perPageNum,
        search: search as string,
      });
    } else if (vodType === 'series') {
      result = await client.getSeries({
        page: pageNum,
        perPage: perPageNum,
        search: search as string,
      });
    } else {
      // Se não especificou tipo, buscar AMBOS (filmes e séries)
      const [moviesResult, seriesResult] = await Promise.all([
        client.getMovies({
          page: pageNum,
          perPage: Math.ceil(perPageNum / 2), // Dividir por 2 para ter espaço para ambos
          search: search as string,
        }),
        client.getSeries({
          page: pageNum,
          perPage: Math.ceil(perPageNum / 2),
          search: search as string,
        }),
      ]);

      // Combinar resultados
      const combinedItems = [
        ...moviesResult.items.map((item: any) => ({ ...item, vodType: 'movie' })),
        ...seriesResult.items.map((item: any) => ({ ...item, vodType: 'series' })),
      ];

      // Ordenar por data de adição (mais recentes primeiro)
      // Filmes têm 'added', séries têm 'added' (que pode ser last_modified ou id)
      combinedItems.sort((a: any, b: any) => {
        const aDate = a.added || a.last_modified || a.id || 0;
        const bDate = b.added || b.last_modified || b.id || 0;
        return bDate - aDate;
      });

      // Limitar ao perPage solicitado
      const limitedItems = combinedItems.slice(0, perPageNum);

      result = {
        items: limitedItems,
        total: moviesResult.total + seriesResult.total,
      };
    }

    res.json({
      success: true,
      data: result.items, // Array de itens direto
      pagination: {
        page: pageNum,
        perPage: perPageNum,
        total: result.total,
        totalPages: Math.ceil(result.total / perPageNum),
      },
    });
  } finally {
    await client.disconnect();
  }
});

async function detectStreamsUpdatedColumn(connection: any): Promise<boolean> {
  try {
    const [rows] = await connection.query(`SHOW COLUMNS FROM streams LIKE 'updated'`);
    return (rows as any[]).length > 0;
  } catch {
    return false;
  }
}

async function tableExists(connection: any, name: string): Promise<boolean> {
  try {
    const [rows] = await connection.query(`SHOW TABLES LIKE ?`, [name]);
    return (rows as any[]).length > 0;
  } catch {
    return false;
  }
}

/**
 * PUT /api/vod/items/bulk
 * Editar em massa filmes ou séries no XUI (via MySQL)
 */
export const bulkUpdateVODItems = asyncHandler(async (req: Request, res: Response) => {
  const serverId = (req.body?.serverId || req.query?.serverId) as string | undefined;
  const vodType = (req.body?.vodType || req.query?.vodType) as string | undefined;
  const idsRaw = (req.body?.ids || req.body?.itemIds) as any[] | undefined;
  const categoryIdRaw = req.body?.categoryId;
  const coverRaw = req.body?.cover;

  if (!serverId) throw new AppError(400, 'serverId é obrigatório');
  if (vodType !== 'movie' && vodType !== 'series') throw new AppError(400, 'vodType deve ser movie ou series');

  const ids = Array.isArray(idsRaw)
    ? idsRaw.map((v: any) => parseInt(String(v), 10)).filter((n: number) => Number.isFinite(n) && n > 0)
    : [];

  if (ids.length === 0) throw new AppError(400, 'ids é obrigatório');
  if (ids.length > 500) throw new AppError(400, 'Limite máximo: 500 itens por operação');

  const server = await prisma.xuiServer.findUnique({ where: { id: String(serverId) } });
  if (!server) throw new AppError(404, 'Servidor XUI não encontrado');

  const client = new XUIVodDBClient(server);
  const connection = await client.connect();
  if (!connection) throw new AppError(500, 'Falha ao conectar ao banco de dados');

  const categoryIdNum = categoryIdRaw !== undefined && categoryIdRaw !== null && String(categoryIdRaw).trim() !== ''
    ? parseInt(String(categoryIdRaw), 10)
    : undefined;
  const cover = coverRaw !== undefined && coverRaw !== null ? String(coverRaw).trim() : undefined;

  try {
    const placeholders = ids.map(() => '?').join(',');
    const nowUnix = Math.floor(Date.now() / 1000);

    if (vodType === 'movie') {
      const hasUpdated = await detectStreamsUpdatedColumn(connection);
      const sets: string[] = [];
      const params: any[] = [];

      if (categoryIdNum !== undefined && Number.isFinite(categoryIdNum)) {
        sets.push('category_id = ?');
        params.push(categoryIdNum);
      }
      if (cover !== undefined) {
        sets.push('stream_icon = ?');
        params.push(cover);
      }
      if (hasUpdated && sets.length > 0) sets.push('updated = NOW()');

      if (sets.length === 0) {
        return res.json({ success: true, affectedRows: 0 });
      }

      const [result] = await connection.query<any>(
        `UPDATE streams SET ${sets.join(', ')} WHERE type = 2 AND id IN (${placeholders})`,
        [...params, ...ids]
      );
      return res.json({ success: true, affectedRows: (result as any)?.affectedRows || 0 });
    }

    const hasSeries = await tableExists(connection, 'series');
    const hasStreamsSeries = !hasSeries && await tableExists(connection, 'streams_series');

    if (hasSeries || hasStreamsSeries) {
      const tableName = hasSeries ? 'series' : 'streams_series';
      const sets: string[] = [];
      const params: any[] = [];

      if (categoryIdNum !== undefined && Number.isFinite(categoryIdNum)) {
        sets.push('category_id = ?');
        params.push(`[${categoryIdNum}]`);
      }
      if (cover !== undefined) {
        sets.push('cover = ?');
        params.push(cover);
        sets.push('cover_big = ?');
        params.push(cover);
      }

      if (sets.length === 0) {
        return res.json({ success: true, affectedRows: 0 });
      }

      if (hasSeries) {
        sets.push('last_modified = ?');
        params.push(nowUnix);
      }

      const [result] = await connection.query<any>(
        `UPDATE ${tableName} SET ${sets.join(', ')} WHERE id IN (${placeholders})`,
        [...params, ...ids]
      );
      return res.json({ success: true, affectedRows: (result as any)?.affectedRows || 0 });
    }

    const hasUpdated = await detectStreamsUpdatedColumn(connection);
    const sets: string[] = [];
    const params: any[] = [];
    if (categoryIdNum !== undefined && Number.isFinite(categoryIdNum)) {
      sets.push('category_id = ?');
      params.push(categoryIdNum);
    }
    if (cover !== undefined) {
      sets.push('stream_icon = ?');
      params.push(cover);
    }
    if (hasUpdated && sets.length > 0) sets.push('updated = NOW()');
    if (sets.length === 0) {
      return res.json({ success: true, affectedRows: 0 });
    }
    const [result] = await connection.query<any>(
      `UPDATE streams SET ${sets.join(', ')} WHERE type = 3 AND id IN (${placeholders})`,
      [...params, ...ids]
    );
    return res.json({ success: true, affectedRows: (result as any)?.affectedRows || 0 });
  } finally {
    await client.disconnect();
  }
});

/**
 * DELETE /api/vod/items/bulk
 * Apagar em massa filmes ou séries no XUI (via MySQL)
 */
export const bulkDeleteVODItems = asyncHandler(async (req: Request, res: Response) => {
  const serverId = (req.body?.serverId || req.query?.serverId) as string | undefined;
  const vodType = (req.body?.vodType || req.query?.vodType) as string | undefined;
  const idsRaw = (req.body?.ids || req.body?.itemIds) as any[] | undefined;

  if (!serverId) throw new AppError(400, 'serverId é obrigatório');
  if (vodType !== 'movie' && vodType !== 'series') throw new AppError(400, 'vodType deve ser movie ou series');

  const ids = Array.isArray(idsRaw)
    ? idsRaw.map((v: any) => parseInt(String(v), 10)).filter((n: number) => Number.isFinite(n) && n > 0)
    : [];

  if (ids.length === 0) throw new AppError(400, 'ids é obrigatório');
  if (ids.length > 500) throw new AppError(400, 'Limite máximo: 500 itens por operação');

  const server = await prisma.xuiServer.findUnique({ where: { id: String(serverId) } });
  if (!server) throw new AppError(404, 'Servidor XUI não encontrado');

  const client = new XUIVodDBClient(server);
  const connection = await client.connect();
  if (!connection) throw new AppError(500, 'Falha ao conectar ao banco de dados');

  try {
    await connection.beginTransaction();
    const placeholders = ids.map(() => '?').join(',');

    if (vodType === 'movie') {
      if (await tableExists(connection, 'movie_properties')) {
        try {
          await connection.query(`DELETE FROM movie_properties WHERE stream_id IN (${placeholders})`, ids);
        } catch {}
      }
      const [result] = await connection.query<any>(`DELETE FROM streams WHERE type = 2 AND id IN (${placeholders})`, ids);
      await connection.commit();
      return res.json({ success: true, deleted: (result as any)?.affectedRows || 0 });
    }

    if (await tableExists(connection, 'series_episodes')) {
      try {
        await connection.query(`DELETE FROM series_episodes WHERE series_id IN (${placeholders})`, ids);
      } catch {}
    }
    try {
      await connection.query(`DELETE FROM streams WHERE type = 5 AND series_no IN (${placeholders})`, ids);
    } catch {}

    const hasSeries = await tableExists(connection, 'series');
    const hasStreamsSeries = !hasSeries && await tableExists(connection, 'streams_series');
    if (hasSeries || hasStreamsSeries) {
      const tableName = hasSeries ? 'series' : 'streams_series';
      const [result] = await connection.query<any>(`DELETE FROM ${tableName} WHERE id IN (${placeholders})`, ids);
      await connection.commit();
      return res.json({ success: true, deleted: (result as any)?.affectedRows || 0 });
    }

    const [result] = await connection.query<any>(`DELETE FROM streams WHERE type = 3 AND id IN (${placeholders})`, ids);
    await connection.commit();
    return res.json({ success: true, deleted: (result as any)?.affectedRows || 0 });
  } catch (e: any) {
    try { await connection.rollback(); } catch {}
    throw e;
  } finally {
    await client.disconnect();
  }
});

/**
 * GET /api/vod/stats
 * Estatísticas de VOD - Consulta direta no XUI (rápido, sempre atualizado)
 */
export const getVODStats = asyncHandler(async (req: Request, res: Response) => {
  const { serverId } = req.query;

  if (!serverId) {
    throw new AppError(400, 'serverId é obrigatório');
  }

  // Buscar servidor XUI
  const server = await prisma.xuiServer.findUnique({
    where: { id: serverId as string },
  });

  if (!server) {
    throw new AppError(404, 'Servidor XUI não encontrado');
  }

  // Verificar credenciais MySQL
  if (!server.dbHost || !server.dbUser) {
    throw new AppError(
      400,
      'Credenciais MySQL não configuradas. Configure dbHost e dbUser no servidor XUI.'
    );
  }

  const client = new XUIVodApiClient(server);

  try {
    const stats = await client.getStats();

    res.json({
      success: true,
      data: {
        total: stats.total,
        movies: stats.movies,
        series: stats.series,
        channels: stats.channels,
        withMetadata: stats.withMetadata,
        withoutMetadata: stats.withoutMetadata,
        moviesWithMetadata: stats.moviesWithMetadata,
        moviesWithoutMetadata: stats.moviesWithoutMetadata,
        seriesWithMetadata: stats.seriesWithMetadata,
        seriesWithoutMetadata: stats.seriesWithoutMetadata,
      },
    });
  } finally {
    await client.disconnect();
  }
});

/**
 * GET /api/vod/debug-series
 * Debug: Verificar estrutura das tabelas de séries no XUI
 */
export const debugSeriesTables = asyncHandler(async (req: Request, res: Response) => {
  const { serverId } = req.query;

  if (!serverId) {
    throw new AppError(400, 'serverId é obrigatório');
  }

  // Buscar servidor XUI
  const server = await prisma.xuiServer.findUnique({
    where: { id: serverId as string },
  });

  if (!server) {
    throw new AppError(404, 'Servidor XUI não encontrado');
  }

  // Verificar credenciais MySQL
  if (!server.dbHost || !server.dbUser) {
    throw new AppError(
      400,
      'Credenciais MySQL não configuradas. Configure dbHost e dbUser no servidor XUI.'
    );
  }

  const client = new XUIVodApiClient(server);

  try {
    const debug = await client.debugSeriesTables();

    res.json({
      success: true,
      server: {
        id: server.id,
        name: server.name,
        baseUrl: server.baseUrl,
      },
      debug,
    });
  } finally {
    await client.disconnect();
  }
});

/**
 * GET /api/vod/items/:id
 * Busca item VOD específico - Consulta direta no XUI
 */
export const getVODItem = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { serverId } = req.query;

  if (!serverId) {
    throw new AppError(400, 'serverId é obrigatório');
  }

  // Buscar servidor XUI
  const server = await prisma.xuiServer.findUnique({
    where: { id: serverId as string },
  });

  if (!server) {
    throw new AppError(404, 'Servidor XUI não encontrado');
  }

  // Verificar credenciais MySQL
  if (!server.dbHost || !server.dbUser) {
    throw new AppError(
      400,
      'Credenciais MySQL não configuradas. Configure dbHost e dbUser no servidor XUI.'
    );
  }

  const client = new XUIVodApiClient(server);

  try {
    const streamId = parseInt(id, 10);
    if (isNaN(streamId)) {
      throw new AppError(400, 'ID inválido');
    }

    const movie = await client.getMovie(streamId);
    if (!movie) {
      throw new AppError(404, 'Item VOD não encontrado');
    }

    res.json({
      success: true,
      data: movie,
    });
  } finally {
    await client.disconnect();
  }
});

/**
 * POST /api/vod/preview
 * Pré-visualiza M3U (parse sem importar) - retorna categorias
 */
export const previewM3U = asyncHandler(async (req: Request, res: Response) => {
  const { serverId, m3uUrl, m3uContent, vodType } = req.body;

  logger.info('[VODController] Preview M3U recebido', { 
    serverId: !!serverId, 
    hasUrl: !!m3uUrl, 
    hasContent: !!m3uContent,
    urlLength: m3uUrl?.length,
    contentLength: m3uContent?.length
  });

  if (!serverId) {
    throw new AppError(400, 'serverId é obrigatório');
  }

  if (!m3uUrl && !m3uContent) {
    throw new AppError(400, 'm3uUrl ou m3uContent é obrigatório');
  }

  // Buscar servidor XUI
  const server = await prisma.xuiServer.findUnique({
    where: { id: serverId as string },
  });

  if (!server) {
    throw new AppError(404, 'Servidor XUI não encontrado');
  }

  const importer = new M3UImporterService(server);

  try {
    const m3uInput = m3uUrl || m3uContent;
    if (!m3uInput || m3uInput.trim().length === 0) {
      throw new AppError(400, 'URL ou conteúdo M3U não fornecido');
    }

    logger.info('[VODController] Iniciando preview M3U', { 
      serverId, 
      hasUrl: !!m3uUrl, 
      hasContent: !!m3uContent,
      vodType: vodType || 'both'
    });

    // ⚠️ FIX: Usar asyncHandler garante tratamento correto de erros
    const preview = await importer.previewM3U(m3uInput, vodType || 'both');

    logger.info('[VODController] Preview concluído', { 
      total: preview.total, 
      movies: preview.movies, 
      series: preview.series,
      categories: preview.categories.length
    });

    res.json({
      success: true,
      data: preview,
      message: `${preview.total} itens e ${preview.categories.length} categorias encontradas no M3U.`,
    });
  } catch (error: any) {
    logger.error('[VODController] Erro ao pré-visualizar M3U:', {
      message: error.message,
      stack: error.stack,
      serverId,
      hasUrl: !!m3uUrl,
      hasContent: !!m3uContent
    });
    
    // Se já é um AppError, relança; senão, cria um novo
    if (error instanceof AppError) {
      throw error;
    }
    
    throw new AppError(500, `Erro ao pré-visualizar M3U: ${error.message || 'Erro desconhecido'}`);
  }
});

/**
 * POST /api/vod/import
 * Importa conteúdo de uma URL M3U
 */
export const importFromM3U = asyncHandler(async (req: Request, res: Response) => {
  const { serverId, m3uUrl, clearBeforeImport, categoryId, vodType, enrichWithTMDB, categoryMappings, bouquetId, tmdbApiKey, streamServerId, createYearCategory, selectedYear, selectedYears, updateExistingCategories, sourceId, maxMovies, maxSeries, disableMarketing } = req.body;

  if (!serverId || !m3uUrl) {
    throw new AppError(400, 'serverId e m3uUrl são obrigatórios');
  }

  // 🚨 VALIDAÇÃO: Não permitir clearBeforeImport em fontes secundárias
  if (clearBeforeImport && sourceId) {
    const source = await prisma.importSource.findUnique({
      where: { id: sourceId }
    });
    
    if (source && source.type === 'secondary') {
      throw new AppError(400, '⚠️ ERRO: Não é permitido "Limpar antes" em fontes SECUNDÁRIAS! Isso apagaria todos os dados da fonte primária. Desmarque a opção ou use uma fonte primária.');
    }
  }

  // Buscar servidor XUI
  const server = await prisma.xuiServer.findUnique({
    where: { id: serverId as string },
  });

  if (!server) {
    throw new AppError(404, 'Servidor XUI não encontrado');
  }

  // Verificar credenciais MySQL
  if (!server.dbHost || !server.dbUser) {
    throw new AppError(
      400,
      'Credenciais MySQL não configuradas. Configure dbHost e dbUser no servidor XUI.'
    );
  }

  // Usar chave TMDB do request ou do .env
  const tmdbKey = tmdbApiKey || process.env.TMDB_API_KEY;
  const importer = new M3UImporterService(server, tmdbKey);

  // ⚠️ SOCKET: Obter userId do usuário autenticado (se disponível)
  const userId = (req as any).user?.id || (req as any).user?.username || 'anonymous';

  // 🔍 DEBUG: Log detalhado dos parâmetros recebidos do frontend
  logger.info('[VODController] 🔍 PARÂMETROS RECEBIDOS DO FRONTEND:');
  logger.info(`[VODController]   - serverId: ${serverId}`);
  logger.info(`[VODController]   - enrichWithTMDB: ${enrichWithTMDB} (tipo: ${typeof enrichWithTMDB})`);
  logger.info(`[VODController]   - categoryMappings: ${categoryMappings?.length || 0} mapeamentos`);
  logger.info(`[VODController]   - bouquetId: ${bouquetId} (tipo: ${typeof bouquetId})`);
  logger.info(`[VODController]   - streamServerId: ${streamServerId} (tipo: ${typeof streamServerId})`);
  logger.info(`[VODController]   - vodType: ${vodType}`);
  logger.info(`[VODController]   - tmdbKey disponível: ${tmdbKey ? 'SIM' : 'NÃO'}`);

  // ⚠️ IMPORTANTE: Retornar resposta IMEDIATAMENTE e executar importação em background
  // Isso evita timeout no frontend e permite Socket.io fazer atualizações em tempo real
  
  logger.info('[VODController] Iniciando importação em background', { userId, serverId, vodType });
  
  // Responder imediatamente
  res.json({
    success: true,
    message: 'Importação iniciada com sucesso. Acompanhe o progresso em tempo real.',
    data: {
      userId,
      serverId,
      vodType: vodType || 'both',
      enrichWithTMDB: enrichWithTMDB === true,
      status: 'started',
    },
  });

  // Executar importação em background (sem await - fire and forget)
  importer.importFromM3U(m3uUrl, {
    clearBeforeImport: clearBeforeImport === true,
    categoryId: categoryId ? parseInt(categoryId, 10) : undefined,
    vodType: vodType || 'both',
    enrichWithTMDB: enrichWithTMDB === true,
    categoryMappings: categoryMappings || [], // Mapeamentos de categorias
    bouquetId: bouquetId ? parseInt(bouquetId, 10) : undefined, // ID do bouquet
    userId, // ⚠️ SOCKET: Passar userId para atualizações em tempo real
    serverId: streamServerId ? Number(streamServerId) : undefined, // ID do servidor de streaming
    maxMovies: maxMovies ? parseInt(String(maxMovies), 10) : undefined,
    maxSeries: maxSeries ? parseInt(String(maxSeries), 10) : undefined,
    disableMarketing: disableMarketing === true,
    // ⚠️ NOVA FUNCIONALIDADE: Categoria especial por ano (com suporte a múltiplos anos)
    createYearCategory: createYearCategory === true,
    selectedYears: selectedYears && Array.isArray(selectedYears) && selectedYears.length > 0
      ? selectedYears.map((y: any) => parseInt(y, 10)).filter((y: number) => !isNaN(y))
      : (selectedYear ? [parseInt(selectedYear, 10)] : undefined), // Compatibilidade com selectedYear único
    // 🆕 NOVA FUNCIONALIDADE: Atualizar categorias de filmes existentes (duplicados)
    updateExistingCategories: updateExistingCategories === true,
  }).then(result => {
    logger.info('[VODController] Importação finalizada com sucesso (background)', {
      userId,
      inserted: result.inserted,
      skipped: result.skipped,
      errors: result.errors,
      duration: result.duration,
    });
  }).catch(error => {
    logger.error('[VODController] Erro na importação M3U (background)', { 
      userId,
      error: error.message, 
      stack: error.stack 
    });
    // Socket.io já enviou erro para o frontend via processError
  });
});

/**
 * ⚠️ PAUSE/RESUME/CANCEL: POST /api/vod/import/pause
 * Pausa a importação em andamento
 */
export const pauseImport = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).user?.username || 'anonymous';
  const forceAll = req.body?.forceAll === true;
  
  let success = socketService.pauseUserProcess(userId);
  
  if (!success && forceAll) {
    logger.info(`[VODController] Tentando pausar TODOS os processos em andamento`);
    success = socketService.pauseAllProcesses();
  }
  
  if (!success) {
    throw new AppError(400, 'Nenhum processo em andamento para pausar');
  }
  
  res.json({
    success: true,
    message: 'Importação pausada',
  });
});

/**
 * ⚠️ PAUSE/RESUME/CANCEL: POST /api/vod/import/resume
 * Retoma a importação pausada
 */
export const resumeImport = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).user?.username || 'anonymous';
  
  const success = socketService.resumeUserProcess(userId);
  
  if (!success) {
    throw new AppError(400, 'Nenhum processo pausado para retomar');
  }
  
  res.json({
    success: true,
    message: 'Importação retomada',
  });
});

/**
 * ⚠️ PAUSE/RESUME/CANCEL: POST /api/vod/import/cancel
 * Cancela a importação em andamento
 */
export const cancelImport = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).user?.username || 'anonymous';
  const forceAll = req.body?.forceAll === true; // Cancelar TODOS os processos
  
  let success = socketService.cancelUserProcess(userId);
  
  // Se não encontrou processo do usuário atual E forceAll=true, tenta cancelar QUALQUER processo
  if (!success && forceAll) {
    logger.info(`[VODController] Tentando cancelar TODOS os processos em andamento`);
    success = socketService.cancelAllProcesses();
  }
  
  // Se ainda não encontrou, tenta cancelar qualquer processo órfão (sem userId específico)
  if (!success) {
    logger.info(`[VODController] Tentando cancelar processos órfãos`);
    success = socketService.cancelAllProcesses();
  }
  
  if (!success) {
    // Retornar sucesso mesmo se não houver processo (pode já ter sido cancelado)
    return res.json({
      success: true,
      message: 'Nenhum processo em andamento encontrado',
    });
  }
  
  res.json({
    success: true,
    message: 'Importação cancelada',
  });
});

/**
 * ⚠️ PAUSE/RESUME/CANCEL: GET /api/vod/import/status
 * Obtém status atual da importação
 */
export const getImportStatus = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).user?.username || 'anonymous';
  
  const status = socketService.getUserProcess(userId);
  
  if (!status) {
    return res.json({
      success: true,
      data: {
        status: 'idle',
        progress: 0,
        processedItems: 0,
        totalItems: 0,
        addedItems: 0,
        skippedItems: 0,
      },
    });
  }
  
  res.json({
    success: true,
    data: status,
  });
});

/**
 * GET /api/vod/categories
 * Busca categorias VOD do XUI
 */
export const getVODCategories = asyncHandler(async (req: Request, res: Response) => {
  const { serverId, type } = req.query;

  if (!serverId) {
    throw new AppError(400, 'serverId é obrigatório');
  }

  // Buscar servidor XUI
  const server = await prisma.xuiServer.findUnique({
    where: { id: serverId as string },
  });

  if (!server) {
    throw new AppError(404, 'Servidor XUI não encontrado');
  }

  // Verificar credenciais MySQL
  if (!server.dbHost || !server.dbUser) {
    throw new AppError(
      400,
      'Credenciais MySQL não configuradas. Configure dbHost e dbUser no servidor XUI.'
    );
  }

  const client = new XUIVodApiClient(server);

  try {
    // Se type não especificado, buscar ambos
    const categoryType = type as string || undefined;
    
    const categories = await client.getCategories(categoryType);

    res.json({
      success: true,
      data: categories,
    });
  } finally {
    await client.disconnect();
  }
});

/**
 * GET /api/vod/servers
 * Lista servidores de streaming do XUI (Server Tree / On-Demand)
 */
export const getVODServers = asyncHandler(async (req: Request, res: Response) => {
  const { serverId } = req.query;

  if (!serverId) {
    throw new AppError(400, 'serverId é obrigatório');
  }

  // Buscar servidor XUI
  const server = await prisma.xuiServer.findUnique({
    where: { id: String(serverId) },
  });

  if (!server) {
    throw new AppError(404, 'Servidor não encontrado');
  }

  // Verificar credenciais MySQL
  if (!server.dbHost || !server.dbUser) {
    throw new AppError(
      400,
      'Credenciais MySQL não configuradas. Configure dbHost e dbUser no servidor XUI.'
    );
  }

  const client = new XUIVodDBClient(server);

  try {
    const connection = await client.connect();

    if (!connection) {
      throw new Error('Falha ao conectar ao banco de dados');
    }

    // Tentar diferentes tabelas de servidores (varia entre versões XUI)
    let servers: any[] = [];
    
    // Tentar tabela "servers" (XUI padrão)
    try {
      const [rows] = await connection.query(
        `SELECT id, server_name, server_ip 
         FROM servers 
         WHERE enabled = 1
         ORDER BY server_name ASC`
      );
      servers = rows as any[];
    } catch (e1: any) {
      logger.debug('[VODController] Tabela servers não encontrada, tentando streaming_servers...');
      
      // Tentar tabela "streaming_servers" (algumas versões XUI)
      try {
        const [rows] = await connection.query(
          `SELECT id, server_name, server_ip 
           FROM streaming_servers 
           WHERE enabled = 1
           ORDER BY server_name ASC`
        );
        servers = rows as any[];
      } catch (e2: any) {
        logger.debug('[VODController] Tabela streaming_servers não encontrada');
        // Nenhuma tabela de servidores encontrada - normal para algumas instalações
      }
    }

    res.json({
      success: true,
      data: servers,
    });
  } catch (error: any) {
    logger.error('[VODController] Erro ao buscar servidores:', {
      message: error.message,
      stack: error.stack,
    });
    
    // Retornar array vazio em caso de erro (não crítico)
    res.json({
      success: true,
      data: [],
    });
  } finally {
    await client.disconnect();
  }
});

/**
 * DELETE /api/vod/movies/by-url
 * Exclui filmes cujo stream_source contenha a URL base especificada
 */
export const deleteMoviesByUrl = asyncHandler(async (req: Request, res: Response) => {
  const serverId = (req.body?.serverId || req.query?.serverId) as string | undefined;
  const urlBase = (req.body?.urlBase || req.query?.urlBase) as string | undefined;
  const dryRunRaw = (req.body?.dryRun ?? req.query?.dryRun) as any;
  const dryRun = dryRunRaw === true || dryRunRaw === 'true' || dryRunRaw === 1 || dryRunRaw === '1';

  if (!serverId) {
    throw new AppError(400, 'serverId é obrigatório');
  }

  if (!urlBase) {
    throw new AppError(400, 'urlBase é obrigatório (ex: "http://cdn4k.net")');
  }

  // Buscar servidor XUI
  const server = await prisma.xuiServer.findUnique({
    where: { id: serverId as string },
  });

  if (!server) {
    throw new AppError(404, 'Servidor XUI não encontrado');
  }

  // Verificar credenciais MySQL
  if (!server.dbHost || !server.dbUser) {
    throw new AppError(
      400,
      'Credenciais MySQL não configuradas. Configure dbHost e dbUser no servidor XUI.'
    );
  }

  logger.info(`[VODController] ${dryRun ? '🔍 Simulando' : '🗑️ Excluindo'} filmes com URL base: ${urlBase}`);

  const dbClient = new XUIVodDBClient(server);

  try {
    const result = await dbClient.deleteMoviesByUrlBase(urlBase, dryRun);

    if (dryRun) {
      logger.info(`[VODController] 🔍 Simulação: ${result.found} filmes encontrados com URL "${urlBase}"`);
      res.json({
        success: true,
        message: `Simulação: ${result.found} filmes seriam excluídos`,
        data: {
          found: result.found,
          deleted: 0,
          dryRun: true,
        },
      });
    } else {
      logger.info(`[VODController] ✅ ${result.deleted} filmes excluídos com URL "${urlBase}"`);
      res.json({
        success: true,
        message: `${result.deleted} filmes excluídos com sucesso`,
        data: {
          found: result.found,
          deleted: result.deleted,
          dryRun: false,
        },
      });
    }
  } catch (error: any) {
    logger.error('[VODController] Erro ao excluir filmes por URL:', error.message);
    throw new AppError(500, `Erro ao excluir filmes: ${error.message}`);
  } finally {
    await dbClient.disconnect();
  }
});

/**
 * GET /api/vod/diagnose
 * DIAGNÓSTICO: Comparar filme que funciona vs. filmes recém-inseridos
 */
export const diagnoseMovieFormat = asyncHandler(async (req: Request, res: Response) => {
  const server = await prisma.xuiServer.findFirst({ where: { isActive: true } });
  if (!server) {
    throw new AppError(404, 'Nenhum servidor XUI ativo');
  }

  const dbClient = new XUIVodDBClient(server);
  try {
    const result = await dbClient.diagnoseMovieFormat();
    res.json({ success: true, data: result });
  } finally {
    await dbClient.disconnect();
  }
});
