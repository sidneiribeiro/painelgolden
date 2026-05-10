/**
 * Serviço principal de Jogos do Dia
 * 
 * Orquestra:
 * 1. Busca de jogos da API
 * 2. Matching de canais
 * 3. Criação de streams no XUI
 * 4. Geração de banners
 */

import { prisma } from '../../config/database.js';
import { createLogger } from '../../utils/logger.js';
import fs from 'fs/promises';
import path from 'path';
import GEApiService, { StandardizedMatch } from './ge-api.service.js';
import { LeagueChannelMatcherService } from './league-channel-matcher.service.js';
import { XUIVodDBClient, LiveChannelData } from '../vod/xui-vod-db.client.js';
import FootballBannerService, { MatchData } from '../marketing/football-banner.service.js';

const logger = createLogger('DailyMatches');

export class DailyMatchesService {
  private serverId: string;
  private config: any;
  private geApi: GEApiService | null = null;
  private leagueMatcher: LeagueChannelMatcherService | null = null;
  private xuiClient: XUIVodDBClient | null = null;
  
  constructor(serverId: string) {
    this.serverId = serverId;
  }

  /**
   * Deleta um stream LIVE no XUI (por ID)
   */
  async deleteXuiStream(streamId: number): Promise<void> {
    if (!this.xuiClient) {
      await this.initialize();
    }
    if (!this.xuiClient) throw new Error('XUI client não inicializado');
    await this.xuiClient.deleteLiveStreamById(streamId);
  }
  
