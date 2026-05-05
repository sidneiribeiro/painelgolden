import axios from 'axios';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('TheSportsDB');

/**
 * TheSportsDB API Service
 * API gratuita com 30 requisições/minuto
 * Inclui informações de canais de transmissão
 */

interface TheSportsDBEvent {
  idEvent: string;
  idAPIfootball?: string;
  strEvent: string;
  strEventAlternate?: string;
  strSport: string;
  idLeague: string;
  strLeague: string;
  strLeagueBadge?: string;
  strSeason: string;
  strHomeTeam: string;
  strAwayTeam: string;
  strTimestamp: string;
  dateEvent: string;
  strTime: string;
  strTimeLocal?: string;
  idHomeTeam: string;
  strHomeTeamBadge?: string;
  idAwayTeam: string;
  strAwayTeamBadge?: string;
  strStatus?: string;
  strVenue?: string;
  strCountry?: string;
}

interface TheSportsDBTVEvent {
  id: string;
  idEvent: string;
  strSport: string;
  strEvent: string;
  idChannel: string;
  strCountry: string;
  strChannel: string;
  strLogo?: string;
  strTime: string;
  dateEvent: string;
  strTimeStamp: string;
}

interface TheSportsDBResponse<T> {
  events?: T[];
  event?: T;
  tvevent?: TheSportsDBTVEvent[];
  tvevents?: TheSportsDBTVEvent[];
  leagues?: any[];
  teams?: any[];
}

/**
 * IDs das ligas brasileiras e internacionais que queremos buscar
 * IDs verificados e confirmados no TheSportsDB
 * 
 * PRIORIDADE: Competições brasileiras e principais torneios internacionais
 */
export const LEAGUE_IDS = {
  // ========================================
  // BRASIL - NACIONAIS (PRIORIDADE MÁXIMA)
  // ========================================
  BRAZILIAN_SERIE_A: 4351,      // Campeonato Brasileiro Série A ✅
  BRAZILIAN_SERIE_B: 4406,      // Campeonato Brasileiro Série B ✅
  COPA_DO_BRASIL: 4725,         // Copa do Brasil ✅
  
  // ========================================
  // BRASIL - ESTADUAIS
  // ========================================
  CAMPEONATO_PAULISTA: 4532,    // Campeonato Paulista
  CAMPEONATO_CARIOCA: 4533,     // Campeonato Carioca
  CAMPEONATO_MINEIRO: 4534,     // Campeonato Mineiro
  CAMPEONATO_GAUCHO: 4535,      // Campeonato Gaúcho
  CAMPEONATO_BAIANO: 5684,      // Campeonato Baiano
  CAMPEONATO_CATARINENSE: 5687, // Campeonato Catarinense
  
  // ========================================
  // CONMEBOL (ALTA PRIORIDADE)
  // ========================================
  COPA_LIBERTADORES: 4501,      // Copa Libertadores ✅
  COPA_LIBERTADORES_ALT: 4350,  // Libertadores (ID alternativo)
  COPA_SULAMERICANA: 4401,      // Copa Sul-americana ✅
  
  // ========================================
  // UEFA (ALTA PRIORIDADE)
  // ========================================
  UEFA_CHAMPIONS_LEAGUE: 4480,  // Liga dos Campeões da UEFA ✅
  UEFA_EUROPA_LEAGUE: 4481,     // Liga Europa da UEFA
};

/**
 * Lista de IDs de ligas para buscar automaticamente
 * Ordem: Brasil primeiro (prioridade), depois internacionais
 */
