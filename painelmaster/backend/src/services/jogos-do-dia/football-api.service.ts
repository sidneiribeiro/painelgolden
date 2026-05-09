/**
 * Serviço de integração com API-Football (RapidAPI)
 * 
 * API-Football oferece:
 * - Free tier: 100 requests/dia
 * - Fixtures com times, horários, competição
 * - NÃO tem canais de TV nativamente
 * 
 * Para canais, usamos mapeamento manual por competição
 */

import axios from 'axios';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('FootballAPI');

// IDs das ligas no API-Football
export const LEAGUE_IDS = {
  // ========================================
  // BRASIL - NACIONAIS
  // ========================================
  BRASILEIRAO_A: 71,
  BRASILEIRAO_B: 72,
  COPA_DO_BRASIL: 73,
  
  // ========================================
  // BRASIL - ESTADUAIS (Região Sudeste)
  // ========================================
  PAULISTAO: 475,        // Campeonato Paulista Série A1
  CARIOCA: 476,          // Campeonato Carioca
  MINEIRO: 477,          // Campeonato Mineiro Módulo I
  CAPIXABA: 483,         // Campeonato Capixaba
  
  // ========================================
  // BRASIL - ESTADUAIS (Região Sul)
  // ========================================
  GAUCHO: 478,           // Campeonato Gaúcho
  PARANAENSE: 479,       // Campeonato Paranaense
  CATARINENSE: 480,      // Campeonato Catarinense
  
  // ========================================
  // BRASIL - ESTADUAIS (Região Nordeste)
  // ========================================
  BAIANO: 602,           // Campeonato Baiano
  PERNAMBUCANO: 603,     // Campeonato Pernambucano
  CEARENSE: 604,         // Campeonato Cearense
  GOIANO: 605,           // Campeonato Goiano
  SERGIPANO: 606,        // Campeonato Sergipano
  ALAGOANO: 607,        // Campeonato Alagoano
  PARAIBANO: 608,        // Campeonato Paraibano
  POTIGUAR: 609,         // Campeonato Potiguar (RN)
  MARANHENSE: 610,       // Campeonato Maranhense
  PIAUIENSE: 611,        // Campeonato Piauiense
  
  // ========================================
  // BRASIL - ESTADUAIS (Região Centro-Oeste)
  // ========================================
  BRASILIENSE: 612,      // Campeonato Brasiliense
  MATO_GROSSENSE: 613,   // Campeonato Mato-Grossense
  SUL_MATO_GROSSENSE: 614, // Campeonato Sul-Mato-Grossense
  
  // ========================================
  // BRASIL - ESTADUAIS (Região Norte)
  // ========================================
  PARAENSE: 615,         // Campeonato Paraense
  AMAZONENSE: 616,       // Campeonato Amazonense
  ACREANO: 617,          // Campeonato Acreano
  RONDONIENSE: 618,      // Campeonato Rondoniense
  RORAIMENSE: 619,       // Campeonato Roraimense
  AMAPAENSE: 620,        // Campeonato Amapaense
  TOCANTINENSE: 621,     // Campeonato Tocantinense
  
  // ========================================
  // BRASIL - CATEGORIAS DE BASE
  // ========================================
  COPINHA: 1353,         // Copa São Paulo de Futebol Júnior U20
  BRASILEIRO_U20: 1352,  // Campeonato Brasileiro U20
  BRASILEIRO_U17: 1354,  // Campeonato Brasileiro U17
  
  // ========================================
  // BRASIL - COMPETIÇÕES REGIONAIS
  // ========================================
  COPA_NORDESTE: 594,    // Copa do Nordeste
  COPA_VERDE: 624,       // Copa Verde
  COPA_PAULISTA: 625,    // Copa Paulista
  
  // ========================================
  // CONMEBOL
  // ========================================
  LIBERTADORES: 13,
  SULAMERICANA: 11,
  
  // ========================================
  // UEFA
  // ========================================
  CHAMPIONS_LEAGUE: 2,
  EUROPA_LEAGUE: 3,
  CONFERENCE_LEAGUE: 848,
  
  // ========================================
  // EUROPA - TOP 5 LIGAS
  // ========================================
  PREMIER_LEAGUE: 39,
  LA_LIGA: 140,
  SERIE_A: 135,
  BUNDESLIGA: 78,
  LIGUE_1: 61,
  
  // ========================================
  // SELEÇÕES
  // ========================================
  COPA_DO_MUNDO: 1,
  COPA_AMERICA: 9,
  ELIMINATORIAS_CONMEBOL: 29,
};

