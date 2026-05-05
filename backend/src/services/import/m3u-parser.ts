/**
 * M3U Parser - Parse simplificado de arquivos M3U
 * 
 * SEGURO: Apenas leitura e parse de dados
 * NÃO modifica nada no banco de dados
 */

import axios from 'axios';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('M3UParser');

export interface M3UItem {
  name: string;
  url: string;
  logo?: string;
  group?: string;
  tvgId?: string;
  tvgName?: string;
  type: 'live' | 'movie' | 'series';
}

export interface M3UCategory {
  name: string;
  count: number;
  type: 'live' | 'movie' | 'series';
}

export interface ParseResult {
  items: M3UItem[];
  categories: M3UCategory[];
  stats: {
    total: number;
    live: number;
    movies: number;
    series: number;
  };
}

export class M3UParser {
  /**
   * Faz download e parse de um M3U a partir de URL
   */
  async parseFromUrl(url: string, timeout: number = 60000): Promise<ParseResult> {
    logger.info(`[M3UParser] Baixando M3U: ${url}`);
    
    const response = await axios.get(url, {
      timeout,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; M3U-Importer/2.0)' },
      responseType: 'text',
    });

    return this.parseContent(response.data);
  }

  /**
   * Faz parse de conteúdo M3U
   */
  parseContent(content: string): ParseResult {
    if (!content || typeof content !== 'string') {
      throw new Error('Conteúdo M3U inválido');
    }

    const items: M3UItem[] = [];
    const lines = content.split('\n');
    let currentItem: Partial<M3UItem> | null = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#EXTM3U')) continue;

      if (line.startsWith('#EXTINF:')) {
        currentItem = this.parseExtinf(line);
      } else if (currentItem && line.startsWith('http')) {
        currentItem.url = line;
        items.push(currentItem as M3UItem);
        currentItem = null;
      }
    }

    // Extrair categorias
    const categoryMap = new Map<string, { count: number; type: 'live' | 'movie' | 'series' }>();
    let live = 0, movies = 0, series = 0;

    for (const item of items) {
      const catName = item.group || 'Sem categoria';
      const existing = categoryMap.get(catName);
      
      if (existing) {
        existing.count++;
      } else {
        categoryMap.set(catName, { count: 1, type: item.type });
      }

      if (item.type === 'live') live++;
      else if (item.type === 'movie') movies++;
      else if (item.type === 'series') series++;
    }

    const categories: M3UCategory[] = Array.from(categoryMap.entries()).map(([name, data]) => ({
      name,
      count: data.count,
      type: data.type,
    }));

    logger.info(`[M3UParser] Parseado: ${items.length} itens (${live} live, ${movies} filmes, ${series} séries)`);

    return {
      items,
      categories,
      stats: { total: items.length, live, movies, series },
    };
  }

  /**
   * Parse de uma linha #EXTINF
   */
  private parseExtinf(line: string): Partial<M3UItem> {
    const extinf = line.substring(8); // Remove #EXTINF:

    // Extrair atributos
    const tvgId = this.extractAttribute(extinf, 'tvg-id');
    const tvgName = this.extractAttribute(extinf, 'tvg-name');
    const tvgLogo = this.extractAttribute(extinf, 'tvg-logo');
    const groupTitle = this.extractAttribute(extinf, 'group-title');

    // Extrair nome (após última vírgula depois de aspas)
    let name = '';
    const lastQuoteIndex = extinf.lastIndexOf('"');
    if (lastQuoteIndex > -1) {
      const commaAfterQuote = extinf.indexOf(',', lastQuoteIndex);
      if (commaAfterQuote > -1) {
        name = extinf.substring(commaAfterQuote + 1).trim();
      }
    }
    if (!name) {
      const commaIndex = extinf.indexOf(',');
      name = commaIndex > -1 ? extinf.substring(commaIndex + 1).trim() : '';
    }

    // Limpar nome
    name = name
      .replace(/tvg-[^"]*="[^"]*"/gi, '')
      .replace(/group-title="[^"]*"/gi, '')
      .replace(/^"|"$/g, '')
      .trim();

    // Detectar tipo
    const type = this.detectType(name, groupTitle || '');

    return {
      name,
      logo: tvgLogo,
      group: groupTitle,
      tvgId,
      tvgName,
      type,
    };
  }

  /**
   * Extrai atributo de uma linha EXTINF
   */
  private extractAttribute(line: string, attr: string): string | undefined {
    const regex = new RegExp(`${attr}="([^"]+)"`, 'i');
    const match = line.match(regex);
    return match ? match[1] : undefined;
  }

  /**
   * Detecta tipo do item (live, movie, series)
   */
  private detectType(name: string, group: string): 'live' | 'movie' | 'series' {
    const lowerName = name.toLowerCase();
    const lowerGroup = group.toLowerCase();

    // 1. Grupo começa com "Filmes" ou contém "Filmes" = FILME
    if (/^(filmes?|movies?|cinema)\s*[\|:]/i.test(group) || /\bfilmes?\b/i.test(group)) {
      return 'movie';
    }

    // 2. Grupo começa com "Series" ou contém "Series" = SÉRIE
    if (/^(series?|séries?)\s*[\|:]/i.test(group) || /\b(series?|séries?)\b/i.test(group)) {
      return 'series';
    }

    // 3. Padrões de episódio no nome = SÉRIE
    const seriesPatterns = [
      /[Ss](\d{1,2})\s*[Ee](\d{1,2})/,
      /(\d{1,2})\s*x\s*(\d{1,2})/,
      /[Tt]emp(?:orada)?\s*(\d+)\s*[Ee]p(?:isodio)?\s*(\d+)/i,
      /[Ss]eason\s*(\d+)\s*[Ee]pisode\s*(\d+)/i,
    ];
    
    for (const pattern of seriesPatterns) {
      if (pattern.test(name)) {
        return 'series';
      }
    }

    // 4. Gêneros de filme conhecidos no grupo (sem prefixo "Filmes")
    const movieGenres = /\b(documentario|documentários|documentaries|acao|ação|action|comedia|comédia|comedy|terror|horror|suspense|thriller|drama|romance|aventura|adventure|animacao|animação|animation|ficcao|ficção|sci-?fi|fantasia|fantasy|guerra|war|faroeste|western|musical|crime|biografia|biography|classicos|clássicos|classics|lancamentos|lançamentos|dublado|legendado|4k|hd|uhd)\b/i;
    if (movieGenres.test(lowerGroup)) {
      return 'movie';
    }

    // 5. Tem ano no nome (formato comum de filme)
    const hasYear = /\(?(19\d{2}|20[0-2]\d)\)?/.test(name);
    if (hasYear) {
      return 'movie';
    }

    // 6. Palavras-chave de série no grupo
    if (/novela|programa|temporada|season/i.test(group)) {
      return 'series';
    }

    // 7. Default: LIVE
    return 'live';
  }

  /**
   * Filtra items por tipo
   */
  filterByType(items: M3UItem[], type: 'live' | 'movie' | 'series' | 'vod'): M3UItem[] {
    if (type === 'vod') {
      return items.filter(i => i.type === 'movie' || i.type === 'series');
    }
    return items.filter(i => i.type === type);
  }

  /**
   * Agrupa items por categoria
   */
  groupByCategory(items: M3UItem[]): Map<string, M3UItem[]> {
    const map = new Map<string, M3UItem[]>();
    
    for (const item of items) {
      const cat = item.group || 'Sem categoria';
      const existing = map.get(cat) || [];
      existing.push(item);
      map.set(cat, existing);
    }

    return map;
  }
}