export const LEAGUES_TO_FETCH = [
  // ========================================
  // BRASIL - NACIONAIS (PRIORIDADE MÁXIMA)
  // ========================================
  LEAGUE_IDS.BRAZILIAN_SERIE_A,     // Campeonato Brasileiro Série A
  LEAGUE_IDS.BRAZILIAN_SERIE_B,     // Campeonato Brasileiro Série B
  LEAGUE_IDS.COPA_DO_BRASIL,        // Copa do Brasil
  
  // ========================================
  // BRASIL - ESTADUAIS
  // ========================================
  LEAGUE_IDS.CAMPEONATO_PAULISTA,
  LEAGUE_IDS.CAMPEONATO_CARIOCA,
  LEAGUE_IDS.CAMPEONATO_MINEIRO,
  LEAGUE_IDS.CAMPEONATO_GAUCHO,
  LEAGUE_IDS.CAMPEONATO_BAIANO,
  LEAGUE_IDS.CAMPEONATO_CATARINENSE,
  
  // ========================================
  // CONMEBOL (ALTA PRIORIDADE)
  // ========================================
  LEAGUE_IDS.COPA_LIBERTADORES,     // Copa Libertadores
  LEAGUE_IDS.COPA_LIBERTADORES_ALT, // Libertadores (ID alternativo)
  LEAGUE_IDS.COPA_SULAMERICANA,     // Copa Sul-americana
  
  // ========================================
  // UEFA (LIGA DOS CAMPEÕES)
  // ========================================
  LEAGUE_IDS.UEFA_CHAMPIONS_LEAGUE, // Liga dos Campeões da UEFA
  LEAGUE_IDS.UEFA_EUROPA_LEAGUE,    // Liga Europa da UEFA
];

/**
 * Canais brasileiros conhecidos (para filtrar)
 */
const BRAZILIAN_CHANNELS = [
  'ESPN',
  'ESPN Brasil',
  'ESPN 2',
  'ESPN 2 Brazil',
  'SPORTV',
  'SporTV',
  'SporTV 2',
  'SporTV 3',
  'Premiere',
  'Premiere FC',
  'Band',
  'Band Sports',
  'Fox Sports',
  'Fox Sports 1 BR',
  'Fox Sports 2 BR',
  'Globo',
  'Globo Sao Paulo',
  'DAZN',
  'DAZN Brasil',
  'TNT Sports',
  'TNT Sports Brasil',
  'OneFootball',
  'OneFootball BR',
];

export class TheSportsDBService {
  private apiKey: string;
  private baseUrl = 'https://www.thesportsdb.com/api/v1/json';

  constructor(apiKey: string = '123') {
    // Chave padrão gratuita é "123"
    this.apiKey = apiKey || '123';
    logger.info('[TheSportsDB] Service inicializado');
  }

  private formatTimeHHMMInBrazil(date: Date): string {
    return date.toLocaleTimeString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  /**
   * Converte horário UTC para horário de Brasília
   */
  convertUTCToBrazil(utcTime: string | null, utcDate: string): string {
    if (!utcTime || utcTime === '00:00:00' || utcTime === 'TBD') {
      return 'A definir';
    }
    
    try {
      const dateTimeUTC = new Date(`${utcDate}T${utcTime}Z`);
      
      return dateTimeUTC.toLocaleTimeString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    } catch (error) {
      console.error('Erro ao converter timezone:', error);
      return utcTime.substring(0, 5);
    }
  }

  private normalizeTimeToHHMMSS(time?: string | null): string | null {
    if (!time) return null;
    const t = String(time).trim();
    if (!t || t === '00:00' || t === '00:00:00') return null;
    if (/^\d{2}:\d{2}$/.test(t)) return `${t}:00`;
    if (/^\d{2}:\d{2}:\d{2}$/.test(t)) return t;
    const m = t.match(/^(\d{2}):(\d{2})/);
    if (m) return `${m[1]}:${m[2]}:00`;
    return null;
  }

  private parseEventUtc(event: TheSportsDBEvent): Date | null {
    // Preferir timestamp se existir
    if (event.strTimestamp) {
      const raw = String(event.strTimestamp).trim();
      if (raw) {
        // Pode vir como "YYYY-MM-DD HH:mm:ss" (sem TZ). Tratar como UTC.
        const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
        const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso);
        const d = new Date(hasTz ? iso : `${iso}Z`);
        if (!isNaN(d.getTime())) return d;
      }
    }
    if (event.dateEvent) {
      const hhmmss = this.normalizeTimeToHHMMSS(event.strTime) || '12:00:00';
      // TheSportsDB retorna strTime em UTC
      const d = new Date(`${event.dateEvent}T${hhmmss}Z`);
      if (!isNaN(d.getTime())) return d;
    }
    return null;
  }

