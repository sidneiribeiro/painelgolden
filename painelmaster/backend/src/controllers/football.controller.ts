/**
 * Controller para módulo de Jogos do Dia
 * Conforme prompt: Sistema híbrido com matching automático de canais
 */

import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { createLogger } from '../utils/logger.js';
import { DailyMatchesService } from '../services/jogos-do-dia/daily-matches.service.js';
import { ChannelMatcherService } from '../services/jogos-do-dia/channel-matcher.service.js';
import axios from 'axios';

const logger = createLogger('FootballController');

/**
 * GET /api/football/config/:serverId
 * Buscar configuração de jogos do dia
 */
export const getConfig = asyncHandler(async (req: Request, res: Response) => {
  const { serverId } = req.params;
  
  if (!serverId) {
    throw new AppError(400, 'serverId é obrigatório');
  }
  
  let config = await prisma.footballConfig.findUnique({
    where: { serverId }
  });
  
  // Garantir que o modo "Brasil (todas as ligas)" (-1) esteja habilitado por padrão
  // para não perder estaduais/Copinha quando a lista de ligas não tiver IDs exatos.
  if (config) {
    try {
      const parsed = JSON.parse(config.enabledLeagues || '[]');
      if (Array.isArray(parsed) && !parsed.includes(-1)) {
        const updated = [-1, ...parsed];
        config = await prisma.footballConfig.update({
          where: { serverId },
          data: { enabledLeagues: JSON.stringify(updated) },
        });
      }
    } catch {
      // ignorar
    }
  }

  if (!config) {
    // Criar configuração padrão
    config = await prisma.footballConfig.create({
      data: {
        serverId,
        categoryName: '⚽ JOGOS DO DIA',
        bouquetId: 1,
        timeOffsetMinutes: 0,
        autoUpdate: true,
        updateSchedule: '0 6 * * *',
        generateBanners: true,
        enabledLeagues: JSON.stringify([
          -1,   // Brasil (todas as ligas) - útil para estaduais/Copinha
          // TheSportsDB League IDs (principais)
          4351, // Brasileirão Série A
          4406, // Brasileirão Série B
          4725, // Copa do Brasil
          4350, // Libertadores
          4401, // Sul-Americana
          4480, // Champions League
          4328, // Premier League
          4335, // La Liga
          4332, // Serie A (Itália)
          4331, // Bundesliga
          4334, // Ligue 1
        ])
      }
    });
  }
  
  res.json(config);
});

/**
 * PUT /api/football/config/:serverId
 * Atualizar configuração
 */
