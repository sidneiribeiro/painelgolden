import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { createLogger } from '../utils/logger.js';
import JogosDoDiaService from '../services/jogos-do-dia/jogos-do-dia.service.js';

const logger = createLogger('JogosDoDiaController');

/**
 * GET /api/jogos-do-dia/config
 * Buscar configuração de jogos do dia
 */
export const getFootballConfig = asyncHandler(async (req: Request, res: Response) => {
  const config = await prisma.footballConfig.findFirst();
  
  if (!config) {
    const defaultConfig = await prisma.footballConfig.create({
      data: {
        categoryName: '⚽ JOGOS DO DIA',
        autoUpdate: true,
        updateTime: '06:00',
        generateBanners: true,
      },
    });
    return res.json(defaultConfig);
  }

  res.json(config);
});

/**
 * POST /api/jogos-do-dia/config
 * Salvar configuração de jogos do dia
 */
export const saveFootballConfig = asyncHandler(async (req: Request, res: Response) => {
  const {
    categoryName,
    xuiCategoryId,
    xuiServerId,
    autoUpdate,
    updateTime,
    generateBanners,
    apiKey,
  } = req.body;

  const config = await prisma.footballConfig.upsert({
    where: { id: 1 },
    update: {
      categoryName: categoryName || '⚽ JOGOS DO DIA',
      xuiCategoryId: xuiCategoryId || undefined,
      xuiServerId: xuiServerId || undefined,
      autoUpdate: autoUpdate !== undefined ? autoUpdate : true,
      updateTime: updateTime || '06:00',
      generateBanners: generateBanners !== undefined ? generateBanners : true,
      apiKey: apiKey || undefined,
    },
    create: {
      categoryName: categoryName || '⚽ JOGOS DO DIA',
      xuiCategoryId: xuiCategoryId || undefined,
      xuiServerId: xuiServerId || undefined,
      autoUpdate: autoUpdate !== undefined ? autoUpdate : true,
      updateTime: updateTime || '06:00',
      generateBanners: generateBanners !== undefined ? generateBanners : true,
      apiKey: apiKey || undefined,
    },
  });

  res.json(config);
});

/**
 * GET /api/jogos-do-dia/canais
 * Listar canais de futebol
 */
export const getFootballChannels = asyncHandler(async (req: Request, res: Response) => {
  const channels = await prisma.footballChannel.findMany({
    where: { isActive: true },
    orderBy: { priority: 'desc' },
  });

  res.json(channels);
});

/**
 * POST /api/jogos-do-dia/canais
 * Criar canal de futebol
 */
export const createFootballChannel = asyncHandler(async (req: Request, res: Response) => {
  const {
    name,
    xuiStreamId,
    xuiServerId,
    logoUrl,
    teams,
    competitions,
    priority,
  } = req.body;

  if (!name || !xuiStreamId || !xuiServerId) {
    throw new AppError(400, 'Nome, xuiStreamId e xuiServerId são obrigatórios');
  }

  const channel = await prisma.footballChannel.create({
    data: {
      name,
      xuiStreamId: parseInt(xuiStreamId),
      xuiServerId,
      logoUrl: logoUrl || undefined,
      teams: typeof teams === 'string' ? teams : JSON.stringify(teams || []),
      competitions: typeof competitions === 'string' ? competitions : JSON.stringify(competitions || []),
      priority: priority || 0,
      isActive: true,
    },
  });

  res.json(channel);
});

/**
 * PUT /api/jogos-do-dia/canais/:id
 * Atualizar canal de futebol
 */
export const updateFootballChannel = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const {
    name,
    xuiStreamId,
    xuiServerId,
    logoUrl,
    teams,
    competitions,
    priority,
    isActive,
  } = req.body;

  const channel = await prisma.footballChannel.update({
    where: { id: parseInt(id) },
    data: {
      name,
      xuiStreamId: xuiStreamId ? parseInt(xuiStreamId) : undefined,
      xuiServerId,
      logoUrl: logoUrl || undefined,
      teams: teams ? (typeof teams === 'string' ? teams : JSON.stringify(teams)) : undefined,
      competitions: competitions ? (typeof competitions === 'string' ? competitions : JSON.stringify(competitions)) : undefined,
      priority,
      isActive,
    },
  });

  res.json(channel);
});

/**
 * DELETE /api/jogos-do-dia/canais/:id
 * Deletar canal de futebol
 */