  /**
   * Buscar eventos de hoje e próximos dias
   * Usa múltiplas estratégias: eventsseason.php (por liga) + eventsday.php (por dia)
   */
  async getTodayMatches(daysAhead: number = 7, enabledLeagueIds: number[] = []): Promise<Array<{
    event: TheSportsDBEvent;
    channels: TheSportsDBTVEvent[];
  }>> {
    const today = new Date();
    const todayStr = this.formatDate(today);
    
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + daysAhead);
    const endDateStr = this.formatDate(endDate);

    try {
      logger.info(`[TheSportsDB] Buscando eventos de ${todayStr} até ${endDateStr} (${daysAhead} dias)`);
      
      const allEvents: Array<{ event: TheSportsDBEvent; channels: TheSportsDBTVEvent[] }> = [];
      const eventIdsSeen = new Set<string>(); // Para evitar duplicatas

      const includeAllBrazil = (enabledLeagueIds || []).includes(-1);
      const baseLeagueIds = (enabledLeagueIds || []).filter(n => typeof n === 'number' && n !== -1);

      // Se "Brasil (todas as ligas)" estiver ativo, adicionar TODAS as ligas brasileiras + internacionais importantes
      const EXTRA_BRAZIL_LEAGUES = [
        // Brasil - Nacionais
        4351, // Serie A
        4406, // Serie B
        4725, // Copa do Brasil
        // Brasil - Estaduais
        4532, // Campeonato Paulista
        4533, // Campeonato Carioca
        4534, // Campeonato Mineiro
        4535, // Campeonato Gaúcho
        5687, // Campeonato Catarinense
        5684, // Campeonato Baiano
        // CONMEBOL
        4501, // Libertadores
        4350, // Libertadores (ID alternativo)
        4401, // Sul-Americana
        // UEFA
        4480, // Liga dos Campeões
        4481, // Liga Europa
      ];

      const leaguesToFetch = [
        ...(baseLeagueIds.length > 0 ? baseLeagueIds : LEAGUES_TO_FETCH),
        ...(includeAllBrazil ? EXTRA_BRAZIL_LEAGUES : []),
      ]
        .map(n => Number(n))
        .filter(n => !Number.isNaN(n) && n > 0)
        .filter((v, i, a) => a.indexOf(v) === i);

      // ESTRATÉGIA 1: Buscar eventos por liga (mais confiável, especialmente para datas futuras)
      // Otimização: quando tiver muitas ligas, NÃO buscar canais por evento (evita rate-limit)
      const fetchTvChannels = leaguesToFetch.length > 0 && leaguesToFetch.length <= 6;
      logger.info(`[TheSportsDB] Estratégia 1: Buscando por liga (${leaguesToFetch.length}). TV channels: ${fetchTvChannels ? 'SIM' : 'NÃO'}`);

      for (const leagueId of leaguesToFetch) {
        try {
          const events = await this.getEventsByLeague(leagueId, todayStr, endDateStr);
          
          if (events.length === 0) {
            logger.debug(`[TheSportsDB] Nenhum evento encontrado para liga ${leagueId}`);
            await this.sleep(2000); // Rate limiting mesmo sem eventos
            continue;
          }
          
          for (const event of events) {
            if (eventIdsSeen.has(event.idEvent)) continue;
            eventIdsSeen.add(event.idEvent);

            if (!fetchTvChannels) {
              allEvents.push({ event, channels: [] });
              continue;
            }

            try {
              logger.debug(`[TheSportsDB] Buscando canais para evento ${event.idEvent}: ${event.strHomeTeam} vs ${event.strAwayTeam}`);
              const tv = await this.getTVChannelsForEvent(event.idEvent);
              const brazilianChannels = this.filterBrazilianChannels(tv);
              const finalChannels = brazilianChannels.length > 0 ? brazilianChannels : tv;

              allEvents.push({ event, channels: finalChannels });
              await this.sleep(2500);
            } catch (error: any) {
              logger.warn(`[TheSportsDB] Erro ao buscar canais para evento ${event.idEvent}:`, error.message);
              allEvents.push({ event, channels: [] });
              await this.sleep(2500);
            }
          }
          
          await this.sleep(2500);
        } catch (error: any) {
          logger.warn(`[TheSportsDB] Erro ao buscar liga ${leagueId}:`, error.message);
          // Continuar mesmo se uma liga falhar
          await this.sleep(2500); // Rate limiting mesmo em caso de erro
        }
      }

      // ESTRATÉGIA 2: Buscar eventos dia a dia usando eventsday.php (complementar)
      // IMPORTANTE: Respeitar ligas selecionadas na configuração (enabledLeagueIds)
      logger.info(`[TheSportsDB] Estratégia 2: Buscando por dia (${daysAhead} dias) - filtro por ligas selecionadas...`);
      const currentDate = new Date(today);
      let daysProcessed = 0;
      
      while (currentDate <= endDate && daysProcessed < daysAhead) {
        const dateStr = this.formatDate(currentDate);
        
        try {
          const dayResponse = await axios.get<TheSportsDBResponse<TheSportsDBEvent>>(
            `${this.baseUrl}/${this.apiKey}/eventsday.php`,
            {
              params: {
                d: dateStr,
                s: 'Soccer',
              },
              timeout: 15000,
            }
          );

          if (dayResponse.data.events && Array.isArray(dayResponse.data.events)) {
            const leagueSet = new Set(leaguesToFetch.map(n => Number(n)).filter(n => !Number.isNaN(n)));
            const includeAllBrazil = leagueSet.has(-1);

            const filtered = dayResponse.data.events.filter(event => {
              if (eventIdsSeen.has(event.idEvent)) return false;
              if (leagueSet.size === 0) return true;
              const idLeague = parseInt(String(event.idLeague), 10);
              if (leagueSet.has(idLeague)) return true;
              if (includeAllBrazil) {
                const country = (event.strCountry || '').toLowerCase();
                if (country.includes('brazil') || country.includes('brasil')) return true;
                const leagueName = (event.strLeague || '').toLowerCase();
                const brazilianKeywords = [
                  'brasil', 'brazil', 'brasileiro', 'copa', 'paulista', 'carioca',
                  'mineiro', 'gaúcho', 'gaucho', 'copinha', 'são paulo', 'sao paulo'
                ];
                if (brazilianKeywords.some(k => leagueName.includes(k))) return true;
              }
              return false;
            });

            // ⚠️ PERFORMANCE: não buscar canais aqui (muito lento/rate-limit)
            for (const event of filtered) {
              eventIdsSeen.add(event.idEvent);
              allEvents.push({ event, channels: [] });
            }

            if (filtered.length > 0) {
              logger.info(`[TheSportsDB] ${filtered.length} eventos encontrados em ${dateStr}`);
            }
          }
        } catch (error: any) {
          logger.warn(`[TheSportsDB] Erro ao buscar eventos do dia ${dateStr}:`, error.message);
        }
        
        currentDate.setDate(currentDate.getDate() + 1);
        daysProcessed++;
        await this.sleep(2500); // Rate limiting entre dias
      }

      logger.info(`[TheSportsDB] ✅ Total de ${allEvents.length} eventos únicos encontrados (${eventIdsSeen.size} IDs únicos)`);
      return allEvents;
    } catch (error: any) {
      logger.error('[TheSportsDB] Erro ao buscar eventos:', error.message);
      throw error;
    }
  }

  /**
   * Buscar eventos de uma liga específica
   * Usa eventsseason.php para buscar todos os eventos da temporada atual
   */
  private async getEventsByLeague(
    leagueId: number,
    from: string,
    to: string
  ): Promise<TheSportsDBEvent[]> {
    try {
      const allEvents: TheSportsDBEvent[] = [];
      
      // Obter ano atual para buscar temporada
      const currentYear = new Date().getFullYear();
      
      // Tentar buscar eventos da temporada atual primeiro
      try {
        const seasonResponse = await axios.get<TheSportsDBResponse<TheSportsDBEvent>>(
          `${this.baseUrl}/${this.apiKey}/eventsseason.php`,
          {
            params: { 
              id: leagueId,
              s: currentYear.toString()
            },
            timeout: 15000,
          }
        );

        if (seasonResponse.data.events && Array.isArray(seasonResponse.data.events)) {
          // Filtrar eventos no range de datas
          const filtered = seasonResponse.data.events.filter(event => {
            if (!event.dateEvent) return false;
            const eventDate = event.dateEvent;
            return eventDate >= from && eventDate <= to;
          });
          
          if (filtered.length > 0) {
            allEvents.push(...filtered);
            logger.info(`[TheSportsDB] ${filtered.length} eventos encontrados na liga ${leagueId} temporada ${currentYear} (${from} a ${to})`);
            return allEvents; // Retornar se encontrou eventos
          }
        }
      } catch (seasonError: any) {
        logger.debug(`[TheSportsDB] Não foi possível buscar temporada ${currentYear} da liga ${leagueId}, tentando próximo método...`);
      }
      
      // Fallback: buscar eventos próximos da liga
      const response = await axios.get<TheSportsDBResponse<TheSportsDBEvent>>(
        `${this.baseUrl}/${this.apiKey}/eventsnextleague.php`,
        {
          params: { id: leagueId },
          timeout: 15000,
        }
      );

      if (response.data.events && Array.isArray(response.data.events)) {
        // Filtrar eventos no range de datas
        const filtered = response.data.events.filter(event => {
          if (!event.dateEvent) return false;
          const eventDate = event.dateEvent;
          return eventDate >= from && eventDate <= to;
        });
        
        allEvents.push(...filtered);
        logger.info(`[TheSportsDB] ${filtered.length} eventos encontrados na liga ${leagueId} (próximos eventos, ${from} a ${to})`);
      } else {
        logger.debug(`[TheSportsDB] Nenhum evento encontrado para liga ${leagueId}`);
      }

      return allEvents;
    } catch (error: any) {
      if (error.response?.status === 429) {
        logger.warn('[TheSportsDB] Rate limit atingido, aguardando...');
        await this.sleep(5000);
        return this.getEventsByLeague(leagueId, from, to); // Retry
      }
      // Se não encontrar eventos, retornar array vazio (não é erro)
      if (error.response?.status === 404) {
        return [];
      }
      logger.warn(`[TheSportsDB] Erro ao buscar liga ${leagueId}:`, error.message);
      return [];
    }
  }

  /**
   * Buscar canais de TV para um evento
   */
  async getTVChannelsForEvent(eventId: string): Promise<TheSportsDBTVEvent[]> {
    try {
      const response = await axios.get<TheSportsDBResponse<TheSportsDBTVEvent>>(
        `${this.baseUrl}/${this.apiKey}/lookuptv.php`,
        {
          params: { id: eventId },
          timeout: 15000,
        }
      );

      const channels = response.data.tvevent || response.data.tvevents || [];
      return channels;
    } catch (error: any) {
      if (error.response?.status === 429) {
        logger.warn('[TheSportsDB] Rate limit ao buscar canais, aguardando 10 segundos...');
        await this.sleep(10000); // Aguardar mais tempo quando rate limit
        return this.getTVChannelsForEvent(eventId); // Retry
      }
      // Se não encontrar canais, retornar array vazio (não é erro)
      if (error.response?.status === 404) {
        return [];
      }
      logger.warn(`[TheSportsDB] Erro ao buscar canais para evento ${eventId}:`, error.message);
      return [];
    }
  }

  /**
   * Filtrar apenas canais brasileiros
   */
  private filterBrazilianChannels(channels: TheSportsDBTVEvent[]): TheSportsDBTVEvent[] {
    return channels.filter(channel => {
      const country = channel.strCountry?.toLowerCase() || '';
      const channelName = channel.strChannel?.toLowerCase() || '';
      
      // Filtrar por país Brasil ou por nome de canal conhecido
      return country.includes('brazil') || 
             country.includes('brasil') ||
             BRAZILIAN_CHANNELS.some(brChannel => 
               channelName.includes(brChannel.toLowerCase())
             );
    });
  }

  /**
   * Buscar eventos de hoje especificamente
   */
  async getTodayEvents(): Promise<Array<{ event: TheSportsDBEvent; channels: TheSportsDBTVEvent[] }>> {
    const today = new Date();
    const todayStr = this.formatDate(today);

    try {
      const allEvents: Array<{ event: TheSportsDBEvent; channels: TheSportsDBTVEvent[] }> = [];

      // Buscar eventos do dia
      const response = await axios.get<TheSportsDBResponse<TheSportsDBEvent>>(
        `${this.baseUrl}/${this.apiKey}/eventsday.php`,
        {
          params: {
            d: todayStr,
            s: 'Soccer',
          },
          timeout: 15000,
        }
      );

      if (response.data.events) {
        // Filtrar apenas ligas que queremos
        const filtered = response.data.events.filter(event => 
          LEAGUES_TO_FETCH.includes(parseInt(event.idLeague))
        );

        // Buscar canais para cada evento
        for (const event of filtered) {
          try {
            const channels = await this.getTVChannelsForEvent(event.idEvent);
            const brazilianChannels = this.filterBrazilianChannels(channels);
            
            allEvents.push({
              event,
              channels: brazilianChannels.length > 0 ? brazilianChannels : channels,
            });
            
            await this.sleep(2000);
          } catch (error: any) {
            logger.warn(`[TheSportsDB] Erro ao buscar canais para ${event.idEvent}:`, error.message);
          }
        }
      }

      return allEvents;
    } catch (error: any) {
      logger.error('[TheSportsDB] Erro ao buscar eventos de hoje:', error.message);
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
   * Extrair hora do timestamp
   */
  extractTime(timestamp: string): string {
    if (!timestamp) return '00:00';
    
    // Se já vem no formato HH:MM:SS, pegar apenas HH:MM
    if (timestamp.match(/^\d{2}:\d{2}/)) {
      return timestamp.substring(0, 5);
    }
    
    // Se vem como datetime ISO
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  /**
   * Converter para formato interno
   */
  convertToInternalFormat(data: {
    event: TheSportsDBEvent;
    channels: TheSportsDBTVEvent[];
  }): {
    date: Date;
    homeTeam: string;
    homeTeamLogo: string;
    awayTeam: string;
    awayTeamLogo: string;
    competition: string;
    competitionLogo: string;
    matchTime: string;
    externalId: string;
    channels: string[]; // Nomes dos canais
    channelLogos: string[]; // Logos dos canais
  } {
    const { event, channels } = data;
    // ✅ CORREÇÃO DEFINITIVA: TheSportsDB fornece strTime em UTC
    // Armazenar matchDate como Date UTC e exibir matchTime em America/Sao_Paulo
    const matchDate = this.parseEventUtc(event) || new Date();
    const matchTime = this.formatTimeHHMMInBrazil(matchDate);

    // Buscar escudos dos times (com fallback)
    let homeLogo = event.strHomeTeamBadge || '';
    let awayLogo = event.strAwayTeamBadge || '';

    // Se não tiver escudo, tentar buscar da API de times
    // (isso pode ser implementado depois se necessário)

    // Filtrar canais válidos (não vazios)
    const validChannels = channels
      .filter(c => c.strChannel && c.strChannel.trim() !== '')
      .map(c => c.strChannel);

    return {
      date: matchDate,
      homeTeam: event.strHomeTeam,
      homeTeamLogo: homeLogo,
      awayTeam: event.strAwayTeam,
      awayTeamLogo: awayLogo,
      competition: event.strLeague,
      competitionLogo: event.strLeagueBadge || '',
      matchTime,
      externalId: event.idEvent,
      channels: validChannels,
      channelLogos: channels.map(c => c.strLogo || '').filter(Boolean),
    };
  }

  /**
   * Sleep helper para rate limiting
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default TheSportsDBService;

