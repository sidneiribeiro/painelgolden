import axios from 'axios';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('ApiFootball');

interface ApiFootballFixture {
  fixture: {
    id: number;
    date: string;
    timezone: string;
    venue: {
      id: number;
      name: string;
      city: string;
    };
    status: {
      long: string;
      short: string;
    };
  };
  league: {
    id: number;
    name: string;
    country: string;
    logo: string;
    flag: string;
    season: number;
  };
  teams: {
    home: {
      id: number;
      name: string;
      logo: string;
    };
    away: {
      id: number;
      name: string;
      logo: string;
    };
  };
  goals: {
    home: number | null;
    away: number | null;
  };
}

interface ApiFootballResponse {
  get: string;
  parameters: any;
  errors: any[];
  results: number;
  paging: {
    current: number;
    total: number;
  };
  response: ApiFootballFixture[];
}

/**
 * IDs das competições que queremos buscar
 * Baseado em: https://www.api-football.com/documentation-v3
 * 
 * NOTA: Os IDs podem variar, verificar na documentação oficial
 */
export const COMPETITION_IDS = {
  // Brasileiros
  BRASILEIRAO_A: 71, // Campeonato Brasileiro Série A
  BRASILEIRAO_B: 72, // Campeonato Brasileiro Série B
  COPA_DO_BRASIL: 2, // Copa do Brasil
  
  // Sul-Americanos
  LIBERTADORES: 13, // Copa Libertadores
  SUL_AMERICANA: 15, // Copa Sul-Americana
  
  // Internacionais
  COPA_DO_MUNDO: 1, // Copa do Mundo FIFA
  LIGA_DOS_CAMPEOES: 2, // UEFA Champions League
};

/**
 * Lista de IDs de competições para buscar
 */
export const COMPETITIONS_TO_FETCH = [
  COMPETITION_IDS.BRASILEIRAO_A,
  COMPETITION_IDS.BRASILEIRAO_B,
  COMPETITION_IDS.COPA_DO_BRASIL,
  COMPETITION_IDS.LIBERTADORES,
  COMPETITION_IDS.SUL_AMERICANA,
  COMPETITION_IDS.COPA_DO_MUNDO,
  COMPETITION_IDS.LIGA_DOS_CAMPEOES,
];

export class ApiFootballService {
  private apiKey: string;
  private baseUrl = 'https://v3.football.api-sports.io';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Buscar jogos de hoje e próximos dias
   */
  async getTodayMatches(competitionIds: number[] = []): Promise<ApiFootballFixture[]> {
    const today = new Date();
    
    // Se estamos em 2025+, buscar jogos de datas passadas da temporada 2024 também
    // para ter dados para exibir
    let startDate = new Date(today);
    if (today.getFullYear() >= 2025) {
      // Buscar desde o início de 2024 até 7 dias à frente
      startDate = new Date('2024-01-01');
    }
    
    const startDateStr = this.formatDate(startDate);
    
    // Buscar jogos até 7 dias à frente de hoje
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + 7);
    const endDateStr = this.formatDate(endDate);