export const updateConfig = asyncHandler(async (req: Request, res: Response) => {
  const { serverId } = req.params;
  const {
    categoryName,
    xuiCategoryId,
    bouquetId,
    timeOffsetMinutes,
    apiFootballKey,
    autoUpdate,
    updateSchedule,
    generateBanners,
    enabledLeagues
  } = req.body;
  
  // Normalizar enabledLeagues (pode vir como string JSON ou array)
  let enabledLeaguesStr: string | undefined;
  if (enabledLeagues) {
    if (typeof enabledLeagues === 'string') {
      // Se já é string, validar se é JSON válido
      try {
        JSON.parse(enabledLeagues);
        enabledLeaguesStr = enabledLeagues;
      } catch {
        // Se não for JSON válido, usar padrão
        enabledLeaguesStr = JSON.stringify([
          4351, 4406, 4725, 4350, 4401, 4480, 4328, 4335, 4332, 4331, 4334
        ]);
      }
    } else if (Array.isArray(enabledLeagues)) {
      enabledLeaguesStr = JSON.stringify(enabledLeagues);
    } else {
      enabledLeaguesStr = JSON.stringify([4351, 4406, 4725, 4350, 4401, 4480, 4328, 4335, 4332, 4331, 4334]);
    }
  }
  
  // Migração automática: se vier IDs antigos (API-Football), converter para TheSportsDB quando possível
  try {
    const parsed = enabledLeaguesStr ? JSON.parse(enabledLeaguesStr) : [];
    if (Array.isArray(parsed)) {
      const legacyToTheSportsDB: Record<number, number> = {
        71: 4351, // BR A
        72: 4406, // BR B
        73: 4725, // Copa do Brasil
        13: 4350, // Libertadores
        11: 4401, // Sul-Americana
        2: 4480,  // Champions
        39: 4328, // Premier League
        140: 4335, // La Liga
        135: 4332, // Serie A (aprox)
        78: 4331,  // Bundesliga (aprox)
        61: 4334,  // Ligue 1 (aprox)
      };
      const maybeLegacy = parsed.some((n: any) => typeof n === 'number' && n < 3000);
      if (maybeLegacy) {
        const converted = parsed
          .map((n: any) => (typeof n === 'number' && legacyToTheSportsDB[n] ? legacyToTheSportsDB[n] : n))
          .filter((n: any) => typeof n === 'number' && !Number.isNaN(n));
        enabledLeaguesStr = JSON.stringify([...new Set(converted)]);
      }
    }
  } catch {
    // ignorar
  }

  try {
    const config = await prisma.footballConfig.upsert({
      where: { serverId },
      update: {
        categoryName: categoryName || '⚽ JOGOS DO DIA',
        xuiCategoryId: xuiCategoryId ? parseInt(String(xuiCategoryId)) : undefined,
        bouquetId: bouquetId !== undefined && bouquetId !== null && String(bouquetId).trim() !== '' ? parseInt(String(bouquetId)) : undefined,
        timeOffsetMinutes: timeOffsetMinutes !== undefined && timeOffsetMinutes !== null && String(timeOffsetMinutes).trim() !== ''
          ? parseInt(String(timeOffsetMinutes))
          : undefined,
        apiFootballKey: apiFootballKey || undefined,
        autoUpdate: autoUpdate !== undefined ? Boolean(autoUpdate) : true,
        updateSchedule: updateSchedule || '0 6 * * *',
        generateBanners: generateBanners !== undefined ? Boolean(generateBanners) : true,
        enabledLeagues: enabledLeaguesStr
      },
      create: {
        serverId,
        categoryName: categoryName || '⚽ JOGOS DO DIA',
        xuiCategoryId: xuiCategoryId ? parseInt(String(xuiCategoryId)) : undefined,
        bouquetId: bouquetId !== undefined && bouquetId !== null && String(bouquetId).trim() !== '' ? parseInt(String(bouquetId)) : 1,
        timeOffsetMinutes: timeOffsetMinutes !== undefined && timeOffsetMinutes !== null && String(timeOffsetMinutes).trim() !== ''
          ? parseInt(String(timeOffsetMinutes))
          : 0,
        apiFootballKey: apiFootballKey || undefined,
        autoUpdate: autoUpdate !== undefined ? Boolean(autoUpdate) : true,
        updateSchedule: updateSchedule || '0 6 * * *',
        generateBanners: generateBanners !== undefined ? Boolean(generateBanners) : true,
        enabledLeagues: enabledLeaguesStr || JSON.stringify([
          -1,
          4351, 4406, 4725, 4350, 4401, 4480, 4328, 4335, 4332, 4331, 4334
        ])
      }
    });
    
    logger.info(`[FootballController] Configuração salva para servidor ${serverId}`);
    res.json(config);
  } catch (error: any) {
    logger.error(`[FootballController] Erro ao salvar configuração:`, error);
    throw new AppError(500, `Erro ao salvar configuração: ${error.message}`);
  }
});

/**
 * GET /api/football/bouquets/:serverId
 * Lista bouquets disponíveis (salvos localmente via sync) para o servidor
 */
export const getBouquets = asyncHandler(async (req: Request, res: Response) => {
  const { serverId } = req.params;
  if (!serverId) throw new AppError(400, 'serverId é obrigatório');
  
  const bouquets = await prisma.bouquet.findMany({
    where: { serverId },
    orderBy: { name: 'asc' },
  });
  
  res.json(
    bouquets.map(b => ({
      id: b.id,
      externalId: b.externalId,
      name: b.name,
    }))
  );
});

/**
 * GET /api/football/channels/:serverId
 * Listar canais cadastrados
 */
export const getChannels = asyncHandler(async (req: Request, res: Response) => {
  const { serverId } = req.params;
  
  const config = await prisma.footballConfig.findUnique({
    where: { serverId }
  });
  
  if (!config) {
    return res.json([]);
  }
  
  const channels = await prisma.footballChannel.findMany({
    where: { configId: config.id },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }]
  });
  
  res.json(channels);
});

/**
 * POST /api/football/channels/:serverId
 * Adicionar canal
 */
