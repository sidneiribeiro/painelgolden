import cron from 'node-cron';
import { prisma } from '../../config/database.js';
import { createLogger } from '../../utils/logger.js';
import TheSportsDBService from './thesportsdb.service.js';

const logger = createLogger('JogosDoDia');

export class JogosDoDiaService {
  private cronJob: cron.ScheduledTask | null = null;

  private cronJobDaily: cron.ScheduledTask | null = null;

  /**
   * Iniciar scheduler - executa 1x por dia às 5h da manhã
   * Busca TODOS os jogos do dia de uma vez só
   * 
   * ⚠️ IMPORTANTE: Roda às 5h para garantir que todos os jogos do dia
   * estejam disponíveis na API GE antes de começar o dia
   */
  startScheduler() {
    // Parar jobs antigos
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    if (this.cronJobDaily) {
      this.cronJobDaily.stop();
      this.cronJobDaily = null;
    }

    // ✅ ÚNICO CRON: Executar 1x por dia às 5h da manhã
    // A API GE retorna TODOS os jogos do dia (manhã, tarde e noite)
    this.cronJobDaily = cron.schedule('0 5 * * *', async () => {
      logger.info('[JogosDoDia] ⏰ Iniciando atualização diária (5h) - Buscando TODOS os jogos do dia...');
      try {
        await this.runManualUpdate();
        logger.info('[JogosDoDia] ✅ Atualização diária concluída com sucesso');
      } catch (error: any) {
        logger.error('[JogosDoDia] ❌ Erro na atualização diária:', error.message);
      }
    }, {
      timezone: 'America/Sao_Paulo',
    });
    
    logger.info('[JogosDoDia] ✅ Scheduler iniciado - Atualização diária às 05:00 (America/Sao_Paulo) - Busca TODOS os jogos do dia');
  }