export const deleteFootballChannel = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  await prisma.footballChannel.delete({
    where: { id: parseInt(id) },
  });

  res.json({ message: 'Canal deletado com sucesso' });
});

/**
 * GET /api/jogos-do-dia/jogos
 * Listar jogos do dia
 */
export const getDailyMatches = asyncHandler(async (req: Request, res: Response) => {
  const { date } = req.query;

  let startDate: Date;
  let endDate: Date;

  if (date) {
    startDate = new Date(date as string);
    startDate.setHours(0, 0, 0, 0);
    endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 1);
  } else {
    // Buscar jogos de hoje até 30 dias à frente
    startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 30);
  }

  logger.info(`[JogosDoDia] Buscando jogos entre ${startDate.toISOString()} e ${endDate.toISOString()}`);

  const matches = await prisma.dailyMatch.findMany({
    where: {
      matchDate: {
        gte: startDate,
        lt: endDate,
      },
    },
    include: {
      config: true,
    },
    orderBy: [
      { matchDate: 'asc' },
      { matchTime: 'asc' },
    ],
  });

  logger.info(`[JogosDoDia] ${matches.length} jogos encontrados no banco`);

  res.json(matches);
});

/**
 * POST /api/jogos-do-dia/jogos
 * Criar jogo do dia
 */
export const createDailyMatch = asyncHandler(async (req: Request, res: Response) => {
  const {
    date,
    homeTeam,
    homeTeamLogo,
    awayTeam,
    awayTeamLogo,
    leagueName,
    leagueLogo,
    matchTime,
    configId,
    apiMatchId,
  } = req.body;

  if (!date || !homeTeam || !awayTeam || !leagueName || !matchTime) {
    throw new AppError(400, 'Campos obrigatórios: date, homeTeam, awayTeam, leagueName, matchTime');
  }

  // Buscar configId se não fornecido
  let finalConfigId = configId;
  if (!finalConfigId) {
    const config = await prisma.footballConfig.findFirst();
    if (!config) {
      throw new AppError(404, 'Configuração de futebol não encontrada. Configure primeiro.');
    }
    finalConfigId = config.id;
  }

  const match = await prisma.dailyMatch.create({
    data: {
      configId: finalConfigId,
      apiMatchId: apiMatchId || Date.now(),
      matchDate: new Date(date),
      homeTeam,
      homeTeamLogo: homeTeamLogo || undefined,
      awayTeam,
      awayTeamLogo: awayTeamLogo || undefined,
      leagueName,
      leagueLogo: leagueLogo || undefined,
      matchTime,
    },
  });

  res.json(match);
});

/**
 * POST /api/jogos-do-dia/update
 * Executar atualização manual
 */
export const runManualUpdate = asyncHandler(async (req: Request, res: Response) => {
  try {
    logger.info('[JogosDoDiaController] Iniciando atualização manual...');
    
    // ⚠️ CORREÇÃO: Usar DailyMatchesService diretamente para garantir geração de banners
    const config = await prisma.footballConfig.findFirst();
    if (!config) {
      throw new AppError(404, 'Configuração de futebol não encontrada');
    }
    
    if (!config.serverId) {
      throw new AppError(400, 'serverId não configurado na configuração de futebol');
    }
    
    // Executar atualização em background (não bloquear resposta)
    const { DailyMatchesService } = await import('../services/jogos-do-dia/daily-matches.service.js');
    const service = new DailyMatchesService(config.serverId);
    
    // Executar em background
    service.initialize().then(async () => {
      try {
        const result = await service.updateDailyMatches('today');
        logger.info(`[JogosDoDiaController] ✅ Atualização concluída: ${result.total} jogos, ${result.mapped} mapeados, ${result.created} streams criados`);
      } catch (error: any) {
        logger.error('[JogosDoDiaController] Erro na atualização em background:', {
          message: error.message,
          stack: error.stack,
        });
      }
    }).catch((error: any) => {
      logger.error('[JogosDoDiaController] Erro ao inicializar serviço:', {
        message: error.message,
        stack: error.stack,
      });
    });
    
    // Retornar resposta imediata (atualização roda em background)
    res.json({ 
      message: 'Atualização iniciada em background. Os jogos serão atualizados em alguns minutos.',
      matchesCount: 0,
      matches: [],
      status: 'processing',
    });
  } catch (error: any) {
    logger.error('[JogosDoDia] Erro na atualização manual:', error);
    throw error;
  }
});

