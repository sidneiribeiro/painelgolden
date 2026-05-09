import axios from 'axios';
import { prisma } from '../config/database.js';
import { createLogger } from '../utils/logger.js';
import TheSportsDBService from './jogos-do-dia/thesportsdb.service.js';

const logger = createLogger('TVGuideService');

class TVGuideService {
  /**
   * Atualiza eventos de TV do dia (multi-esporte, limitado ao que a API fornecer)
   * Fonte principal: TheSportsDB (eventsday/eventsseason + lookuptv)
   * @param daysAhead número de dias à frente (default 1 = hoje)
   */
  async refreshTVEvents(daysAhead: number = 1, apiKey?: string) {
    const theSports = new TheSportsDBService(apiKey || '123');

    const matches = await theSports.getTodayMatches(daysAhead);
    logger.info(`[TVGuide] ${matches.length} eventos retornados pela TheSportsDB para TV`);

    let saved = 0;
    for (const item of matches) {
      const ev = item.event;
      const channels = item.channels || [];
      const mainChannel = channels[0]?.strChannel || null;
      const channelLogo = channels[0]?.strLogo || null;

      const title =
        ev.strEvent ||
        `${ev.strHomeTeam || ''}${ev.strAwayTeam ? ' vs ' + ev.strAwayTeam : ''}`.trim() ||
        'Evento';

      const date = ev.dateEvent || ev.strTimestamp?.substring(0, 10);
      const time = ev.strTime || ev.strTimestamp?.substring(11, 16) || '00:00';
      if (!date) continue;

      const when = new Date(`${date}T${time}`);

      await (prisma as any).tVEvent.upsert({
        where: {
          apiEventId: ev.idEvent || `${title}-${date}-${time}`,
        },
        update: {
          title,
          sport: ev.strSport || 'Soccer',
          league: ev.strLeague || null,
          homeTeam: ev.strHomeTeam || null,
          awayTeam: ev.strAwayTeam || null,
          date: when,
          matchTime: time.substring(0, 5),
          channelName: mainChannel,
          channelLogo: channelLogo || null,
          apiSource: 'TheSportsDB',
        },
        create: {
          title,
          sport: ev.strSport || 'Soccer',
          league: ev.strLeague || null,
          homeTeam: ev.strHomeTeam || null,
          awayTeam: ev.strAwayTeam || null,
          date: when,
          matchTime: time.substring(0, 5),
          channelName: mainChannel,
          channelLogo: channelLogo || null,
          apiEventId: ev.idEvent || `${title}-${date}-${time}`,
          apiSource: 'TheSportsDB',
        },
      });

      saved++;
    }

    // Fallback: se nada salvo pela API oficial, tentar grade HTML "Sports On TV today" (Brasil)
    if (saved === 0) {
      const scraped = await this.fetchFromBrowseTV();
      saved += scraped;
    }

    logger.info(`[TVGuide] ✅ ${saved} eventos de TV salvos/atualizados`);
    return { saved };
  }