  /**
   * Parar scheduler
   */
  stopScheduler() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    if (this.cronJobDaily) {
      this.cronJobDaily.stop();
      this.cronJobDaily = null;
    }
    logger.info('[JogosDoDia] Scheduler parado');
  }

  /**
   * Atualizar jogos do dia
   */
  async updateDailyGames(): Promise<void> {
    const config = await prisma.footballConfig.findFirst();
    if (!config) {
      logger.warn('Configuração de futebol não encontrada');
      return;
    }

    if (!config.autoUpdate) {
      logger.info('Atualização automática desabilitada');
      return;
    }

    logger.info(`[JogosDoDia] Config encontrada - API Key: ${config.apiKey ? 'SIM' : 'NÃO'}`);

    try {
      // 1. Buscar jogos da API-Football se API key estiver configurada
      if (config.apiKey && config.apiKey.trim()) {
        logger.info('[JogosDoDia] Iniciando busca na API-Football...');
        await this.fetchMatchesFromApi(config);
      } else {
        logger.info('[JogosDoDia] API Key não configurada, pulando busca na API');
      }

      // 2. Buscar jogos cadastrados (hoje e próximos 7 dias)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const nextWeek = new Date(today);
      nextWeek.setDate(nextWeek.getDate() + 7);
      
      logger.info(`[JogosDoDia] Buscando jogos entre ${today.toISOString()} e ${nextWeek.toISOString()}`);
      
      const matches = await prisma.dailyMatch.findMany({
        where: {
          date: {
            gte: today,
            lt: nextWeek,
          },
        },
        include: {
          channel: true,
        },
        orderBy: [
          { date: 'asc' },
          { matchTime: 'asc' },
        ],
      });

      logger.info(`[JogosDoDia] ${matches.length} jogos encontrados no banco para hoje`);
      
      if (matches.length > 0) {
        logger.info(`[JogosDoDia] Primeiros jogos: ${matches.slice(0, 3).map(m => `${m.homeTeam} vs ${m.awayTeam}`).join(', ')}`);
      }

      // 3. Limpar jogos antigos
      await this.clearOldMatches();

      // 4. Atualizar categoria no XUI
      if (config.xuiServerId && matches.length > 0) {
        await this.updateXUICategory(config, matches);
      }

      // 5. Gerar banners se configurado
      if (config.generateBanners) {
        await this.generateMatchBanners(matches);
      }

      logger.info('✅ Atualização concluída');
    } catch (error: any) {
      logger.error('Erro na atualização:', error.message);
      throw error;
    }
  }

  /**
   * Buscar jogos da API-Football e salvar no banco
   */
  private async fetchMatchesFromApi(config: any): Promise<void> {
    try {
      logger.info('[JogosDoDia] Buscando jogos da API-Football...');
      
      if (!config.apiKey || !config.apiKey.trim()) {
        logger.warn('[JogosDoDia] API Key vazia, não é possível buscar jogos');
        return;
      }

      // Usar TheSportsDB (gratuita, 30 req/min, inclui canais de TV)
      const apiKey = config.apiKey?.trim() || '123'; // Chave padrão gratuita
      
      logger.info('[JogosDoDia] Buscando jogos na TheSportsDB...');
      const theSportsDB = new TheSportsDBService(apiKey);
      // Buscar jogos para os próximos 30 dias (não apenas 7)
      const matchesData = await theSportsDB.getTodayMatches(30);
      
      logger.info(`[JogosDoDia] TheSportsDB retornou ${matchesData.length} eventos`);
      
      // Converter para formato interno
      const fixtures = matchesData.map(data => {
        const converted = theSportsDB.convertToInternalFormat(data);
        return {
          _converted: converted,
          fixture: {
            id: converted.externalId,
            date: converted.date.toISOString(),
          },
          teams: {
            home: {
              name: converted.homeTeam,
              logo: converted.homeTeamLogo,
            },
            away: {
              name: converted.awayTeam,
              logo: converted.awayTeamLogo,
            },
          },
          league: {
            name: converted.competition,
            logo: converted.competitionLogo,
          },
        };
      });
      
      logger.info(`[JogosDoDia] Total de ${fixtures.length} jogos processados da API`);

      if (fixtures.length === 0) {
        logger.warn('[JogosDoDia] ⚠️ Nenhum jogo encontrado na API para os próximos 30 dias');
        return;
      }

      logger.info(`[JogosDoDia] ✅ ${fixtures.length} jogos encontrados na API, iniciando validação e salvamento...`);

      let saved = 0;
      let skipped = 0;

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const maxDate = new Date(today);
      maxDate.setDate(maxDate.getDate() + 30); // Máximo 30 dias no futuro
      const currentYear = today.getFullYear();

      for (const fixture of fixtures) {
        // Variáveis para uso no catch
        let homeTeam = 'Unknown';
        let awayTeam = 'Unknown';
        let matchDate = new Date();
        
        try {
          // Usar dados convertidos do TheSportsDB
          if (!fixture._converted) {
            logger.warn('[JogosDoDia] Evento sem dados convertidos, pulando...');
            continue;
          }

          const converted = fixture._converted;
          matchDate = converted.date;
          const matchTime = converted.matchTime;
          homeTeam = converted.homeTeam;
          awayTeam = converted.awayTeam;
          const homeLogo = converted.homeTeamLogo;
          const awayLogo = converted.awayTeamLogo;
          const competition = converted.competition;
          const competitionLogo = converted.competitionLogo;
          const externalId = converted.externalId;
          const channels = converted.channels || [];

          // VALIDAÇÕES
          // 1. Validar data do jogo (não pode ser muito no futuro ou muito no passado)
          const matchDateOnly = new Date(matchDate);
          matchDateOnly.setHours(0, 0, 0, 0);
          
          if (matchDateOnly < today) {
            logger.debug(`[JogosDoDia] Jogo ${homeTeam} vs ${awayTeam} está no passado (${matchDateOnly.toISOString().split('T')[0]}), pulando...`);
            skipped++;
            continue;
          }
          
          if (matchDateOnly > maxDate) {
            logger.debug(`[JogosDoDia] Jogo ${homeTeam} vs ${awayTeam} está muito no futuro (${matchDateOnly.toISOString().split('T')[0]}), pulando...`);
            skipped++;
            continue;
          }

          // 2. Validar temporada (aceitar apenas temporada atual e próxima)
          // Se estamos em 2026, aceitar jogos de 2026 e 2027
          const eventYear = matchDate.getFullYear();
          if (eventYear < currentYear - 1 || eventYear > currentYear + 1) {
            logger.debug(`[JogosDoDia] Jogo ${homeTeam} vs ${awayTeam} tem temporada fora do range válido (${eventYear}, atual: ${currentYear}), pulando...`);
            skipped++;
            continue;
          }

          // 3. Validar times (não pode estar vazio)
          if (!homeTeam || !awayTeam || homeTeam.trim() === '' || awayTeam.trim() === '') {
            logger.warn(`[JogosDoDia] Jogo com times inválidos (${homeTeam} vs ${awayTeam}), pulando...`);
            skipped++;
            continue;
          }

          // Verificar se já existe (evitar duplicados)
          const existing = await prisma.dailyMatch.findFirst({
            where: {
              homeTeam: homeTeam,
              awayTeam: awayTeam,
              date: {
                gte: new Date(matchDate.getTime() - 60 * 60 * 1000), // 1 hora antes
                lte: new Date(matchDate.getTime() + 60 * 60 * 1000), // 1 hora depois
              },
            },
          });

          if (existing) {
            skipped++;
            continue;
          }

          // Buscar ou criar canal de futebol se houver canais
          let channelId: number | undefined;
          if (channels.length > 0) {
            // Tentar associar todos os canais disponíveis (usar o primeiro que encontrar ou criar)
            for (const channelName of channels) {
              if (!channelName || channelName.trim() === '') continue;
              
              logger.debug(`[JogosDoDia] Buscando canal: ${channelName} para jogo ${homeTeam} vs ${awayTeam}`);
              
              // Buscar canal existente ou criar novo
              let channel = await prisma.footballChannel.findFirst({
                where: {
                  name: channelName,
                  isActive: true,
                },
              });

              if (!channel && config.xuiServerId) {
                // Criar canal automaticamente (sem stream ID, será configurado depois)
                try {
                  channel = await prisma.footballChannel.create({
                    data: {
                      name: channelName,
                      xuiStreamId: 0, // Será configurado depois
                      xuiServerId: config.xuiServerId,
                      teams: JSON.stringify([homeTeam, awayTeam]),
                      competitions: JSON.stringify([competition]),
                      priority: 0,
                      isActive: true,
                    },
                  });
                  logger.info(`[JogosDoDia] ✅ Canal criado automaticamente: ${channelName} (ID: ${channel.id})`);
                } catch (error: any) {
                  // Se já existe (duplicado), buscar novamente
                  if (error.code === 'P2002') {
                    channel = await prisma.footballChannel.findFirst({
                      where: { name: channelName },
                    });
                    logger.debug(`[JogosDoDia] Canal ${channelName} já existe, usando existente`);
                  } else {
                    logger.warn(`[JogosDoDia] Erro ao criar canal ${channelName}:`, error.message);
                  }
                }
              }

              if (channel?.id) {
                channelId = channel.id;
                logger.info(`[JogosDoDia] ✅ Canal ${channelName} (ID: ${channelId}) associado ao jogo ${homeTeam} vs ${awayTeam}`);
                break; // Usar o primeiro canal encontrado/criado
              }
            }

            if (!channelId) {
              logger.warn(`[JogosDoDia] ⚠️ Nenhum canal pôde ser associado ao jogo ${homeTeam} vs ${awayTeam} (xuiServerId não configurado?)`);
            }
          } else {
            logger.warn(`[JogosDoDia] ⚠️ Nenhum canal encontrado na API para jogo ${homeTeam} vs ${awayTeam} - ${competition}`);
          }

          // Validar escudos (se vazios, tentar buscar depois ou deixar null)
          const finalHomeLogo = homeLogo && homeLogo.trim() !== '' ? homeLogo : null;
          const finalAwayLogo = awayLogo && awayLogo.trim() !== '' ? awayLogo : null;
          
          if (!finalHomeLogo || !finalAwayLogo) {
            logger.warn(`[JogosDoDia] Jogo ${homeTeam} vs ${awayTeam} sem escudos completos (home: ${!!finalHomeLogo}, away: ${!!finalAwayLogo})`);
          }

          // Salvar jogo
          logger.info(`[JogosDoDia] Salvando jogo: ${homeTeam} vs ${awayTeam} em ${matchDate.toISOString().split('T')[0]} ${matchTime}${channels.length > 0 ? ` (Canal: ${channels[0]})` : ' (sem canal)'}`);
          
          const created = await prisma.dailyMatch.create({
            data: {
              date: matchDate,
              homeTeam: homeTeam,
              homeTeamLogo: finalHomeLogo,
              awayTeam: awayTeam,
              awayTeamLogo: finalAwayLogo,
              competition: competition,
              competitionLogo: competitionLogo || null,
              matchTime,
              externalId: externalId,
              channelId: channelId,
            },
          });

          logger.info(`[JogosDoDia] ✅ Jogo salvo com ID: ${created.id} (Canal ID: ${channelId || 'N/A'})`);
          saved++;
        } catch (error: any) {
          logger.error(`[JogosDoDia] Erro ao salvar jogo ${homeTeam} vs ${awayTeam}:`, {
            message: error.message,
            stack: error.stack,
            fixture: {
              home: homeTeam,
              away: awayTeam,
              date: matchDate.toISOString(),
            },
          });
        }
      }

      logger.info(`[JogosDoDia] ✅ RESULTADO FINAL: ${saved} jogos salvos, ${skipped} jogos ignorados (duplicados/inválidos)`);
      
      if (saved === 0 && fixtures.length > 0) {
        logger.warn(`[JogosDoDia] ⚠️ ATENÇÃO: ${fixtures.length} jogos encontrados na API, mas NENHUM foi salvo! Verifique os logs acima para entender o motivo.`);
      }
    } catch (error: any) {
      logger.error('[JogosDoDia] Erro ao buscar jogos da API-Football:', {
        message: error.message,
        stack: error.stack,
        response: error.response?.data,
        status: error.response?.status,
      });
      // Não falhar a atualização se a API estiver fora
    }
  }

  /**
   * Atualizar categoria no XUI
   */
  private async updateXUICategory(config: any, matches: any[]): Promise<void> {
    // Obter IDs dos streams dos canais
    const streamIds = matches
      .filter(m => m.channel && m.channel.isActive)
      .map(m => m.channel.xuiStreamId);

    if (streamIds.length === 0) {
      logger.warn('Nenhum canal ativo encontrado para os jogos');
      return;
    }

    // TODO: Implementar integração com XUI
    // 1. Criar categoria se não existir
    // 2. Limpar streams da categoria
    // 3. Adicionar streams dos jogos

    logger.info(`${streamIds.length} canais serão adicionados à categoria "${config.categoryName}"`);
    
    // Marcar jogos como adicionados ao XUI
    await prisma.dailyMatch.updateMany({
      where: {
        id: { in: matches.map(m => m.id) }
      },
      data: {
        addedToXui: true,
      },
    });
  }

  private async generateMatchBanners(matches: any[]): Promise<void> {
    logger.info(`Gerando banners para ${matches.length} jogos...`);
    // TODO: Implementar geração de banners de jogos
    // Por enquanto apenas log
    for (const match of matches) {
      logger.debug(`Banner para: ${match.homeTeam} vs ${match.awayTeam}`);
    }
  }

  private async clearOldMatches(): Promise<void> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    
    const deleted = await prisma.dailyMatch.deleteMany({
      where: {
        matchDate: { lt: yesterday },
      },
    });

    if (deleted.count > 0) {
      logger.info(`${deleted.count} jogos antigos removidos`);
    }
  }

  /**
   * Executar atualização manualmente
   */
  async runManualUpdate(): Promise<void> {
    logger.info('Executando atualização manual...');
    
    // ⚠️ CORREÇÃO: Usar DailyMatchesService que tem implementação completa
    const config = await prisma.footballConfig.findFirst();
    if (!config) {
      logger.warn('Configuração de futebol não encontrada');
      return;
    }
    
    if (!config.serverId) {
      logger.warn('serverId não configurado na configuração de futebol');
      return;
    }
    
    try {
      const { DailyMatchesService } = await import('./daily-matches.service.js');
      const service = new DailyMatchesService(config.serverId);
      await service.initialize();
      
      // Usar o serviço completo que tem geração de banners implementada
      const result = await service.updateDailyMatches('today');
      logger.info(`[JogosDoDia] Atualização concluída: ${result.total} jogos, ${result.mapped} mapeados, ${result.created} streams criados`);
    } catch (error: any) {
      logger.error('[JogosDoDia] Erro na atualização manual:', error.message);
      throw error;
    }
  }
}

export default new JogosDoDiaService();