// Mapeamento de canais por competição
export const CHANNEL_MAPPING: Record<number, string[]> = {
  // ========================================
  // BRASIL - NACIONAIS
  // ========================================
  [LEAGUE_IDS.BRASILEIRAO_A]: ['Premiere', 'Globo', 'SporTV', 'Globoplay'],
  [LEAGUE_IDS.BRASILEIRAO_B]: ['Premiere', 'SporTV', 'Band', 'Globoplay'],
  [LEAGUE_IDS.COPA_DO_BRASIL]: ['Globo', 'SporTV', 'Premiere', 'Prime Video', 'Globoplay'],
  
  // ========================================
  // BRASIL - ESTADUAIS (Região Sudeste)
  // ========================================
  [LEAGUE_IDS.PAULISTAO]: ['Record', 'Globo', 'CazéTV', 'Paulistão Play', 'YouTube'],
  [LEAGUE_IDS.CARIOCA]: ['Band', 'SporTV', 'Record', 'Globo', 'Cariocão Play'],
  [LEAGUE_IDS.MINEIRO]: ['Globo', 'SporTV', 'Premiere'],
  [LEAGUE_IDS.CAPIXABA]: ['TV Gazeta', 'SporTV', 'Globo'],
  
  // ========================================
  // BRASIL - ESTADUAIS (Região Sul)
  // ========================================
  [LEAGUE_IDS.GAUCHO]: ['Premiere', 'RBS TV', 'SporTV', 'Globo'],
  [LEAGUE_IDS.PARANAENSE]: ['RPC', 'Globo', 'NSports', 'DAZN'],
  [LEAGUE_IDS.CATARINENSE]: ['NSC TV', 'SporTV', 'Globo'],
  
  // ========================================
  // BRASIL - ESTADUAIS (Região Nordeste)
  // ========================================
  [LEAGUE_IDS.BAIANO]: ['TVE Bahia', 'Globo', 'SporTV'],
  [LEAGUE_IDS.PERNAMBUCANO]: ['Globo', 'SporTV', 'TV Jornal'],
  [LEAGUE_IDS.CEARENSE]: ['Globo', 'SporTV', 'FCF TV'],
  [LEAGUE_IDS.GOIANO]: ['Globo', 'TV Anhanguera', 'SporTV'],
  [LEAGUE_IDS.SERGIPANO]: ['TV Sergipe', 'Globo', 'SporTV'],
  [LEAGUE_IDS.ALAGOANO]: ['TV Gazeta Alagoas', 'Globo', 'SporTV'],
  [LEAGUE_IDS.PARAIBANO]: ['TV Paraíba', 'Globo', 'SporTV'],
  [LEAGUE_IDS.POTIGUAR]: ['TV Tropical', 'Globo', 'SporTV'],
  [LEAGUE_IDS.MARANHENSE]: ['TV Mirante', 'Globo', 'SporTV'],
  [LEAGUE_IDS.PIAUIENSE]: ['TV Clube', 'Globo', 'SporTV'],
  
  // ========================================
  // BRASIL - ESTADUAIS (Região Centro-Oeste)
  // ========================================
  [LEAGUE_IDS.BRASILIENSE]: ['TV Brasília', 'Globo', 'SporTV'],
  [LEAGUE_IDS.MATO_GROSSENSE]: ['TV Centro América', 'Globo', 'SporTV'],
  [LEAGUE_IDS.SUL_MATO_GROSSENSE]: ['TV Morena', 'Globo', 'SporTV'],
  
  // ========================================
  // BRASIL - ESTADUAIS (Região Norte)
  // ========================================
  [LEAGUE_IDS.PARAENSE]: ['TV Liberal', 'Globo', 'SporTV'],
  [LEAGUE_IDS.AMAZONENSE]: ['TV A Crítica', 'Globo', 'SporTV'],
  [LEAGUE_IDS.ACREANO]: ['TV Gazeta', 'Globo', 'SporTV'],
  [LEAGUE_IDS.RONDONIENSE]: ['TV Rondônia', 'Globo', 'SporTV'],
  [LEAGUE_IDS.RORAIMENSE]: ['TV Roraima', 'Globo', 'SporTV'],
  [LEAGUE_IDS.AMAPAENSE]: ['TV Amapá', 'Globo', 'SporTV'],
  [LEAGUE_IDS.TOCANTINENSE]: ['TV Anhanguera', 'Globo', 'SporTV'],
  
  // ========================================
  // BRASIL - CATEGORIAS DE BASE
  // ========================================
  [LEAGUE_IDS.COPINHA]: ['SporTV', 'SporTV 2', 'SporTV 3', 'CazéTV', 'Record', 'Record News', 'Paulistão Play', 'YouTube'],
  [LEAGUE_IDS.BRASILEIRO_U20]: ['SporTV', 'SporTV 2', 'Eleven Sports'],
  [LEAGUE_IDS.BRASILEIRO_U17]: ['SporTV', 'SporTV 2', 'Eleven Sports'],
  
  // ========================================
  // BRASIL - COMPETIÇÕES REGIONAIS
  // ========================================
  [LEAGUE_IDS.COPA_NORDESTE]: ['ESPN', 'SBT', 'SBT Nordeste', 'Nordeste FC'],
  [LEAGUE_IDS.COPA_VERDE]: ['TV Brasil', 'SporTV'],
  [LEAGUE_IDS.COPA_PAULISTA]: ['Paulistão Play', 'Eleven Sports'],
  
  // ========================================
  // CONMEBOL
  // ========================================
  [LEAGUE_IDS.LIBERTADORES]: ['Globo', 'ESPN', 'SBT', 'Paramount+', 'Star+', 'Globoplay'],
  [LEAGUE_IDS.SULAMERICANA]: ['ESPN', 'SBT', 'Paramount+', 'Star+'],
  
  // ========================================
  // UEFA
  // ========================================
  [LEAGUE_IDS.CHAMPIONS_LEAGUE]: ['TNT Sports', 'SBT', 'Max', 'Space'],
  [LEAGUE_IDS.EUROPA_LEAGUE]: ['ESPN', 'Star+'],
  [LEAGUE_IDS.CONFERENCE_LEAGUE]: ['ESPN', 'Star+'],
  
  // ========================================
  // EUROPA - TOP 5 LIGAS
  // ========================================
  [LEAGUE_IDS.PREMIER_LEAGUE]: ['ESPN', 'ESPN 2', 'ESPN 4', 'Star+', 'Disney+'],
  [LEAGUE_IDS.LA_LIGA]: ['ESPN', 'Star+', 'Disney+'],
  [LEAGUE_IDS.SERIE_A]: ['ESPN', 'Star+', 'Disney+'],
  [LEAGUE_IDS.BUNDESLIGA]: ['SporTV', 'CazéTV', 'Globoplay', 'OneFootball', 'YouTube'],
  [LEAGUE_IDS.LIGUE_1]: ['CazéTV', 'YouTube', 'OneFootball'],
};