export const addChannel = asyncHandler(async (req: Request, res: Response) => {
  const { serverId } = req.params;
  const {
    xuiStreamId,
    xuiStreamName,
    streamUrl,
    customKeywords
  } = req.body;
  
  logger.info('[FootballController] Adicionando canal:', {
    serverId,
    xuiStreamId,
    xuiStreamName,
    hasStreamUrl: !!streamUrl,
    hasCustomKeywords: !!customKeywords
  });
  
  if (!xuiStreamId || !xuiStreamName) {
    throw new AppError(400, 'xuiStreamId e xuiStreamName são obrigatórios');
  }
  
  // Buscar ou criar configuração se não existir
  let config = await prisma.footballConfig.findUnique({
    where: { serverId }
  });
  
  if (!config) {
    logger.warn(`[FootballController] Configuração não encontrada para ${serverId}, criando...`);
    // Criar configuração padrão se não existir
    config = await prisma.footballConfig.create({
      data: {
        serverId,
        categoryName: '⚽ JOGOS DO DIA',
        autoUpdate: true,
        updateSchedule: '0 6 * * *',
        generateBanners: true,
        enabledLeagues: JSON.stringify([
          // Nacionais
          71,   // Brasileirão A
          72,   // Brasileirão B
          73,   // Copa do Brasil
          // Estaduais principais (Jan-Abr)
          475,  // Paulistão
          476,  // Carioca
          477,  // Mineiro
          478,  // Gaúcho
          // Copinha (Janeiro)
          1353, // Copa São Paulo Júnior
          // Conmebol
          13,   // Libertadores
          11,   // Sul-Americana
          // UEFA
          2,    // Champions League
          // Ligas Europeias
          39,   // Premier League
          140,  // La Liga
        ])
      }
    });
    logger.info(`[FootballController] Configuração criada para ${serverId}`);
  }
  
  // Verificar se canal já existe
  const existingChannel = await prisma.footballChannel.findFirst({
    where: {
      configId: config.id,
      xuiStreamId: parseInt(String(xuiStreamId))
    }
  });
  
  if (existingChannel) {
    logger.warn(`[FootballController] Canal já existe: ${xuiStreamName} (ID: ${existingChannel.id})`);
    throw new AppError(400, 'Este canal já está cadastrado');
  }
  
  // Gerar keywords automaticamente do nome
  const nameLower = xuiStreamName.toLowerCase();
  const autoKeywords = nameLower
    .split(/[\s\-_]+/)
    .filter((w: string) => w.length > 2)
    .map((w: string) => w.replace(/[^a-z0-9]/g, ''));
  
  const keywords = [...autoKeywords];
  
  // Processar customKeywords (pode vir como string separada por vírgula ou array)
  let customKeywordsArray: string[] = [];
  if (customKeywords) {
    if (typeof customKeywords === 'string') {
      // Se for string, separar por vírgula
      customKeywordsArray = customKeywords
        .split(',')
        .map(k => k.trim().toLowerCase())
        .filter(k => k.length > 0);
    } else if (Array.isArray(customKeywords)) {
      customKeywordsArray = customKeywords.map((k: string) => k.trim().toLowerCase()).filter(k => k.length > 0);
    }
    keywords.push(...customKeywordsArray);
  }
  
  try {
    const channel = await prisma.footballChannel.create({
      data: {
        configId: config.id,
        xuiStreamId: parseInt(String(xuiStreamId)),
        xuiStreamName: xuiStreamName,
        streamUrl: streamUrl || undefined,
        keywords: JSON.stringify(keywords),
        customKeywords: customKeywordsArray.length > 0 ? JSON.stringify(customKeywordsArray) : undefined,
        isActive: true,
        priority: 0
      }
    });
    
    logger.info(`[FootballController] Canal criado com sucesso: ${channel.id}`);
    res.json(channel);
  } catch (error: any) {
    logger.error('[FootballController] Erro ao criar canal:', {
      message: error.message,
      stack: error.stack,
      serverId,
      xuiStreamId,
      xuiStreamName
    });
    throw new AppError(500, `Erro ao cadastrar canal: ${error.message}`);
  }
});

/**
 * PUT /api/football/channels/:channelId
 * Atualizar canal
 */
export const updateChannel = asyncHandler(async (req: Request, res: Response) => {
  const { channelId } = req.params;
  const {
    xuiStreamName,
    streamUrl,
    customKeywords,
    priority,
    isActive
  } = req.body;
  
  const channel = await prisma.footballChannel.update({
    where: { id: parseInt(channelId) },
    data: {
      xuiStreamName,
      streamUrl,
      customKeywords: customKeywords ? JSON.stringify(customKeywords) : undefined,
      priority,
      isActive
    }
  });
  
  res.json(channel);
});

/**
 * DELETE /api/football/channels/:channelId
 * Deletar canal
 */
export const deleteChannel = asyncHandler(async (req: Request, res: Response) => {
  const { channelId } = req.params;
  
  await prisma.footballChannel.delete({
    where: { id: parseInt(channelId) }
  });
  
  res.json({ message: 'Canal deletado com sucesso' });
});

/**
 * GET /api/football/matches/:serverId
 * Listar jogos do dia
 */