  /**
   * Inicializa o serviço
   */
  async initialize(): Promise<void> {
    // Carregar configuração
    const server = await prisma.xuiServer.findUnique({
      where: { id: this.serverId }
    });
    
    if (!server) {
      throw new Error(`Servidor XUI não encontrado: ${this.serverId}`);
    }
    
    this.config = await prisma.footballConfig.findUnique({
      where: { serverId: this.serverId }
    });
    
    if (!this.config) {
      // Criar configuração padrão
      this.config = await prisma.footballConfig.create({
        data: {
          serverId: this.serverId,
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
    }
    
    // ✅ Inicializar GE API (única fonte - sempre tem canais BR)
    this.geApi = new GEApiService();
    logger.info('[DailyMatches] ✅ GE API inicializada');
    
    // ✅ Inicializar matcher inteligente por campeonato
    this.leagueMatcher = new LeagueChannelMatcherService(this.config.id);
    await this.leagueMatcher.initialize();
    logger.info('[DailyMatches] ✅ League Matcher inicializado (mapeamento por campeonato)');
    
    // Inicializar cliente XUI
    this.xuiClient = new XUIVodDBClient(server);
    
    logger.info(`DailyMatchesService inicializado para servidor ${server.name}`);
  }
  
  /**
   * Atualiza jogos do dia
   */
  async updateDailyMatches(dateRange: string = 'today'): Promise<{ total: number; mapped: number; created: number; streamsCreated: number }> {
    logger.info(`[DailyMatches] Iniciando atualização de jogos do dia (range: ${dateRange})...`);
    
    if (!this.leagueMatcher || !this.xuiClient) {
      await this.initialize();
    }
    
    // 1. Buscar jogos da API GE (única fonte)
    logger.info(`[DailyMatches] Buscando jogos da API GE (range: ${dateRange})...`);
    
    let matches: any[] = [];
    let geMatches: StandardizedMatch[] = [];
    
    // ✅ Buscar da API do GE
    try {
      if (!this.geApi) {
        throw new Error('GE API não inicializado');
      }
      
      logger.info('[DailyMatches] 🎯 Buscando jogos da API GE...');
      
      // Buscar jogos baseado no range
      if (dateRange === 'today') {
        geMatches = await this.geApi.getTodayMatches();
      } else if (dateRange === 'tomorrow') {
        geMatches = await this.geApi.getTomorrowMatches();
      } else {
        // Buscar próximos 7 dias
        geMatches = await this.geApi.getMatchesForNextDays(7);
      }
      
      if (geMatches.length > 0) {
        const withChannels = geMatches.filter(m => m.channels && m.channels.length > 0);
        logger.info(`[DailyMatches] ✅ GE API retornou ${geMatches.length} jogos (${withChannels.length} COM canais)`);
    
        // Converter para formato interno
        matches = geMatches.map(match => ({
          id: match.id,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          homeTeamLogo: match.homeTeamLogo,
          awayTeamLogo: match.awayTeamLogo,
          leagueId: match.leagueId,
          leagueName: match.leagueName,
          leagueLogo: match.leagueLogo,
          date: match.date,
          time: match.time,
          status: match.status,
          channels: match.channels || [],
          venue: match.venue,
          source: 'GE' // Marcar fonte
        }));
      } else {
        logger.warn('[DailyMatches] ⚠️ GE API não retornou jogos');
      }
    } catch (error: any) {
      logger.error('[DailyMatches] ❌ Erro ao buscar da GE API:', error.message);
      // Continuar para limpar jogos antigos mesmo com erro na API
    }
    
    // ✅ Limpar jogos antigos (dias anteriores) para não acumular na categoria
    // ⚠️ SEMPRE executar limpeza, mesmo quando não há jogos novos
    // ⚠️ IMPORTANTE: Limpar ANTES de processar novos jogos para evitar duplicação
    try {
      const todayBrazil = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      const cutoff = new Date(`${todayBrazil}T00:00:00-03:00`); // início do dia BR em UTC
      
      logger.info(`[DailyMatches] Limpando jogos antigos (antes de ${todayBrazil})...`);
      
      const oldMatches = await prisma.dailyMatch.findMany({
        where: {
          configId: this.config.id,
          matchDate: { lt: cutoff },
        },
        select: { id: true, xuiStreamId: true },
      });

      logger.info(`[DailyMatches] Encontrados ${oldMatches.length} jogo(s) antigo(s) para limpar`);

      // Deletar streams do XUI primeiro
      const oldStreamIds = oldMatches.map(m => m.xuiStreamId).filter((id): id is number => typeof id === 'number');
      let deletedStreams = 0;
      
      for (const sid of oldStreamIds) {
        try {
          await this.deleteXuiStream(sid);
          deletedStreams++;
        } catch (e: any) {
          logger.warn(`[DailyMatches] Erro ao deletar stream antigo ${sid} (não crítico): ${e?.message || String(e)}`);
        }
      }

      // Deletar jogos do banco
      if (oldMatches.length > 0) {
        await prisma.dailyMatch.deleteMany({
          where: { id: { in: oldMatches.map(m => m.id) } },
        });
        logger.info(`[DailyMatches] ✅ Limpou ${oldMatches.length} jogo(s) antigo(s) (${deletedStreams} streams deletados do XUI)`);
      }
    } catch (e: any) {
      logger.error(`[DailyMatches] ❌ ERRO ao limpar jogos antigos: ${e?.message || String(e)}`);
      // Continuar mesmo se der erro na limpeza
    }
    
    logger.info(`[DailyMatches] ${matches.length} jogos encontrados`);
    
    let mapped = 0;
    let created = 0;
    
    // 2. Processar cada jogo
    for (const match of matches) {
      try {
        // Canais da competição (API GE retorna canais)
        const apiChannels = match.channels && match.channels.length > 0 
          ? match.channels 
          : [];
        
        // 3. Verificar se jogo já existe para preservar mapeamento manual
        const existingMatch = await prisma.dailyMatch.findUnique({
          where: {
            configId_apiMatchId: {
              configId: this.config.id,
              apiMatchId: match.id
            }
          }
        });
        
        const hasManualMapping = existingMatch && existingMatch.matchScore === 1.0;
        
        // 4. 🏆 MATCHING INTELIGENTE POR CAMPEONATO (NOVO!)
        let footballChannelId: number | null = null;
        let xuiChannelName: string | null = null;
        let matchScore: number | null = null;
        
        if (!hasManualMapping) {
          // Usar novo sistema de mapeamento por campeonato
          const leagueMatch = await this.leagueMatcher!.findChannelForMatch(
            match.leagueName,
            apiChannels
          );
          
          if (leagueMatch) {
            footballChannelId = leagueMatch.footballChannelId;
            xuiChannelName = leagueMatch.xuiChannelName;
            matchScore = leagueMatch.score;
            
            logger.info(
              `✅ [${leagueMatch.matchedBy.toUpperCase()}] ${match.leagueName}: ` +
              `${match.homeTeam} vs ${match.awayTeam} → ${xuiChannelName} ` +
              `(${(matchScore * 100).toFixed(0)}%)`
            );
          } else {
            logger.warn(
              `⚠️ ${match.leagueName}: ${match.homeTeam} vs ${match.awayTeam} - Sem canal mapeado`
            );
          }
        } else if (existingMatch && existingMatch.mappedChannelId) {
          // Se tem mapeamento manual, usar o canal já mapeado
          footballChannelId = existingMatch.mappedChannelId;
          xuiChannelName = existingMatch.mappedChannelName;
          matchScore = 1.0;
          
          logger.info(
            `🔒 [MANUAL] ${match.leagueName}: ${match.homeTeam} vs ${match.awayTeam} → ${xuiChannelName}`
          );
        }
        
        // 5. Salvar/atualizar jogo no banco
        const dailyMatch = await prisma.dailyMatch.upsert({
          where: {
            configId_apiMatchId: {
              configId: this.config.id,
              apiMatchId: match.id
            }
          },
          create: {
            configId: this.config.id,
            apiMatchId: match.id,
            homeTeam: match.homeTeam,
            awayTeam: match.awayTeam,
            homeTeamLogo: match.homeTeamLogo,
            awayTeamLogo: match.awayTeamLogo,
            leagueId: match.leagueId,
            leagueName: match.leagueName,
            leagueLogo: match.leagueLogo,
            matchDate: new Date(match.date),
            matchTime: match.time,
            status: match.status,
            apiChannels: JSON.stringify(apiChannels),
            mappedChannelId: footballChannelId,
            mappedChannelName: xuiChannelName,
            matchScore: matchScore,
          },
          update: {
            status: match.status,
            matchDate: new Date(match.date),
            matchTime: match.time,
            // ⚠️ Não sobrescrever mapeamento manual se já existir
            ...(hasManualMapping ? {} : {
              mappedChannelId: footballChannelId,
              mappedChannelName: xuiChannelName,
              matchScore: matchScore,
            }),
          }
        });
        
        if (footballChannelId) {
          mapped++;
          
          // Buscar dados do canal para criar stream
          const footballChannel = await prisma.footballChannel.findUnique({
            where: { id: footballChannelId },
            select: { xuiStreamId: true, streamUrl: true, xuiStreamName: true },
          });
          
          // Garantir streamUrl do canal
          let streamUrl = footballChannel?.streamUrl;
          if (this.xuiClient && footballChannel && !streamUrl) {
            try {
              const src = await this.xuiClient.getLiveStreamSource(footballChannel.xuiStreamId);
              if (src) {
                streamUrl = src;
                await prisma.footballChannel.update({
                  where: { id: footballChannelId },
                  data: { streamUrl: src },
                });
                logger.info(`[DailyMatches] ✅ streamUrl preenchida para canal ${xuiChannelName}`);
              }
            } catch (e: any) {
              logger.warn(`[DailyMatches] Não foi possível preencher streamUrl automaticamente: ${e?.message || String(e)}`);
            }
          }

          // 5. Criar stream no XUI (se ainda não existe)
          if (!dailyMatch.xuiStreamId && this.xuiClient && streamUrl) {
            const streamName = `⚽ ${match.time} | ${match.homeTeam} x ${match.awayTeam}`;
            logger.info(`[DailyMatches] Tentando criar stream: ${streamName}`);
            
            const channelData = {
              id: footballChannelId,
              name: xuiChannelName!,
              streamUrl: streamUrl
            };
            
            const xuiStream = await this.createXuiStream(streamName, channelData);
            
            if (xuiStream) {
              await prisma.dailyMatch.update({
                where: { id: dailyMatch.id },
                data: {
                  xuiStreamId: xuiStream.id,
                  xuiStreamName: streamName
                }
              });
              created++;
              logger.info(`[DailyMatches] ✅ Stream criado com sucesso: ID ${xuiStream.id}`);
            } else {
              logger.warn(`[DailyMatches] ⚠️ Falha ao criar stream para ${streamName}`);
            }
          } else {
            if (!this.xuiClient) {
              logger.warn(`[DailyMatches] ⚠️ XUI client não disponível para ${match.homeTeam} vs ${match.awayTeam}`);
            } else if (!streamUrl) {
              logger.warn(`[DailyMatches] ⚠️ Canal sem streamUrl para ${match.homeTeam} vs ${match.awayTeam}`);
            } else if (dailyMatch.xuiStreamId) {
              logger.debug(`[DailyMatches] Stream já existe (ID: ${dailyMatch.xuiStreamId}) para ${match.homeTeam} vs ${match.awayTeam}`);
            }
          }
        } else {
          logger.warn(`⚠️ ${match.homeTeam} vs ${match.awayTeam} - Sem canal mapeado`);
        }
        
      } catch (error: any) {
        logger.error(`Erro ao processar jogo ${match.id}: ${error.message}`);
      }
    }
    
    // 6. Gerar banners (se habilitado)
    if (this.config.generateBanners) {
      try {
        await this.generateMatchBanners();
      } catch (error: any) {
        logger.warn(`[DailyMatches] Erro ao gerar banners (não crítico): ${error.message}`);
        // Não lançar erro, apenas logar
      }
    }
    
    logger.info(`[DailyMatches] Atualização concluída: ${matches.length} jogos, ${mapped} mapeados, ${created} streams criados`);
    
    return { total: matches.length, mapped, created, streamsCreated: created };
  }
  
  /**
   * Cria stream no XUI para um jogo
   */
  private async createXuiStream(streamName: string, channel: any): Promise<{ id: number } | null> {
    try {
      if (!this.xuiClient) {
        logger.error('[DailyMatches] ❌ XUI client não configurado');
        return null;
      }
      
      logger.debug(`[DailyMatches] Criando stream: ${streamName}`);
      logger.debug(`[DailyMatches] Canal: ${channel.name}, StreamUrl: ${channel.streamUrl}`);
      
      // 1. Buscar categoria ou criar
      let categoryId = this.config.xuiCategoryId;
      logger.debug(`[DailyMatches] CategoryId atual: ${categoryId || 'não definido'}`);
      
      if (!categoryId) {
        const category = await this.xuiClient!.findCategoryByName(this.config.categoryName, 'live');
        if (category) {
          categoryId = category.id;
          await prisma.footballConfig.update({
            where: { id: this.config.id },
            data: { xuiCategoryId: categoryId }
          });
        } else {
          const newCategory = await this.xuiClient!.createCategory({
            category_name: this.config.categoryName,
            category_type: 'live',
          });
          categoryId = newCategory.id;
          await prisma.footballConfig.update({
            where: { id: this.config.id },
            data: { xuiCategoryId: categoryId }
          });
        }
      }
      
      // 2. Bouquet configurável (padrão: 1)
      const bouquetId = this.config.bouquetId || 2;
      logger.debug(`[DailyMatches] Usando bouquet ID ${bouquetId}`);
      
      // 3. Buscar serverId do servidor XUI (para server tree)
      // O serverId na tabela streams_servers geralmente é 1 (servidor principal)
      // Se o servidor XUI tiver múltiplos servidores, pode ser necessário buscar
      const streamServerId = 1; // ID padrão do servidor principal no XUI
      
      // 4. Criar stream com configurações DIRECT SOURCE + DIRECT STREAM
      // ⚠️ Configuração igual aos canais ESPN/SporTV que funcionam:
      // - direct_source = 1 (Direct Source marcado)
      // - direct_proxy = 1 (Direct Stream marcado)
      // - Entry em streams_servers com on_demand = 0
      const streamData: LiveChannelData = {
        stream_display_name: streamName,
        stream_source: [channel.streamUrl || ''],
        category_id: [categoryId],
        direct_source: 1, // ✅ Direct Source
        direct_proxy: 1, // ✅ Direct Stream (CORRIGIDO!)
        read_native: 0, // OBRIGATÓRIO para aparecer no XUI
        enable_transcode: 0, // Sem transcodificação
        stream_all: 0, // Não necessário
        gen_timestamps: 0, // Igual aos canais que funcionam
        probesize_ondemand: 128000, // Valor padrão para direct
      };
      
      // 5. Inserir stream com server tree (serverId = 1)
      logger.info(`[DailyMatches] Inserindo stream DIRECT no XUI: ${streamName}`);
      logger.debug(`[DailyMatches] Configurações: categoryId=${categoryId}, serverId=${streamServerId}, direct_source=1, direct_proxy=1`);
      
      const result = await this.xuiClient.bulkInsertLiveChannels(
        [streamData],
        1,
        true, // Evitar duplicar canal se já existir
        streamServerId, // ✅ Passar serverId para criar entry em streams_servers
        false // ✅ on_demand = 0 (DIRECT, não OnDemand)
      );
      
      logger.info(`[DailyMatches] Resultado da inserção: inserted=${result.inserted}, errors=${result.errors}, skipped=${result.skipped}, ids=${result.insertedIds?.length || 0}`);
      
      let streamId: number | null = null;
      
      // Se foi inserido, usar o ID retornado
      if (result.insertedIds && result.insertedIds.length > 0) {
        streamId = result.insertedIds[0];
      } else if (result.skipped > 0) {
        // Se foi skipped (já existe), buscar o stream existente pelo nome
        try {
          const existingStream = await this.xuiClient.findChannelByName(streamName, categoryId);
          if (existingStream) {
            streamId = existingStream.id;
            logger.info(`[DailyMatches] Stream já existe (ID: ${streamId}), será adicionado ao bouquet`);
          }
        } catch (error: any) {
          logger.warn(`[DailyMatches] Erro ao buscar stream existente: ${error.message}`);
        }
      }
      
      // 6. Adicionar ao bouquet (se tiver streamId)
      if (streamId && bouquetId) {
        try {
          await this.xuiClient.addChannelsToBouquet(bouquetId, [streamId]);
          logger.info(`[DailyMatches] ✅ Stream ${streamId} adicionado ao bouquet ${bouquetId}`);
        } catch (error: any) {
          logger.error(`[DailyMatches] ❌ ERRO ao adicionar stream ao bouquet ${bouquetId}: ${error.message}`);
          // Não retornar null, apenas logar o erro (stream foi criado)
        }
      } else if (!streamId) {
        logger.error(`[DailyMatches] ❌ Não foi possível obter streamId para adicionar ao bouquet`);
        return null;
      }
      
      return streamId ? { id: streamId } : null;
    } catch (error: any) {
      logger.error(`[DailyMatches] Erro ao criar stream: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Gera banners para jogos do dia
   */
  private async generateMatchBanners(): Promise<void> {
    try {
      // 🧹 LIMPAR BANNERS ANTIGOS ANTES DE GERAR NOVOS
      await this.cleanupOldBanners();
      
      const matches = await prisma.dailyMatch.findMany({
        where: {
          configId: this.config.id,
          matchDate: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
            lt: new Date(new Date().setHours(23, 59, 59, 999))
          },
          bannerPath: null  // Só gerar se não tem banner ainda
        },
        take: 20
      });
      
      if (matches.length === 0) {
        logger.info('[DailyMatches] Nenhum jogo sem banner para gerar');
        return;
      }
      
      logger.info(`[DailyMatches] Gerando banners para ${matches.length} jogos...`);
      
      // Converter DailyMatch para MatchData
      const matchData: MatchData[] = matches.map(match => {
        // Formatar hora do jogo
        const matchDate = new Date(match.matchDate);
        const matchTime = matchDate.toLocaleTimeString('pt-BR', { 
          hour: '2-digit', 
          minute: '2-digit',
          timeZone: 'America/Sao_Paulo'
        });
        
        // ✨ Extrair canais da API (JSON string)
        let apiChannelsList: string[] = [];
        if (match.apiChannels) {
          try {
            apiChannelsList = JSON.parse(match.apiChannels);
          } catch (e) {
            logger.warn(`[DailyMatches] Erro ao parsear apiChannels para jogo ${match.id}`);
          }
        }
        
        return {
          id: match.id,
          homeTeam: match.homeTeam,
          homeTeamLogo: match.homeTeamLogo || undefined,
          awayTeam: match.awayTeam,
          awayTeamLogo: match.awayTeamLogo || undefined,
          competition: match.leagueName || 'Campeonato',
          competitionLogo: match.leagueLogo || undefined,
          matchTime: matchTime,
          channel: match.mappedChannelName || undefined,  // Canal mapeado do XUI (mantido para compatibilidade)
          channels: apiChannelsList.length > 0 ? apiChannelsList : undefined  // ✨ NOVO: Canais da API do GE (onde passa na TV)
        };
      });
      
      // Gerar banners usando FootballBannerService
      const bannerPaths = await FootballBannerService.generateDailyMatchesBanner(matchData);
      
      logger.info(`[DailyMatches] ✅ ${bannerPaths.length} banner(s) gerado(s)`);
      
      // Normalizar caminhos dos banners para /storage/
      const normalizedBannerPaths: string[] = [];
      
      // Salvar caminho do banner nos jogos correspondentes
      // Dividir os jogos pelos banners (5 jogos por banner)
      const MATCHES_PER_BANNER = 5;
      for (let i = 0; i < bannerPaths.length; i++) {
        const startIdx = i * MATCHES_PER_BANNER;
        const endIdx = Math.min(startIdx + MATCHES_PER_BANNER, matches.length);
        const matchesInBanner = matches.slice(startIdx, endIdx);
        
        // Normalizar caminho: remover process.cwd() e garantir que comece com /storage/
        let bannerPath = bannerPaths[i].replace(process.cwd(), '').replace(/\\/g, '/');
        if (!bannerPath.startsWith('/')) {
          bannerPath = '/' + bannerPath;
        }
        if (!bannerPath.startsWith('/storage/')) {
          // Se não começar com /storage/, adicionar
          bannerPath = '/storage' + (bannerPath.startsWith('/') ? '' : '/') + bannerPath;
        }
        
        normalizedBannerPaths.push(bannerPath);
        
        // Atualizar todos os jogos deste banner com o mesmo caminho
        for (const match of matchesInBanner) {
          await prisma.dailyMatch.update({
            where: { id: match.id },
            data: { bannerPath: bannerPath }
          });
        }
        
        logger.info(`[DailyMatches] ✅ Banner ${i + 1}/${bannerPaths.length} salvo para ${matchesInBanner.length} jogo(s): ${bannerPath}`);
      }
      
    } catch (error: any) {
      logger.error(`[DailyMatches] ❌ Erro ao gerar banners: ${error.message}`);
      // Não lançar erro para não interromper o fluxo principal
    }
  }
  
  /**
   * Limpa banners antigos de jogos do dia (do banco e do disco)
   * Mantém apenas os banners mais recentes
   */
  private async cleanupOldBanners(): Promise<void> {
    try {
      logger.info('[DailyMatches] 🧹 Iniciando limpeza de banners antigos de jogos do dia...');
      
      // 1. Limpar bannerPath dos jogos no banco (antes de deletar arquivos)
      const updatedMatches = await prisma.dailyMatch.updateMany({
        where: {
          configId: this.config.id,
          bannerPath: {
            not: null,
          },
        },
        data: {
          bannerPath: null,
        },
      });
      
      logger.info(`[DailyMatches] 🧹 Limpados ${updatedMatches.count} registro(s) do banco`);
      
      // 2. Deletar TODOS os banners antigos do diretório (incluindo órfãos)
      const footballBannersDir = path.join(process.cwd(), 'storage', 'banners', 'football');
      let deletedFilesCount = 0;
      
      try {
        // Verificar se diretório existe
        await fs.access(footballBannersDir);
        
        // Listar todos os arquivos .jpeg no diretório
        const files = await fs.readdir(footballBannersDir);
        const jpegFiles = files.filter(f => f.toLowerCase().endsWith('.jpeg') || f.toLowerCase().endsWith('.jpg'));
        
        logger.info(`[DailyMatches] 🧹 Encontrados ${jpegFiles.length} arquivo(s) de banner no diretório`);
        
        // Deletar todos os arquivos .jpeg
        for (const file of jpegFiles) {
          try {
            const filePath = path.join(footballBannersDir, file);
            await fs.unlink(filePath);
            deletedFilesCount++;
            logger.info(`[DailyMatches] 🧹 Deletado arquivo do disco: ${file}`);
          } catch (fileError: any) {
            if (fileError.code !== 'ENOENT') {
              logger.warn(`[DailyMatches] ⚠️ Erro ao deletar arquivo ${file}: ${fileError.message}`);
            }
          }
        }
      } catch (dirError: any) {
        if (dirError.code === 'ENOENT') {
          logger.info('[DailyMatches] 🧹 Diretório de banners não existe ainda, nada para limpar');
        } else {
          logger.warn(`[DailyMatches] ⚠️ Erro ao acessar diretório de banners: ${dirError.message}`);
        }
      }
      
      logger.info(`[DailyMatches] 🧹 Limpeza concluída:`);
      logger.info(`   - Arquivos deletados do disco: ${deletedFilesCount}`);
      logger.info(`   - Registros atualizados no banco: ${updatedMatches.count}`);
      
    } catch (error: any) {
      logger.error(`[DailyMatches] ❌ Erro ao limpar banners antigos: ${error.message}`);
      // Não falhar o processo por causa da limpeza
    }
  }
  
  /**
   * Retorna jogos do dia formatados para o frontend
   */
  async getFormattedMatches(dateRange?: string): Promise<any[]> {
    // Calcular range de datas se especificado
    let dateFilter: any = {};
    if (dateRange) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      let startDate: Date;
      let endDate: Date;
      
      switch (dateRange) {
        case 'tomorrow':
          startDate = new Date(today);
          startDate.setDate(startDate.getDate() + 1);
          endDate = new Date(startDate);
          endDate.setHours(23, 59, 59, 999);
          break;
        case 'next3days':
          startDate = new Date(today);
          endDate = new Date(today);
          endDate.setDate(endDate.getDate() + 3);
          endDate.setHours(23, 59, 59, 999);
          break;
        case 'today':
        default:
          // ⚠️ CORREÇÃO: Todos os jogos do dia atual (00:00:00 até 23:59:59.999)
          // Incluir jogos que já aconteceram também
          startDate = new Date(today);
          startDate.setHours(0, 0, 0, 0); // 00:00:00
          endDate = new Date(today);
          endDate.setHours(23, 59, 59, 999); // 23:59:59.999
          break;
      }
      
      dateFilter = {
        gte: startDate,
        lte: endDate
      };
    } else {
      // Sem filtro de data, buscar todos os jogos do dia atual (00:00 até 23:59)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const endOfDay = new Date(today);
      endOfDay.setHours(23, 59, 59, 999);
      dateFilter = {
        gte: today,
        lte: endOfDay
      };
    }
    
    // ⚠️ CORREÇÃO: Buscar jogos por serverId através do config
    // Alguns jogos podem ter configId diferente, então vamos buscar todos os configs do servidor
    const allConfigs = await prisma.footballConfig.findMany({
      where: { serverId: this.serverId },
      select: { id: true }
    });
    
    const configIds = allConfigs.map(c => c.id);
    
    const matches = await prisma.dailyMatch.findMany({
      where: {
        configId: { in: configIds },
        matchDate: dateFilter
      },
      orderBy: { matchDate: 'asc' }
    });
    
    logger.info(`[DailyMatches] getFormattedMatches: ${matches.length} jogos encontrados para ${dateRange || 'all'} (configIds: ${configIds.join(', ')})`);
    
    return matches.map(m => ({
      id: m.id,
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      homeTeamLogo: m.homeTeamLogo,
      awayTeamLogo: m.awayTeamLogo,
      leagueId: m.leagueId,
      leagueName: m.leagueName,
      leagueLogo: m.leagueLogo,
      matchTime: m.matchTime,
      matchDate: m.matchDate.toISOString(),
      status: m.status,
      apiChannels: m.apiChannels,
      mappedChannelId: m.mappedChannelId,
      mappedChannelName: m.mappedChannelName,
      matchScore: m.matchScore,
      xuiStreamId: m.xuiStreamId,
      banner: m.bannerPath
    }));
  }
}