export interface Match {
  id: number;
  homeTeam: string;
  awayTeam: string;
  homeTeamLogo: string;
  awayTeamLogo: string;
  leagueId: number;
  leagueName: string;
  leagueLogo: string;
  date: string;
  time: string;
  status: string;
  channels: string[];  // Canais mapeados pela competição
}

export class FootballApiService {
  private apiKey: string;
  private baseUrl = 'https://v3.football.api-sports.io';
  
  constructor(apiKey?: string) {
    // API-Football via RapidAPI ou direto
    this.apiKey = apiKey || process.env.RAPIDAPI_KEY || process.env.API_FOOTBALL_KEY || '';
  }
  
  /**
   * Busca jogos do dia (método legado - mantido para compatibilidade)
   */
  async getTodayMatches(leagueIds?: number[]): Promise<Match[]> {
    return this.getMatchesByDateRange(leagueIds, 'today');
  }

  /**
   * Busca jogos por range de datas
   */
  async getMatchesByDateRange(leagueIds?: number[], dateRange: string = 'today'): Promise<Match[]> {
    if (!this.apiKey) {
      logger.warn('[FootballAPI] API key não configurada para API-Football');
      return [];
    }

    const leagues = leagueIds && leagueIds.length > 0 
      ? leagueIds 
      : Object.values(LEAGUE_IDS);
    
    if (leagues.length === 0) {
      logger.warn('[FootballAPI] Nenhuma liga especificada');
      return [];
    }
    
    // Calcular datas baseado no range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let startDate: Date;
    let endDate: Date;
    
    switch (dateRange) {
      case 'tomorrow':
        startDate = new Date(today);
        startDate.setDate(startDate.getDate() + 1);
        endDate = new Date(startDate);
        break;
      case 'next3days':
        startDate = new Date(today);
        endDate = new Date(today);
        endDate.setDate(endDate.getDate() + 3);
        break;
      case 'today':
      default:
        startDate = new Date(today);
        endDate = new Date(today);
        break;
    }
    
    const matches: Match[] = [];
    const datesToFetch: string[] = [];
    
    // Gerar lista de datas para buscar
    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      datesToFetch.push(currentDate.toISOString().split('T')[0]);
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    logger.info(`[FootballAPI] Buscando jogos de ${leagues.length} liga(s) para ${datesToFetch.length} dia(s): ${datesToFetch.join(', ')}`);
    
    // Limitar número de requisições para evitar timeout muito longo
    if (leagues.length * datesToFetch.length > 100) {
      logger.warn(`[FootballAPI] Muitas requisições serão feitas (${leagues.length * datesToFetch.length}). O processo pode levar vários minutos.`);
    }
    
    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];
    