export const getMatches = asyncHandler(async (req: Request, res: Response) => {
  const { serverId } = req.params;
  const { dateRange } = req.query; // 'today', 'tomorrow', 'next3days'
  
  const service = new DailyMatchesService(serverId);
  await service.initialize();
  
  const matches = await service.getFormattedMatches(dateRange as string);
  
  res.json(matches);
});

/**
 * POST /api/football/matches/:serverId/update
 * Atualizar jogos do dia
 */
export const updateMatches = asyncHandler(async (req: Request, res: Response) => {
  const { serverId } = req.params;
  const { dateRange = 'today' } = req.body; // 'today', 'tomorrow', 'next3days'
  
  try {
    const service = new DailyMatchesService(serverId);
    await service.initialize();
    
    // Verificar quantas competições estão habilitadas
    const config = await prisma.footballConfig.findUnique({
      where: { serverId }
    });
    
    if (!config) {
      throw new AppError(404, 'Configuração não encontrada');
    }
    
    const enabledLeagues = JSON.parse(config.enabledLeagues || '[]');
    
    if (enabledLeagues.length === 0) {
      throw new AppError(400, 'Nenhuma competição selecionada. Selecione pelo menos uma competição na aba Configuração.');
    }
    
    if (enabledLeagues.length > 30) {
      logger.warn(`[FootballController] Muitas competições selecionadas (${enabledLeagues.length}). O processo pode levar vários minutos.`);
    }
    
    logger.info(`[FootballController] Iniciando atualização de jogos para ${enabledLeagues.length} competições`);
    
    const result = await service.updateDailyMatches(dateRange);
    
    logger.info(`[FootballController] Atualização concluída: ${result.total} jogos, ${result.mapped} mapeados`);
    logger.debug(`[FootballController] Resultado completo:`, JSON.stringify(result, null, 2));
    
    res.status(200).json({
      success: true,
      ...result
    });
  } catch (error: any) {
    logger.error('[FootballController] Erro ao atualizar jogos:', {
      error: error.message,
      stack: error.stack,
      serverId,
      dateRange,
      errorType: error.constructor?.name,
      errorCode: (error as any)?.code,
    });
    
    // Se já é um AppError, re-lançar
    if (error instanceof AppError) {
      throw error;
    }
    
    // Erro genérico
    const errorMessage = error.message || 'Erro desconhecido';
    logger.error(`[FootballController] Erro detalhado: ${errorMessage}`);
    throw new AppError(
      500,
      `Erro ao atualizar jogos: ${errorMessage}. ` +
      `Verifique se a API key está configurada corretamente e se há jogos disponíveis para as competições selecionadas.`
    );
  }
});

/**
 * POST /api/football/matches/:matchId/map
 * Mapear jogo manualmente para um canal
 */
