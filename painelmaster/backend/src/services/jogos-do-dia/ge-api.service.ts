/**
 * ⚽ GE API Service (Globo Esporte)
 * 
 * API oficial do GE que retorna jogos do dia com informações de canais brasileiros
 * Endpoint GraphQL: https://geql.globo.com/graphql
 * 
 * VANTAGENS sobre TheSportsDB:
 * - ✅ Sempre tem informação de canais de transmissão brasileiros
 * - ✅ Focada no Brasil (estaduais, nacionais, CONMEBOL)
 * - ✅ Dados atualizados em tempo real
 * - ✅ Gratuita e sem autenticação
 */

import axios from 'axios';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('GE-API');

/**
 * Estrutura REAL da resposta da API do GE (GraphQL)
 */
interface GETeam {
  __typename: string;
  id: number;
  popularName: string;
  name: string;
  badgeSvg?: string;
  badgePng?: string;
}

interface GELiveWatchSource {
  name: string;
  description: string;
  url?: string;
  officialLogoUrl?: string;
  highlightLogoUrl?: string;
  transmissionId: number;
  __typename: string;
}

interface GEMatch {
  __typename: string;
  id: number;
  startDate: string; // "2026-01-08"
  startHour: string; // "20:30:00"
  round?: number;
  moment: string; // "NOW", "FUTURE", "PAST"
  scoreboard?: {
    home: number | null;
    away: number | null;
    penalty: any | null;
    __typename: string;
  };
  firstContestant: GETeam; // Time da casa
  secondContestant: GETeam; // Time visitante
  result: any | null;
  phase: {
    name: string;
    championshipEdition: {
      championship: {
        name: string;
        __typename: string;
      };
      __typename: string;
    };
    __typename: string;
  };
  liveWatchSources: GELiveWatchSource[] | null; // Canais de transmissão
  transmission: any | null;
  location?: {
    popularName: string;
    __typename: string;
  };
  __typename: string;
}

interface GESoccerEvent {
  __typename: string;
  match: GEMatch;
  editorialData?: any;
}

interface GEChampionshipAgenda {
  championship: {
    name: string;
    url: string;
    __typename: string;
  };
  now: GESoccerEvent[]; // Jogos acontecendo agora
  future: GESoccerEvent[]; // Jogos futuros (API retorna 'future', não 'upcoming')
  past: GESoccerEvent[]; // Jogos já encerrados (API retorna 'past', não 'finished')
  __typename?: string;
}

interface GEApiResponse {
  data?: {
    championshipsAgenda?: GEChampionshipAgenda[];
    [key: string]: any;
  };
  errors?: Array<{ message: string; path?: string[] }>;
  extensions?: any;
}

/**
 * Formato interno padronizado (compatível com TheSportsDB)
 */
export interface StandardizedMatch {
  id: number;
  homeTeam: string;
  awayTeam: string;
  homeTeamLogo: string;
  awayTeamLogo: string;
  leagueId: number;
  leagueName: string;
  leagueLogo: string;
  date: string; // ISO 8601
  time: string; // HH:MM em horário de Brasília
  status: 'NS' | 'LIVE' | 'FT' | 'CANC'; // NS=Not Started, FT=Full Time
  channels: string[]; // ["Premiere", "SporTV", etc.]
  venue?: string;
}

export class GEApiService {
  private readonly API_URL = 'https://geql.globo.com/graphql';
  private readonly PERSISTED_QUERY_HASH = 'c1b3f92ec73ae582e54ed74125a92b9fa8310083ca25d37fa89801d8833e8e8c';
  
  constructor() {
    logger.info('[GE-API] Service inicializado');
  }

  /**
   * Converte horário UTC para horário de Brasília
   */
  private convertToBrazilTime(isoDate: string): string {
    try {
      const date = new Date(isoDate);
      return date.toLocaleTimeString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    } catch (error) {
      logger.error(`[GE-API] Erro ao converter timezone: ${isoDate}`, error);
      return '00:00';
    }
  }

  /**
   * Converte status da API GE para formato padronizado
   * GE usa: "NOW", "FUTURE", "PAST"
   */
  private convertStatus(geStatus: string): 'NS' | 'LIVE' | 'FT' | 'CANC' {
    switch (geStatus?.toUpperCase()) {
      case 'NOW':
      case 'LIVE':
      case 'AO_VIVO':
      case 'EM_ANDAMENTO':
        return 'LIVE';
      case 'FUTURE':
      case 'SCHEDULED':
      case 'AGENDADO':
        return 'NS';
      case 'PAST':
      case 'FINISHED':
      case 'ENCERRADO':
      case 'FINALIZADO':
        return 'FT';
      case 'CANCELLED':
      case 'CANCELADO':
        return 'CANC';
      default:
        return 'NS';
    }
  }