    // Buscar para cada combinação de liga e data
    for (const leagueId of leagues) {
      for (const dateStr of datesToFetch) {
        try {
          // Preparar parâmetros
          const params: any = {
            league: leagueId,
            date: dateStr,
            timezone: 'America/Sao_Paulo'
          };
          
          // Para Copinha e competições de base, tentar adicionar season apenas se necessário
          // NOTA: Plano gratuito tem acesso limitado a temporadas 2022-2024
          // Se a API retornar erro pedindo season, tentaremos com ano atual
          // Mas primeiro tentamos sem season para ver se funciona
          // O season será adicionado apenas se a API retornar erro pedindo
          
          const response = await axios.get(`${this.baseUrl}/fixtures`, {
            headers: {
              'x-rapidapi-key': this.apiKey,
              'x-rapidapi-host': 'v3.football.api-sports.io'
            },
            params: params,
            timeout: 30000  // Aumentar timeout para 30 segundos
          });
          
          const fixtures = response.data.response || [];
          logger.debug(`[FootballAPI] Liga ${leagueId} (${dateStr}): ${fixtures.length} jogos encontrados`);
          
          successCount++;
          
          for (const fixture of fixtures) {
            matches.push({
              id: fixture.fixture.id,
              homeTeam: fixture.teams.home.name,
              awayTeam: fixture.teams.away.name,
              homeTeamLogo: fixture.teams.home.logo,
              awayTeamLogo: fixture.teams.away.logo,
              leagueId: fixture.league.id,
              leagueName: fixture.league.name,
              leagueLogo: fixture.league.logo,
              date: fixture.fixture.date,
              time: new Date(fixture.fixture.date).toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'America/Sao_Paulo'
              }),
              status: fixture.fixture.status.short,
              // Canais mapeados pela competição
              channels: CHANNEL_MAPPING[leagueId] || []
            });
          }
          
          // Rate limit: 10 req/min no free tier - aguardar 6 segundos entre requisições
          await new Promise(r => setTimeout(r, 6000));
          
        } catch (error: any) {
          // Continuar mesmo se uma liga falhar - não interromper todo o processo
          if (error.response) {
            const status = error.response.status;
            const errorMsg = error.response.data?.message || error.message;
            
            if (status === 429) {
              logger.warn(`[FootballAPI] Rate limit atingido para liga ${leagueId} (${dateStr}), aguardando 60 segundos...`);
              await new Promise(r => setTimeout(r, 60000));
              // Tentar novamente após aguardar
              continue;
            } else if (status === 403 || (error.response?.data?.errors?.requests && error.response.data.errors.requests.includes('request limit'))) {
              // Limite diário atingido
              const errorMsg = error.response?.data?.errors?.requests || 'Limite de requisições diárias atingido';
              logger.error(`[FootballAPI] ❌ LIMITE DIÁRIO ATINGIDO: ${errorMsg}`);
              logger.error(`[FootballAPI] A API key atingiu o limite de requisições do plano. Upgrade necessário ou aguarde reset diário.`);
              errorCount++;
              errors.push(`Limite diário atingido - ${errorMsg}`);
              // Não continuar - todas as próximas requisições falharão
              break;
            } else if (status === 404) {
              // Liga não encontrada ou sem jogos - não é erro crítico
              logger.debug(`[FootballAPI] Liga ${leagueId} (${dateStr}): Sem jogos ou liga não encontrada`);
            } else if (status === 400 || status === 401 || status === 403) {
              // Erro de autenticação ou requisição inválida - logar mas continuar
              logger.warn(`[FootballAPI] Erro ${status} ao buscar liga ${leagueId} (${dateStr}): ${errorMsg}`);
              errorCount++;
              errors.push(`Liga ${leagueId}: Erro ${status}`);
            } else {
              // Outros erros HTTP
              logger.error(`[FootballAPI] Erro ${status} ao buscar liga ${leagueId} (${dateStr}): ${errorMsg}`);
              errorCount++;
              errors.push(`Liga ${leagueId}: Erro ${status}`);
            }
          } else if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
            logger.warn(`[FootballAPI] Timeout ao buscar liga ${leagueId} (${dateStr}), continuando...`);
            errorCount++;
            errors.push(`Liga ${leagueId}: Timeout`);
          } else {
            logger.error(`[FootballAPI] Erro ao buscar liga ${leagueId} (${dateStr}): ${error.message}`);
            errorCount++;
            errors.push(`Liga ${leagueId}: ${error.message}`);
          }
          // Continuar para próxima liga mesmo se houver erro
        }
      }
    }
    
    logger.info(`[FootballAPI] Total de ${matches.length} jogos encontrados (${successCount} requisições bem-sucedidas, ${errorCount} erros)`);
    
    if (errorCount > 0 && errors.length > 0) {
      logger.warn(`[FootballAPI] Algumas ligas falharam. Primeiros erros: ${errors.slice(0, 5).join(', ')}`);
    }
    
    // Ordenar por horário
    return matches.sort((a, b) => 
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );
  }
}