/**
 * POST /api/jogos-do-dia/create-category
 * Criar categoria no XUI automaticamente
 */
export const createCategory = asyncHandler(async (req: Request, res: Response) => {
  const { serverId, categoryName } = req.body;

  if (!serverId || !categoryName) {
    throw new AppError(400, 'serverId e categoryName são obrigatórios');
  }

  // Buscar servidor XUI
  const server = await prisma.xuiServer.findUnique({
    where: { id: serverId },
  });

  if (!server) {
    throw new AppError(404, 'Servidor XUI não encontrado');
  }

  // Para categorias de futebol, vamos criar como categoria live diretamente no MySQL
  // Verificar credenciais MySQL
  if (!server.dbHost || !server.dbUser) {
    throw new AppError(400, 'Credenciais MySQL não configuradas no servidor XUI');
  }

  // Criar conexão MySQL direta
  const mysql = await import('mysql2/promise');
  
  // Descriptografar senha se necessário
  let dbPassword = server.dbPassword;
  if (dbPassword) {
    try {
      const { decrypt } = await import('../utils/crypto.js');
      dbPassword = decrypt(dbPassword);
    } catch (e) {
      // Se falhar, usar como está (pode já estar descriptografado)
      logger.warn('[JogosDoDia] Erro ao descriptografar senha, usando como está');
    }
  }

  const connection = await mysql.createConnection({
    host: server.dbHost,
    port: server.dbPort || 3306,
    user: server.dbUser,
    password: dbPassword,
    database: server.dbName || 'xui',
  });

  try {
    // Detectar nome da tabela de categorias (XUI ONE vs Xtream UI)
    let catTable = 'streams_categories';
    for (const t of ['streams_categories', 'stream_categories']) {
      const [exists] = await connection.query(`SHOW TABLES LIKE '${t}'`);
      if ((exists as any[]).length > 0) { catTable = t; break; }
    }

    // Verificar se categoria já existe
    const [existingRows] = await connection.query<any[]>(
      `SELECT id FROM ${catTable} WHERE category_name = ? AND category_type = 'live' LIMIT 1`,
      [categoryName]
    );

    const existing = Array.isArray(existingRows) ? existingRows : [];
    if (existing.length > 0) {
      await connection.end();
      logger.info(`[JogosDoDia] Categoria já existe: ${categoryName} (ID: ${existing[0].id})`);
      return res.json({ 
        success: true,
        categoryId: existing[0].id,
        message: 'Categoria já existe',
      });
    }

    // Descobre colunas disponíveis (is_adult pode não existir em todas as versões do XUI)
    const [colRows] = await connection.query<any[]>(
      `SHOW COLUMNS FROM ${catTable}`
    );
    const cols = new Set(((colRows as any[]) || []).map((r: any) => r.Field));
    const hasIsAdult = cols.has('is_adult');

    const insertCols = ['category_name', 'category_type', 'parent_id', 'cat_order']
      .concat(hasIsAdult ? ['is_adult'] : []);
    const insertPlaceholders = ['?', "'live'", '0', '0']
      .concat(hasIsAdult ? ['0'] : []);

    // Criar categoria live
    const [insertResult] = await connection.query<any>(
      `INSERT INTO ${catTable} (${insertCols.join(', ')}) VALUES (${insertPlaceholders.join(', ')})`,
      [categoryName]
    );

    // MySQL2 retorna resultado - pode ser ResultSetHeader ou array
    const categoryId = (insertResult as any).insertId || (insertResult as any)?.[0]?.insertId;
    
    if (!categoryId) {
      await connection.end();
      logger.error('[JogosDoDia] insertId não retornado:', { insertResult });
      throw new AppError(500, 'Erro ao criar categoria: insertId não retornado');
    }

    await connection.end();

    logger.info(`[JogosDoDia] Categoria criada com sucesso: ${categoryName} (ID: ${categoryId})`);

    res.json({ 
      success: true,
      categoryId,
      message: 'Categoria criada com sucesso no XUI',
    });
  } catch (error: any) {
    logger.error('[JogosDoDia] Erro ao criar categoria:', {
      error: error.message,
      stack: error.stack,
      serverId,
      categoryName,
      dbHost: server.dbHost,
      dbUser: server.dbUser,
    });
    try {
      await connection.end();
    } catch (e) {
      // Ignorar erro ao fechar conexão
    }
    throw new AppError(500, error.message || 'Erro ao criar categoria no XUI');
  }
});