    try {
      const allMatches: ApiFootballFixture[] = [];
      
      // Se não especificou competições, usar todas as que queremos
      const competitions = competitionIds.length > 0 
        ? competitionIds 
        : COMPETITIONS_TO_FETCH;

      logger.info(`Buscando jogos de ${competitions.length} competições...`);

      // Buscar por competição (API tem limite de requisições)
      for (const leagueId of competitions) {
        try {
          const matches = await this.getFixturesByLeague(leagueId, startDateStr, endDateStr);
          allMatches.push(...matches);
          
          // Rate limiting - aguardar 1 segundo entre requisições
          await this.sleep(1000);
        } catch (error: any) {
          logger.warn(`Erro ao buscar jogos da competição ${leagueId}:`, error.message);
        }
      }

      logger.info(`${allMatches.length} jogos encontrados`);
      return allMatches;
    } catch (error: any) {
      logger.error('Erro ao buscar jogos:', error.message);
      throw error;
    }
  }

  /**
   * Buscar jogos de uma liga específica
   */
  private async getFixturesByLeague(
    leagueId: number,
    from: string,
    to: string
  ): Promise<ApiFootballFixture[]> {
    try {
      // Plano gratuito permite temporadas 2022-2024
      const currentYear = new Date().getFullYear();
      const season = currentYear >= 2025 ? 2024 : currentYear;
      
      const response = await axios.get<ApiFootballResponse>(
        `${this.baseUrl}/fixtures`,
        {
          params: {
            league: leagueId,
            season: season,
            from,
            to,
            timezone: 'America/Sao_Paulo',
          },
          headers: {
            'x-apisports-key': this.apiKey,
          },
          timeout: 10000,
        }
      );

      if (response.data.errors && response.data.errors.length > 0) {
        logger.warn(`Erros da API para liga ${leagueId}:`, response.data.errors);
        return [];
      }

      return response.data.response || [];
    } catch (error: any) {
      if (error.response?.status === 429) {
        logger.warn('Rate limit atingido, aguardando...');
        await this.sleep(5000);
        return this.getFixturesByLeague(leagueId, from, to); // Retry
      }
      throw error;
    }
  }

  /**
   * Buscar jogos de hoje especificamente
   */
  async getTodayFixtures(competitionIds: number[] = []): Promise<ApiFootballFixture[]> {
    const today = new Date();
    const todayStr = this.formatDate(today);

    try {
      const allMatches: ApiFootballFixture[] = [];
      const competitions = competitionIds.length > 0 
        ? competitionIds 
        : COMPETITIONS_TO_FETCH;

      logger.info(`[ApiFootball] Buscando jogos de ${competitions.length} competições para ${todayStr}`);
      
      for (const leagueId of competitions) {
        try {
          logger.debug(`[ApiFootball] Buscando competição ${leagueId}...`);
          // Plano gratuito permite temporadas 2022-2024
          // Usar 2024 como padrão (mais recente disponível)
          // Se estiver em 2025+, usar 2024
          const currentYear = new Date().getFullYear();
          const season = currentYear >= 2025 ? 2024 : currentYear;
          
          const response = await axios.get<ApiFootballResponse>(
            `${this.baseUrl}/fixtures`,
            {
              params: {
                league: leagueId,
                season: season,
                date: todayStr,
                timezone: 'America/Sao_Paulo',
              },
              headers: {
                'x-apisports-key': this.apiKey,
              },
              timeout: 15000,
            }
          );

          if (response.data.errors && Object.keys(response.data.errors).length > 0) {
            logger.warn(`[ApiFootball] Erros da API para liga ${leagueId}:`, JSON.stringify(response.data.errors));
            // Continuar mesmo com erros, pode ser apenas aviso
          }

          if (response.data.response && response.data.response.length > 0) {
            logger.info(`[ApiFootball] ${response.data.response.length} jogos encontrados na competição ${leagueId}`);
            allMatches.push(...response.data.response);
          } else {
            logger.debug(`[ApiFootball] Nenhum jogo encontrado para competição ${leagueId} em ${todayStr}`);
          }

          await this.sleep(1000);
        } catch (error: any) {
          if (error.response?.status === 429) {
            logger.warn(`[ApiFootball] Rate limit atingido para competição ${leagueId}, aguardando...`);
            await this.sleep(5000);
          } else {
            logger.warn(`[ApiFootball] Erro ao buscar jogos da competição ${leagueId}:`, {
              message: error.message,
              status: error.response?.status,
              statusText: error.response?.statusText,
              data: error.response?.data,
              url: error.config?.url,
            });
          }
        }
      }

      logger.info(`[ApiFootball] Total de ${allMatches.length} jogos encontrados`);

      return allMatches;
    } catch (error: any) {
      logger.error('Erro ao buscar jogos de hoje:', error.message);
      throw error;
    }
  }

  /**
   * Formatar data para API (YYYY-MM-DD)
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Extrair hora do datetime
   */
  extractTime(dateString: string): string {
    const date = new Date(dateString);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default ApiFootballService;