export const mapMatchChannel = asyncHandler(async (req: Request, res: Response) => {
  const { matchId } = req.params;
  const { channelId } = req.body;
  
  if (!channelId) {
    throw new AppError(400, 'channelId é obrigatório');
  }
  
  const match = await prisma.dailyMatch.findUnique({
    where: { id: parseInt(matchId) },
    include: { config: true }
  });
  
  if (!match) {
    throw new AppError(404, 'Jogo não encontrado');
  }
  
  const channel = await prisma.footballChannel.findUnique({
    where: { id: parseInt(channelId) }
  });
  
  if (!channel) {
    throw new AppError(404, 'Canal não encontrado');
  }
  
  // Atualizar mapeamento
  await prisma.dailyMatch.update({
    where: { id: parseInt(matchId) },
    data: {
      mappedChannelId: channel.id,
      mappedChannelName: channel.xuiStreamName,
      matchScore: 1.0 // Manual = score perfeito
    }
  });
  
  // Salvar mapeamento aprendido
  const apiChannels = JSON.parse(match.apiChannels || '[]');
  if (apiChannels.length > 0) {
    const matcher = new ChannelMatcherService(match.configId);
    await matcher.initialize();
    await matcher.saveMapping(apiChannels[0], channel.id);
  }
  
  // ⚠️ CORREÇÃO: Criar stream no XUI após mapeamento manual
  try {
    const { DailyMatchesService } = await import('../services/jogos-do-dia/daily-matches.service.js');
    const service = new DailyMatchesService(match.config.serverId);
    await service.initialize();
    
    // Buscar canal atualizado
    const updatedMatch = await prisma.dailyMatch.findUnique({
      where: { id: parseInt(matchId) }
    });
    
    // ⚠️ CORREÇÃO: Criar stream mesmo se já existe (para permitir recriação em testes)
    // Ou criar se não existe
    if (updatedMatch && channel.streamUrl) {
      const streamName = `⚽ ${updatedMatch.matchTime} | ${updatedMatch.homeTeam} x ${updatedMatch.awayTeam}`;
      
      // Se já existe stream, deletar primeiro (para recriação)
      if (updatedMatch.xuiStreamId) {
        try {
          const { XUIVodDBClient } = await import('../services/vod/xui-vod-db.client.js');
          const server = await prisma.xuiServer.findUnique({
            where: { id: match.config.serverId }
          });
          if (server) {
            const xuiClient = new XUIVodDBClient(server);
            const conn = await xuiClient.connect();
            await conn.query('DELETE FROM streams WHERE id = ?', [updatedMatch.xuiStreamId]);
            await xuiClient.disconnect();
            logger.info(`[FootballController] Stream antigo deletado: ${updatedMatch.xuiStreamId}`);
          }
        } catch (error: any) {
          logger.warn(`[FootballController] Erro ao deletar stream antigo: ${error.message}`);
        }
      }
      
      const xuiStream = await (service as any).createXuiStream(streamName, {
        name: channel.xuiStreamName,
        streamUrl: channel.streamUrl
      });
      
      if (xuiStream) {
        await prisma.dailyMatch.update({
          where: { id: parseInt(matchId) },
          data: {
            xuiStreamId: xuiStream.id,
            xuiStreamName: streamName
          }
        });
        logger.info(`[FootballController] ✅ Stream criado/recriado: ID ${xuiStream.id}`);
        
        // ⚠️ CORREÇÃO: Garantir que o stream está no bouquet "canais"
        try {
          const { XUIVodDBClient } = await import('../services/vod/xui-vod-db.client.js');
          const server = await prisma.xuiServer.findUnique({
            where: { id: match.config.serverId }
          });
          if (server) {
            const xuiClient = new XUIVodDBClient(server);
            await xuiClient.addChannelsToBouquet(2, [xuiStream.id]); // Bouquet ID 1 = "canais"
            await xuiClient.disconnect();
            logger.info(`[FootballController] ✅ Stream ${xuiStream.id} adicionado ao bouquet 2 (canais)`);
          }
        } catch (error: any) {
          logger.error(`[FootballController] ❌ Erro ao adicionar stream ao bouquet: ${error.message}`);
        }
      }
    }
  } catch (error: any) {
    logger.warn(`Erro ao criar stream após mapeamento (não crítico): ${error.message}`);
  }
  
  res.json({ message: 'Jogo mapeado com sucesso' });
});

/**
 * GET /api/football/api-channels
 * Listar canais disponíveis da API (mapeamento estático)
 */
export const getApiChannels = asyncHandler(async (req: Request, res: Response) => {
  const { CHANNEL_MAPPING } = await import('../services/jogos-do-dia/football-api.service.js');
  
  // Extrair todos os canais únicos do mapeamento
  const allChannels = new Set<string>();
  Object.values(CHANNEL_MAPPING).forEach(channels => {
    channels.forEach(channel => allChannels.add(channel));
  });
  
  res.json(Array.from(allChannels).sort());
});

/**
 * GET /api/football/xui-categories/:serverId
 * Listar categorias do XUI para um servidor (conexão direta com timeout)
 */
