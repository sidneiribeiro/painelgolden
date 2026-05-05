import axios from 'axios';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('ApiFutebolBR');

/**
 * API Futebol BR (api-futebol.com.br)
 * API brasileira com dados atualizados da temporada atual
 */

interface ApiFutebolBRFixture {
  partida_id: number;
  campeonato_id: number;
  campeonato: string;
  rodada: number;
  data: string; // "2026-01-04T16:00:00"
  hora: string; // "16:00"
  time_mandante: {
    time_id: number;
    nome_popular: string;
    sigla: string;
    escudo: string;
  };
  time_visitante: {
    time_id: number;
    nome_popular: string;
    sigla: string;
    escudo: string;
  };
  placar_mandante: number | null;
  placar_visitante: number | null;
  status: string; // "agendada", "ao_vivo", "finalizada"
  estadio: string;
  local: string;
}

interface ApiFutebolBRResponse {
  partidas: ApiFutebolBRFixture[];
}

export class ApiFutebolBRService {
  private apiKey: string;
  private baseUrl = 'https://api.api-futebol.com.br/v1';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    logger.info('[ApiFutebolBR] Service inicializado');
  }

  /**
   * Buscar jogos de hoje e próximos dias
   */
  async getTodayMatches(daysAhead: number = 7): Promise<ApiFutebolBRFixture[]> {
    const today = new Date();
    const todayStr = this.formatDate(today);
    
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + daysAhead);
    const endDateStr = this.formatDate(endDate);

    try {
      logger.info(`[ApiFutebolBR] Buscando jogos de ${todayStr} até ${endDateStr}`);
      
      // API Futebol BR usa endpoint de partidas por data
      const allMatches: ApiFutebolBRFixture[] = [];
      
      // Buscar por cada dia (API pode ter limite de requisições)
      for (let i = 0; i <= daysAhead; i++) {
        const currentDate = new Date(today);
        currentDate.setDate(currentDate.getDate() + i);
        const dateStr = this.formatDate(currentDate);
        
        try {
          const matches = await this.getFixturesByDate(dateStr);
          allMatches.push(...matches);
          
          // Rate limiting
          if (i < daysAhead) {
            await this.sleep(500);
          }
        } catch (error: any) {
          logger.warn(`[ApiFutebolBR] Erro ao buscar jogos de ${dateStr}:`, error.message);
        }
      }

      logger.info(`[ApiFutebolBR] Total de ${allMatches.length} jogos encontrados`);
      return allMatches;
    } catch (error: any) {
      logger.error('[ApiFutebolBR] Erro ao buscar jogos:', error.message);
      throw error;
    }
  }

  /**
   * Buscar jogos de uma data específica
   */
  private async getFixturesByDate(date: string): Promise<ApiFutebolBRFixture[]> {
    try {
      const response = await axios.get<ApiFutebolBRResponse>(
        `${this.baseUrl}/campeonatos/10/partidas/${date}`, // 10 = Brasileirão Série A
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );

      return response.data.partidas || [];
    } catch (error: any) {
      if (error.response?.status === 429) {
        logger.warn('[ApiFutebolBR] Rate limit atingido, aguardando...');
        await this.sleep(5000);
        return this.getFixturesByDate(date); // Retry
      }
      
      // Se não encontrar jogos, retornar array vazio (não é erro)
      if (error.response?.status === 404) {
        return [];
      }
      
      throw error;
    }
  }

  /**
   * Buscar jogos de múltiplos campeonatos
   */
  async getMatchesFromMultipleLeagues(daysAhead: number = 7): Promise<ApiFutebolBRFixture[]> {
    const today = new Date();
    const allMatches: ApiFutebolBRFixture[] = [];

    // IDs dos campeonatos que queremos buscar
    // Verificar na documentação da API os IDs corretos
    const championships = [
      10, // Brasileirão Série A
      11, // Brasileirão Série B
      2,  // Copa do Brasil
      13, // Libertadores
      14, // Sul-Americana
    ];

    for (const champId of championships) {
      try {
        const matches = await this.getFixturesByChampionship(champId, daysAhead);
        allMatches.push(...matches);
        await this.sleep(500);
      } catch (error: any) {
        logger.warn(`[ApiFutebolBR] Erro ao buscar campeonato ${champId}:`, error.message);
      }
    }

    return allMatches;
  }

  /**
   * Buscar jogos de um campeonato específico
   */
  private async getFixturesByChampionship(championshipId: number, daysAhead: number): Promise<ApiFutebolBRFixture[]> {
    const today = new Date();
    const allMatches: ApiFutebolBRFixture[] = [];

    for (let i = 0; i <= daysAhead; i++) {
      const currentDate = new Date(today);
      currentDate.setDate(currentDate.getDate() + i);
      const dateStr = this.formatDate(currentDate);

      try {
        const response = await axios.get<ApiFutebolBRResponse>(
          `${this.baseUrl}/campeonatos/${championshipId}/partidas/${dateStr}`,
          {
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 15000,
          }
        );

        if (response.data.partidas) {
          allMatches.push(...response.data.partidas);
        }

        await this.sleep(500);
      } catch (error: any) {
        if (error.response?.status === 404) {
          // Sem jogos nessa data, continuar
          continue;
        }
        logger.warn(`[ApiFutebolBR] Erro ao buscar ${championshipId} em ${dateStr}:`, error.message);
      }
    }

    return allMatches;
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
    if (!dateString) return '00:00';
    
    // Se já vem no formato HH:MM
    if (dateString.match(/^\d{2}:\d{2}$/)) {
      return dateString;
    }
    
    // Se vem como datetime ISO
    const date = new Date(dateString);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  /**
   * Converter formato da API Futebol BR para formato interno
   */
  convertToInternalFormat(fixture: ApiFutebolBRFixture): {
    date: Date;
    homeTeam: string;
    homeTeamLogo: string;
    awayTeam: string;
    awayTeamLogo: string;
    competition: string;
    matchTime: string;
    externalId: string;
  } {
    const matchDate = new Date(fixture.data);
    const matchTime = fixture.hora || this.extractTime(fixture.data);

    return {
      date: matchDate,
      homeTeam: fixture.time_mandante.nome_popular,
      homeTeamLogo: fixture.time_mandante.escudo,
      awayTeam: fixture.time_visitante.nome_popular,
      awayTeamLogo: fixture.time_visitante.escudo,
      competition: fixture.campeonato,
      matchTime,
      externalId: fixture.partida_id.toString(),
    };
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default ApiFutebolBRService;