  /**
   * Busca jogos do dia na API do GE
   * @param date Data no formato YYYY-MM-DD (opcional, padrão = hoje)
   */
  async getTodayMatches(date?: string): Promise<StandardizedMatch[]> {
    try {
      // Se não especificou data, usar hoje (SEMPRE enviar data válida, nunca vazio)
      const targetDate = date || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      
      logger.info(`[GE-API] Buscando jogos do dia: ${targetDate}`);

      // ⚠️ IMPORTANTE: A API do GE NÃO aceita date vazio, sempre enviar YYYY-MM-DD
      const variables = JSON.stringify({ date: targetDate });
      const extensions = JSON.stringify({
        persistedQuery: {
          version: 1,
          sha256Hash: this.PERSISTED_QUERY_HASH,
        },
      });

      const url = `${this.API_URL}?variables=${encodeURIComponent(variables)}&extensions=${encodeURIComponent(extensions)}`;

      // Fazer requisição com headers necessários
      const response = await axios.get<GEApiResponse>(url, {
        headers: {
          'accept': '*/*',
          'content-type': 'application/json',
          'origin': 'https://ge.globo.com',
          'referer': 'https://ge.globo.com/',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        timeout: 15000,
      });

      // Verificar erros da API
      if (response.data.errors && response.data.errors.length > 0) {
        const errorMsg = response.data.errors.map(e => e.message).join(', ');
        throw new Error(`GE API retornou erro: ${errorMsg}`);
      }

      // Extrair jogos da resposta (estrutura real: championshipsAgenda)
      const championshipsAgenda = response.data?.data?.championshipsAgenda;
      
      if (!championshipsAgenda || !Array.isArray(championshipsAgenda) || championshipsAgenda.length === 0) {
        logger.warn(`[GE-API] Nenhuma agenda de campeonato encontrada para ${targetDate}`);
        return [];
      }

      logger.info(`[GE-API] ${championshipsAgenda.length} campeonatos encontrados`);

      // ✅ IMPORTANTE: Coletar TODOS os jogos de TODOS os campeonatos
      // A API retorna jogos em 3 categorias: now (ao vivo), upcoming (futuros), finished (encerrados)
      // Precisamos pegar TODOS, independente do horário
      const allSoccerEvents: GESoccerEvent[] = [];
      
      let totalNow = 0;
      let totalUpcoming = 0;
      let totalFinished = 0;
      
      for (const agenda of championshipsAgenda) {
        const championshipName = agenda.championship?.name || 'Desconhecido';
        
        // ✅ Juntar jogos de TODOS os momentos (manhã, tarde e noite)
        // NOTA: API GE retorna 'future' e 'past', não 'upcoming' e 'finished'
        const nowEvents = agenda.now || [];
        const upcomingEvents = (agenda as any).future || (agenda as any).upcoming || [];
        const finishedEvents = (agenda as any).past || (agenda as any).finished || [];
        
        totalNow += nowEvents.length;
        totalUpcoming += upcomingEvents.length;
        totalFinished += finishedEvents.length;
        
        const totalEvents = nowEvents.length + upcomingEvents.length + finishedEvents.length;
        if (totalEvents > 0) {
          logger.info(`[GE-API] 📺 ${championshipName}: ${totalEvents} jogos (${nowEvents.length} ao vivo, ${upcomingEvents.length} agendados, ${finishedEvents.length} finalizados)`);
        }
        
        // ✅ Adicionar TODOS os jogos, não filtrar por horário
        allSoccerEvents.push(...nowEvents, ...upcomingEvents, ...finishedEvents);
      }

      if (allSoccerEvents.length === 0) {
        logger.warn(`[GE-API] ⚠️ Nenhum jogo encontrado para ${targetDate}`);
        return [];
      }

      logger.info(`[GE-API] ✅ TOTAL: ${allSoccerEvents.length} jogos encontrados`);
      logger.info(`[GE-API]    - Ao vivo: ${totalNow}`);
      logger.info(`[GE-API]    - Agendados (futuros): ${totalUpcoming}`);
      logger.info(`[GE-API]    - Finalizados: ${totalFinished}`);

      // Converter para formato padronizado
      const standardized = allSoccerEvents.map((event, index) => {
        const match = event.match;
        
        // Extrair canais de transmissão (liveWatchSources)
        const channels: string[] = [];
        if (match.liveWatchSources && Array.isArray(match.liveWatchSources)) {
          channels.push(...match.liveWatchSources.map(source => source.name).filter(Boolean));
        }

        // Criar ID único (usar ID do match)
        const matchId = match.id || (Date.now() + index);

        // Combinar data e hora para criar ISO string (com validação)
        const startDate = match.startDate || new Date().toISOString().split('T')[0];
        const startHour = match.startHour || '00:00:00';
        const dateTimeStr = `${startDate}T${startHour}`;
        let dateTime: Date;
        let isoDate: string;
        
        try {
          dateTime = new Date(dateTimeStr);
          // Verificar se a data é válida
          if (isNaN(dateTime.getTime())) {
            throw new Error('Invalid date');
          }
          isoDate = dateTime.toISOString();
        } catch {
          // Fallback para data atual se conversão falhar
          dateTime = new Date();
          isoDate = dateTime.toISOString();
        }

        return {
          id: matchId,
          homeTeam: match.firstContestant?.popularName || match.firstContestant?.name || 'Time A',
          awayTeam: match.secondContestant?.popularName || match.secondContestant?.name || 'Time B',
          homeTeamLogo: match.firstContestant?.badgeSvg || match.firstContestant?.badgePng || '',
          awayTeamLogo: match.secondContestant?.badgeSvg || match.secondContestant?.badgePng || '',
          leagueId: 0, // GE não fornece ID numérico do campeonato
          leagueName: match.phase?.championshipEdition?.championship?.name || 'Campeonato',
          leagueLogo: '', // GE não fornece logo do campeonato na resposta dos jogos
          date: isoDate,
          time: this.convertToBrazilTime(dateTimeStr),
          status: this.convertStatus(match.moment),
          channels,
          venue: match.location?.popularName,
        };
      }).filter(m => m !== null);

      // Log de jogos com canais
      const withChannels = standardized.filter(m => m.channels.length > 0);
      logger.info(`[GE-API] 📺 ${withChannels.length}/${standardized.length} jogos TÊM informação de canais`);
      
      if (withChannels.length > 0) {
        logger.info(`[GE-API] Exemplo: ${withChannels[0].homeTeam} vs ${withChannels[0].awayTeam} → ${withChannels[0].channels.join(', ')}`);
      }

      return standardized;
    } catch (error: any) {
      logger.error('[GE-API] Erro ao buscar jogos:', error.message);
      
      // Log mais detalhado do erro
      if (error.response) {
        logger.error(`[GE-API] Status: ${error.response.status}`);
        logger.error(`[GE-API] Resposta:`, error.response.data);
      }
      
      throw error;
    }
  }

  /**
   * Busca jogos de ontem
   */
  async getYesterdayMatches(): Promise<StandardizedMatch[]> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    return this.getTodayMatches(dateStr);
  }