export const getXuiCategories = asyncHandler(async (req: Request, res: Response) => {
  const { serverId } = req.params;
  
  if (!serverId) {
    throw new AppError(400, 'serverId é obrigatório');
  }
  
  const server = await prisma.xuiServer.findUnique({
    where: { id: serverId }
  });
  
  if (!server) {
    throw new AppError(404, 'Servidor não encontrado');
  }
  
  // Verificar credenciais
  if (!server.dbHost || !server.dbUser || !server.dbPassword) {
    throw new AppError(400, 'Credenciais MySQL não configuradas. Configure em Configurações > Conexão XUI.');
  }
  
  // ✅ CORREÇÃO: Usar conexão direta com timeout em vez de pool (evita travamento)
  const mysql = await import('mysql2/promise');
  const { decrypt } = await import('../utils/crypto.js');
  
  let dbPassword = server.dbPassword;
  try {
    dbPassword = decrypt(dbPassword);
  } catch (e) {
    logger.debug('[FootballController] Senha não criptografada ou erro ao descriptografar');
  }
  
  logger.info('[FootballController] Conectando ao MySQL:', {
    serverId,
    dbHost: server.dbHost,
    dbUser: server.dbUser,
    dbName: server.dbName || 'xui'
  });
  
  let connection: any = null;
  try {
    // Conexão com timeout de 10 segundos
    const connectionPromise = mysql.createConnection({
      host: server.dbHost,
      port: server.dbPort || 3306,
      user: server.dbUser,
      password: dbPassword,
      database: server.dbName || 'xui',
      connectTimeout: 10000, // 10s timeout
    });
    
    // Timeout wrapper
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout: Conexão MySQL demorou mais de 10 segundos')), 10000)
    );
    
    connection = await Promise.race([connectionPromise, timeoutPromise]);
    
    logger.info('[FootballController] ✅ Conectado ao MySQL, buscando categorias...');
    
    // Detectar nome da tabela de categorias (XUI ONE vs Xtream UI)
    let catTable = 'streams_categories';
    for (const t of ['streams_categories', 'stream_categories']) {
      const [exists] = await connection.query(`SHOW TABLES LIKE '${t}'`);
      if ((exists as any[]).length > 0) { catTable = t; break; }
    }

    // Buscar categorias LIVE
    const [categories] = await connection.query(
      `SELECT id, category_name, parent_id 
       FROM ${catTable} 
       WHERE category_type = 'live'
       ORDER BY category_name ASC`
    );
    
    logger.info('[FootballController] ✅ Categorias encontradas:', categories?.length || 0);
    
    await connection.end();
    
    res.json(categories);
  } catch (error: any) {
    logger.error('[FootballController] ❌ Erro ao buscar categorias:', {
      message: error.message,
      code: error.code,
      errno: error.errno,
      serverId,
      dbHost: server.dbHost
    });
    
    if (connection) {
      try { await connection.end(); } catch (e) { /* ignore */ }
    }
    
    // Mensagens de erro amigáveis
    if (error.code === 'ECONNREFUSED') {
      throw new AppError(500, `Conexão recusada pelo servidor MySQL (${server.dbHost}). Verifique se o MySQL está rodando e aceita conexões externas.`);
    }
    if (error.code === 'ETIMEDOUT' || error.message.includes('Timeout')) {
      throw new AppError(500, `Timeout ao conectar ao MySQL (${server.dbHost}). Verifique firewall e conectividade.`);
    }
    if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      throw new AppError(500, `Acesso negado ao MySQL. Verifique usuário e senha.`);
    }
    
    throw new AppError(500, `Erro ao buscar categorias: ${error.message}`);
  }
});

/**
 * GET /api/football/xui-channels/:serverId/:categoryId
 * Listar canais de uma categoria do XUI (conexão direta com timeout)
 */
export const getXuiChannels = asyncHandler(async (req: Request, res: Response) => {
  const { serverId, categoryId } = req.params;
  
  const server = await prisma.xuiServer.findUnique({
    where: { id: serverId }
  });
  
  if (!server) {
    throw new AppError(404, 'Servidor não encontrado');
  }
  
  if (!server.dbHost || !server.dbUser || !server.dbPassword) {
    throw new AppError(400, 'Credenciais MySQL não configuradas.');
  }
  
  const mysql = await import('mysql2/promise');
  const { decrypt } = await import('../utils/crypto.js');
  
  let dbPassword = server.dbPassword;
  try {
    dbPassword = decrypt(dbPassword);
  } catch (e) { /* usar como está */ }
  
  let connection: any = null;
  try {
    connection = await mysql.createConnection({
      host: server.dbHost,
      port: server.dbPort || 3306,
      user: server.dbUser,
      password: dbPassword,
      database: server.dbName || 'xui',
      connectTimeout: 10000,
    });
    
    const [channels] = await connection.query(
      `SELECT id, stream_display_name, stream_icon, stream_source
       FROM streams
       WHERE type = 1
       AND category_id = ?
       ORDER BY stream_display_name ASC`,
      [parseInt(categoryId)]
    );
    
    await connection.end();
    
    res.json((channels as any[]).map(ch => ({
      id: ch.id,
      name: ch.stream_display_name,
      icon: ch.stream_icon,
      source: ch.stream_source ? JSON.parse(ch.stream_source) : []
    })));
  } catch (error: any) {
    if (connection) {
      try { await connection.end(); } catch (e) { /* ignore */ }
    }
    logger.error('[FootballController] Erro ao buscar canais:', error.message);
    throw new AppError(500, `Erro ao buscar canais: ${error.message}`);
  }
});

/**
 * GET /api/football/mappings
 * Listar mapeamentos aprendidos
 */
export const getMappings = asyncHandler(async (req: Request, res: Response) => {
  const mappings = await prisma.channelMapping.findMany({
    orderBy: [{ useCount: 'desc' }, { updatedAt: 'desc' }]
  });
  
  res.json(mappings);
});