/**
 * GET /api/jogos-do-dia/banners
 * Listar banners gerados para jogos do dia
 */
export const getFootballBanners = asyncHandler(async (req: Request, res: Response) => {
  const { date } = req.query;

  let startDate: Date;
  let endDate: Date;

  if (date) {
    startDate = new Date(date as string);
    startDate.setHours(0, 0, 0, 0);
    endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 1);
  } else {
    // Buscar banners de hoje até 7 dias à frente
    startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 7);
  }

  // Buscar jogos com banners
  const matches = await prisma.dailyMatch.findMany({
    where: {
      matchDate: {
        gte: startDate,
        lt: endDate,
      },
      bannerPath: {
        not: null,
      },
    },
    select: {
      id: true,
      bannerPath: true,
      homeTeam: true,
      awayTeam: true,
      leagueName: true,
      matchDate: true,
      matchTime: true,
    },
    orderBy: {
      matchDate: 'asc',
    },
  });

  // Agrupar por bannerPath para retornar banners únicos
  const bannersMap = new Map<string, any>();
  
  for (const match of matches) {
    if (match.bannerPath && !bannersMap.has(match.bannerPath)) {
      // Buscar todos os jogos deste banner
      const matchesInBanner = matches.filter(m => m.bannerPath === match.bannerPath);
      
      bannersMap.set(match.bannerPath, {
        id: match.id, // Usar ID do primeiro jogo como ID do banner
        filePath: match.bannerPath,
        matches: matchesInBanner.map(m => ({
          id: m.id,
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          leagueName: m.leagueName,
          matchDate: m.matchDate,
          matchTime: m.matchTime,
        })),
        matchCount: matchesInBanner.length,
        createdAt: matchesInBanner[0].matchDate, // Usar data do primeiro jogo
      });
    }
  }

  const banners = Array.from(bannersMap.values());

  res.json(banners);
});

/**
 * DELETE /api/jogos-do-dia/jogos/clear
 * Limpar todos os jogos do dia do banco de dados
 */
export const clearDailyMatches = asyncHandler(async (req: Request, res: Response) => {
  const { deleteStreams } = req.query; // Se true, também deleta streams do XUI
  
  logger.info('[JogosDoDia] Iniciando limpeza de jogos do dia...');
  
  // Buscar todos os jogos
  const allMatches = await prisma.dailyMatch.findMany({
    select: { id: true, xuiStreamId: true, configId: true },
  });
  
  logger.info(`[JogosDoDia] Encontrados ${allMatches.length} jogo(s) para deletar`);
  
  let deletedStreams = 0;
  
  // Se solicitado, deletar streams do XUI também
  if (deleteStreams === 'true' && allMatches.length > 0) {
    const config = await prisma.footballConfig.findFirst({
      where: { id: allMatches[0].configId },
      include: { server: true },
    });
    
    if (config && config.server) {
      const DailyMatchesService = (await import('../services/jogos-do-dia/daily-matches.service.js')).DailyMatchesService;
      const service = new DailyMatchesService(config.serverId);
      await service.initialize();
      
      const streamIds = allMatches
        .map(m => m.xuiStreamId)
        .filter((id): id is number => typeof id === 'number');
      
      for (const streamId of streamIds) {
        try {
          await service.deleteXuiStream(streamId);
          deletedStreams++;
        } catch (e: any) {
          logger.warn(`[JogosDoDia] Erro ao deletar stream ${streamId} (não crítico): ${e?.message || String(e)}`);
        }
      }
    }
  }
  
  // Deletar todos os jogos do banco
  const result = await prisma.dailyMatch.deleteMany({});
  
  logger.info(`[JogosDoDia] ✅ Limpeza concluída: ${result.count} jogo(s) deletado(s)${deleteStreams === 'true' ? `, ${deletedStreams} stream(s) deletado(s) do XUI` : ''}`);
  
  res.json({
    success: true,
    message: `${result.count} jogo(s) deletado(s)${deleteStreams === 'true' ? `, ${deletedStreams} stream(s) deletado(s) do XUI` : ''}`,
    deletedMatches: result.count,
    deletedStreams: deleteStreams === 'true' ? deletedStreams : 0,
  });
});

