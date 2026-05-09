/**
 * Parser de Episódios de Séries a partir de nomes M3U
 */

export interface ParsedEpisode {
  seriesName: string;
  season: number;
  episode: number;
  fullName: string;
  url: string;
  logo?: string;
  group?: string;
}

/**
 * Padrões para detectar episódios de séries
 */
const SERIES_PATTERNS = [
  /^(.+?)\s*[Ss](\d{1,2})\s*[Ee](\d{1,2})/,              // S01E01, S01 E01, s1e1
  /^(.+?)\s*(\d{1,2})\s*x\s*(\d{1,2})/,                  // 1x01, 01x01
  /^(.+?)\s*[Tt]emp(?:orada)?\s*(\d+)\s*[Ee]p(?:isodio)?\s*(\d+)/i,  // Temporada 1 Episodio 1
  /^(.+?)\s*[Ss]eason\s*(\d+)\s*[Ee]pisode\s*(\d+)/i,    // Season 1 Episode 1
];

/**
 * Limpa o nome da série removendo metadados
 */
function cleanSeriesName(name: string): string {
  return name
    .replace(/\b(1080p|720p|480p|4K|UHD|HDR|HEVC|x264|x265)\b/gi, '')
    .replace(/\b(Dublado|Legendado|Dual|Audio|PT-BR|BR|Nacional)\b/gi, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[-_\.]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Detecta se um nome de stream é um episódio de série e extrai informações
 */
export function detectSeriesEpisode(name: string, url: string, logo?: string, group?: string): ParsedEpisode | null {
  for (const pattern of SERIES_PATTERNS) {
    const match = name.match(pattern);
    if (match) {
      return {
        seriesName: cleanSeriesName(match[1]),
        season: parseInt(match[2], 10),
        episode: parseInt(match[3], 10),
        fullName: name,
        url,
        logo,
        group,
      };
    }
  }
  return null;
}