  /**
   * Fallback: busca a grade "Sports On TV today" (Brasil) via HTML público.
   * Fonte: https://www.thesportsdb.com/browse_tv/?c=brazil
   * Heurística simples para capturar título, horário e canal principal.
   */
  private async fetchFromBrowseTV(): Promise<number> {
    try {
      const url = 'https://www.thesportsdb.com/browse_tv/?c=brazil';
      logger.info('[TVGuide] Fallback: buscando grade de TV (HTML) em ' + url);
      const resp = await axios.get(url, { timeout: 20000 });
      const html = resp.data as string;

      // Separar por células <td ...>...</td> e filtrar apenas as que têm flag do Brasil
      const cells = html.split(/<td[^>]*>/i).filter((c) => c.includes('flags/shiny/16/brazil'));
      const titleRegex = /\/event\/[^"]+">([^<]+)<\/a>/i;
      const timeRegex = /time\.png"[^>]*>\s*([^<\s]+)\s*UTC/i; // captura HH:MM:SS
      const channelRegex = /flags\/shiny\/16\/brazil\.png[\s\S]*?\/channel\/[^"]+">([^<]+)<\/a>/gi;

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const baseDateStr = today.toISOString().substring(0, 10);

      let saved = 0;
      for (const cell of cells) {
        const block = cell || '';
        const titleRaw = (block.match(titleRegex)?.[1] || '').trim();
        if (!titleRaw) continue; // sem título, ignora
        const title = titleRaw;
        const timeStr = (block.match(timeRegex)?.[1] || '00:00:00').trim(); // ex: "01:00:00"

        // Canais BR
        const channelNames: string[] = [];
        let cMatch;
        while ((cMatch = channelRegex.exec(block)) !== null) {
          const ch = (cMatch[1] || '').trim();
          if (ch) channelNames.push(ch);
        }
        const mainChannel = channelNames[0] || null;

        const hhmm = timeStr.substring(0, 5) || '00:00';
        const when = new Date(`${baseDateStr}T${hhmm}:00`);

        const apiId = `tvhtml-${title}-${baseDateStr}-${hhmm}`;

        await (prisma as any).tVEvent.upsert({
          where: { apiEventId: apiId },
          update: {
            title,
            sport: 'TV',
            league: null,
            homeTeam: null,
            awayTeam: null,
            date: when,
            matchTime: hhmm,
            channelName: mainChannel,
            channelLogo: null,
            apiSource: 'TheSportsDB-TVHTML',
          },
          create: {
            title,
            sport: 'TV',
            league: null,
            homeTeam: null,
            awayTeam: null,
            date: when,
            matchTime: hhmm,
            channelName: mainChannel,
            channelLogo: null,
            apiEventId: apiId,
            apiSource: 'TheSportsDB-TVHTML',
          },
        });

        saved++;
      }

      logger.info(`[TVGuide] Fallback HTML salvou ${saved} eventos`);
      return saved;
    } catch (error: any) {
      logger.warn('[TVGuide] Erro no fallback HTML de TV:', error.message);
      return 0;
    }
  }

  /**
   * Lista eventos entre datas
   */
  async listTVEvents(start?: Date, end?: Date) {
    const where: any = {};
    if (start || end) {
      where.date = {};
      if (start) where.date.gte = start;
      if (end) where.date.lte = end;
    } else {
      // padrão: hoje
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      where.date = { gte: today, lt: tomorrow };
    }

    return (prisma as any).tVEvent.findMany({
      where,
      orderBy: [{ date: 'asc' }, { matchTime: 'asc' }],
    });
  }

  /**
   * Lista canais mapeados
   */
  async listChannelMaps() {
    return (prisma as any).tVChannelMap.findMany({
      orderBy: [{ priority: 'desc' }, { apiChannel: 'asc' }],
    });
  }

  /**
   * Cria ou atualiza mapeamento de canal (API -> XUI stream)
   */
  async upsertChannelMap(data: {
    apiChannel: string;
    xuiStreamId?: number;
    xuiServerId?: string;
    xuiCategoryId?: number;
    priority?: number;
  }) {
    if (!data.apiChannel) {
      throw new Error('apiChannel é obrigatório');
    }

    return (prisma as any).tVChannelMap.upsert({
      where: { apiChannel: data.apiChannel },
      update: {
        xuiStreamId: data.xuiStreamId ?? null,
        xuiServerId: data.xuiServerId ?? null,
        xuiCategoryId: data.xuiCategoryId ?? null,
        priority: data.priority ?? 0,
      },
      create: {
        apiChannel: data.apiChannel,
        xuiStreamId: data.xuiStreamId ?? null,
        xuiServerId: data.xuiServerId ?? null,
        xuiCategoryId: data.xuiCategoryId ?? null,
        priority: data.priority ?? 0,
      },
    });
  }
}

export default new TVGuideService();