  /**
   * Busca jogos de amanhã
   */
  async getTomorrowMatches(): Promise<StandardizedMatch[]> {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    return this.getTodayMatches(dateStr);
  }

  /**
   * Busca jogos de um range de datas (próximos N dias)
   */
  async getMatchesForNextDays(daysAhead: number = 7): Promise<StandardizedMatch[]> {
    try {
      logger.info(`[GE-API] Buscando jogos dos próximos ${daysAhead} dias...`);
      
      const allMatches: StandardizedMatch[] = [];
      const today = new Date();
      
      for (let i = 0; i < daysAhead; i++) {
        const currentDate = new Date(today);
        currentDate.setDate(currentDate.getDate() + i);
        const dateStr = currentDate.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
        
        try {
          const dayMatches = await this.getTodayMatches(dateStr);
          allMatches.push(...dayMatches);
          
          // Rate limiting: aguardar 1 segundo entre requisições
          if (i < daysAhead - 1) {
            await this.sleep(1000);
          }
        } catch (error: any) {
          logger.warn(`[GE-API] Erro ao buscar jogos de ${dateStr}: ${error.message}`);
          // Continuar mesmo se um dia falhar
        }
      }
      
      logger.info(`[GE-API] ✅ Total de ${allMatches.length} jogos encontrados em ${daysAhead} dias`);
      return allMatches;
    } catch (error: any) {
      logger.error('[GE-API] Erro ao buscar jogos do range de datas:', error.message);
      throw error;
    }
  }

  /**
   * Helper para aguardar (rate limiting)
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default GEApiService;