/**
 * POST /api/football/mappings
 * Salvar mapeamento manual
 */
export const saveMapping = asyncHandler(async (req: Request, res: Response) => {
  const {
    apiChannelName,
    xuiChannelId,
    xuiChannelName,
    serverId
  } = req.body;
  
  if (!apiChannelName || !xuiChannelId) {
    throw new AppError(400, 'apiChannelName e xuiChannelId são obrigatórios');
  }
  
  // Se não tiver xuiChannelName, buscar do XUI diretamente
  let channelName = xuiChannelName;
  if (!channelName && serverId) {
    const server = await prisma.xuiServer.findUnique({
      where: { id: serverId }
    });
    
    if (server) {
      const { XUIVodDBClient } = await import('../services/vod/xui-vod-db.client.js');
      const xuiClient = new XUIVodDBClient(server);
      const conn = await xuiClient.connect();
      try {
        const [rows] = await conn.query<any[]>(
          `SELECT stream_display_name FROM streams WHERE id = ? AND type = 1 LIMIT 1`,
          [parseInt(xuiChannelId)]
        );
        if (rows.length > 0) {
          channelName = rows[0].stream_display_name;
        }
      } finally {
        await xuiClient.disconnect();
      }
    }
  }
  
  if (!channelName) {
    throw new AppError(404, 'Nome do canal não encontrado');
  }
  
  const mapping = await prisma.channelMapping.upsert({
    where: { apiChannelName },
    create: {
      apiChannelName,
      xuiChannelId: parseInt(xuiChannelId),
      xuiChannelName: channelName,
      mappingType: 'manual',
      useCount: 1
    },
    update: {
      xuiChannelId: parseInt(xuiChannelId),
      xuiChannelName: channelName,
      mappingType: 'manual',
      useCount: { increment: 1 }
    }
  });
  
  res.json(mapping);
});

/**
 * DELETE /api/football/mappings/:id
 * Deletar mapeamento
 */
export const deleteMapping = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  
  await prisma.channelMapping.delete({
    where: { id: parseInt(id) }
  });
  
  res.json({ message: 'Mapeamento deletado com sucesso' });
});

/**
 * POST /api/football/create-category/:serverId
 * Criar categoria "Jogos do Dia" no XUI
 */
export const createCategory = asyncHandler(async (req: Request, res: Response) => {
  const { serverId } = req.params;
  const { categoryName = '⚽ JOGOS DO DIA' } = req.body;
  
  if (!serverId) {
    throw new AppError(400, 'serverId é obrigatório');
  }
  
  const server = await prisma.xuiServer.findUnique({
    where: { id: serverId }
  });
  
  if (!server) {
    throw new AppError(404, 'Servidor não encontrado');
  }
  
  // Verificar credenciais do banco
  if (!server.dbHost || !server.dbUser || !server.dbPassword) {
    throw new AppError(400, 'Servidor XUI não tem credenciais de banco de dados configuradas. Configure em Configurações > Conexão XUI');
  }
  
  // Descriptografar senha se necessário
  let dbPassword = server.dbPassword;
  try {
    const { decrypt } = await import('../utils/crypto.js');
    dbPassword = decrypt(dbPassword);
  } catch (e) {
    // Se falhar, usar como está (pode já estar descriptografado)
    logger.debug('[FootballController] Senha não criptografada ou erro ao descriptografar');
  }
  
  // Conectar ao MySQL do XUI
  const mysql = await import('mysql2/promise');
  const connection = await mysql.createConnection({
    host: server.dbHost,
    port: server.dbPort || 3306,
    user: server.dbUser,
    password: dbPassword,
    database: server.dbName || 'xui',
  });
  
  try {
    // Detectar nome da tabela de categorias
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
      logger.info(`[FootballController] Categoria já existe: ${categoryName} (ID: ${existing[0].id})`);
      return res.json({ 
        success: true,
        categoryId: existing[0].id,
        categoryName: categoryName,
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
      logger.error('[FootballController] insertId não retornado:', { insertResult });
      throw new AppError(500, 'Erro ao criar categoria: insertId não retornado');
    }
    
    await connection.end();
    
    logger.info(`[FootballController] Categoria criada com sucesso: ${categoryName} (ID: ${categoryId})`);
    
    res.json({ 
      success: true,
      categoryId,
      categoryName: categoryName,
      message: 'Categoria criada com sucesso no XUI',
    });
  } catch (error: any) {
    logger.error('[FootballController] Erro ao criar categoria:', {
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
 * GET /api/football/competitions
 * Listar todas as competições disponíveis com nomes
 */
/**
 * DELETE /api/football/matches/:id
 * Deletar um jogo
 */
export const deleteMatch = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  
  const match = await prisma.dailyMatch.findUnique({
    where: { id: parseInt(id) },
    include: { config: true }
  });
  
  if (!match) {
    throw new AppError(404, 'Jogo não encontrado');
  }
  
  // Se tem stream no XUI, deletar também
  if (match.xuiStreamId) {
    try {
      const service = new DailyMatchesService(match.config.serverId);
      await service.initialize();
      await service.deleteXuiStream(match.xuiStreamId);
      logger.info(`[FootballController] Stream XUI ${match.xuiStreamId} deletado para jogo ${match.id}`);
    } catch (error: any) {
      logger.warn(`[FootballController] Erro ao deletar stream XUI (não crítico): ${error.message}`);
    }
  }
  
  await prisma.dailyMatch.delete({
    where: { id: parseInt(id) }
  });
  
  res.json({ message: 'Jogo deletado com sucesso' });
});

/**
 * PATCH /api/football/matches/:id
 * Editar um jogo (horário, times, etc)
 */
export const updateMatch = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { matchTime, homeTeam, awayTeam, matchDate } = req.body;
  
  const match = await prisma.dailyMatch.findUnique({
    where: { id: parseInt(id) },
    include: { config: true }
  });
  
  if (!match) {
    throw new AppError(404, 'Jogo não encontrado');
  }
  
  const updateData: any = {};
  if (matchTime !== undefined) updateData.matchTime = matchTime;
  if (homeTeam !== undefined) updateData.homeTeam = homeTeam;
  if (awayTeam !== undefined) updateData.awayTeam = awayTeam;
  if (matchDate !== undefined) updateData.matchDate = new Date(matchDate);
  
  const updatedMatch = await prisma.dailyMatch.update({
    where: { id: parseInt(id) },
    data: updateData
  });
  
  // Se o horário mudou e tem stream no XUI, atualizar o nome do stream
  if (matchTime && match.xuiStreamId) {
    try {
      const service = new DailyMatchesService(match.config.serverId);
      await service.initialize();
      const streamName = `⚽ ${matchTime} | ${updatedMatch.homeTeam} x ${updatedMatch.awayTeam}`;
      // Atualizar nome do stream no XUI (se necessário)
      logger.info(`[FootballController] Horário atualizado para jogo ${match.id}, stream: ${match.xuiStreamId}`);
    } catch (error: any) {
      logger.warn(`[FootballController] Erro ao atualizar stream XUI (não crítico): ${error.message}`);
    }
  }
  
  res.json({ message: 'Jogo atualizado com sucesso', match: updatedMatch });
});

export const getCompetitions = asyncHandler(async (req: Request, res: Response) => {
  // IDs CORRETOS do TheSportsDB
  const competitions = [
    { id: -1, name: 'Brasil (todas as ligas)', category: 'Brasil - Geral' },
    // Brasil - Nacionais
    { id: 4351, name: 'Brasileirão Série A', category: 'Brasil - Nacional' },
    { id: 4406, name: 'Brasileirão Série B', category: 'Brasil - Nacional' },
    { id: 4725, name: 'Copa do Brasil', category: 'Brasil - Nacional' },
    // Brasil - Estaduais
    { id: 4532, name: 'Campeonato Paulista', category: 'Brasil - Estadual' },
    { id: 4533, name: 'Campeonato Carioca', category: 'Brasil - Estadual' },
    { id: 4534, name: 'Campeonato Mineiro', category: 'Brasil - Estadual' },
    { id: 4535, name: 'Campeonato Gaúcho', category: 'Brasil - Estadual' },
    { id: 4536, name: 'Copa do Nordeste', category: 'Brasil' },
    // Conmebol
    { id: 4350, name: 'Copa Libertadores', category: 'Conmebol' },
    { id: 4401, name: 'Copa Sul-Americana', category: 'Conmebol' },
    // Europa
    { id: 4480, name: 'UEFA Champions League', category: 'Europa' },
    { id: 4481, name: 'UEFA Europa League', category: 'Europa' },
    { id: 4328, name: 'Premier League', category: 'Europa - Inglaterra' },
    { id: 4335, name: 'La Liga', category: 'Europa - Espanha' },
    { id: 4332, name: 'Serie A (Itália)', category: 'Europa - Itália' },
    { id: 4331, name: 'Bundesliga', category: 'Europa - Alemanha' },
    { id: 4334, name: 'Ligue 1', category: 'Europa - França' },
  ];
  res.json(competitions);
});

// ✅ Removido: Métodos discoverBrazilianLeagues e importLeagueMatches (não necessários com API do GE)

