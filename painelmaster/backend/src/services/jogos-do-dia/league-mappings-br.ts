/**
 * ⚽ MAPEAMENTOS ESTÁTICOS DE CAMPEONATOS BRASILEIROS
 * 
 * Base de dados de onde passa cada campeonato na TV brasileira
 * Muito mais preciso que mapear jogo a jogo!
 * 
 * FONTE: Pesquisa internet + conhecimento geral
 * ATUALIZAÇÃO: Janeiro 2026
 */

export interface LeagueMappingPreset {
  leagueName: string;           // Nome do campeonato (conforme API GE)
  alternativeNames: string[];   // Variações de nome
  channels: string[];           // Canais onde passa (em ordem de prioridade)
  season: string;               // Época: "year-round", "jan-apr", "feb-dec", etc
  priority: number;             // Prioridade do preset (1-10)
}

/**
 * 🇧🇷 CAMPEONATOS BRASILEIROS
 * Atualizado para temporada 2026
 */
export const BRAZIL_LEAGUE_MAPPINGS: LeagueMappingPreset[] = [
  // ==========================================
  // NACIONAIS (ano todo)
  // ==========================================
  {
    leagueName: 'Campeonato Brasileiro Série A',
    alternativeNames: [
      'Brasileirão',
      'Brasileirão Série A',
      'Série A',
      'Campeonato Brasileiro',
      'Brasileirao',
    ],
    channels: ['Premiere', 'Premiere FC', 'Premiere Clubes'],
    season: 'apr-dec',
    priority: 10,
  },
  {
    leagueName: 'Campeonato Brasileiro Série B',
    alternativeNames: ['Brasileirão Série B', 'Série B', 'Brasileirao B'],
    channels: ['Premiere 2', 'Premiere', 'SporTV'],
    season: 'apr-dec',
    priority: 9,
  },
  {
    leagueName: 'Copa do Brasil',
    alternativeNames: ['Copa Brasil'],
    channels: ['Globo', 'SporTV', 'Premiere', 'Amazon Prime Video'],
    season: 'feb-oct',
    priority: 10,
  },

  // ==========================================
  // ESTADUAIS (Janeiro - Abril)
  // ==========================================
  {
    leagueName: 'Campeonato Paulista',
    alternativeNames: ['Paulistão', 'Paulista A1', 'Campeonato Paulista Série A1'],
    channels: [
      'Record TV',
      'Record News',
      'Paulistão Play',
      'CazéTV',
      'TNT Sports',
      'Max',
      'UOL Play',
    ],
    season: 'jan-apr',
    priority: 9,
  },
  {
    leagueName: 'Campeonato Carioca',
    alternativeNames: ['Carioca', 'Cariocão', 'Campeonato Carioca Série A'],
    channels: ['Band', 'Bandplay', 'Canal GOAT', 'Premiere'],
    season: 'jan-apr',
    priority: 9,
  },
  {
    leagueName: 'Campeonato Mineiro',
    alternativeNames: ['Mineiro', 'Mineirão Futebol'],
    channels: ['Premiere', 'Globo', 'SporTV'],
    season: 'jan-apr',
    priority: 8,
  },
  {
    leagueName: 'Campeonato Gaúcho',
    alternativeNames: ['Gauchão', 'Gaúcho'],
    channels: ['Premiere', 'NSports', 'GZH', 'RBS TV'],
    season: 'jan-apr',
    priority: 8,
  },
  {
    leagueName: 'Campeonato Pernambucano',
    alternativeNames: ['Pernambucano'],
    channels: ['NSports', 'TV Globo Nordeste'],
    season: 'jan-apr',
    priority: 7,
  },
  {
    leagueName: 'Campeonato Baiano',
    alternativeNames: ['Baiano', 'Baianão'],
    channels: ['TVE Bahia', 'Canal GOAT'],
    season: 'jan-mar',
    priority: 7,
  },

  // ==========================================
  // COPINHA (Janeiro)
  // ==========================================
  {
    leagueName: 'Copa São Paulo de Futebol Júnior',
    alternativeNames: [
      'Copinha',
      'Copa SP Junior',
      'Copa São Paulo Júnior',
      'Copinha São Paulo',
    ],
    channels: ['SporTV', 'Paulistão Play', 'CazéTV', 'Record News'],
    season: 'jan',
    priority: 8,
  },

  // ==========================================
  // CONMEBOL (ano todo)
  // ==========================================
  {
    leagueName: 'Copa Libertadores',
    alternativeNames: [
      'CONMEBOL Libertadores',
      'Libertadores',
      'Libertadores da América',
    ],
    channels: ['ESPN', 'Star+', 'Disney+', 'FOX Sports'],
    season: 'year-round',
    priority: 10,
  },
  {
    leagueName: 'Copa Sul-Americana',
    alternativeNames: ['CONMEBOL Sudamericana', 'Sul-Americana', 'Sudamericana'],
    channels: ['ESPN', 'Star+', 'Disney+', 'Paramount+'],
    season: 'year-round',
    priority: 9,
  },
  {
    leagueName: 'Recopa Sul-Americana',
    alternativeNames: ['Recopa', 'Recopa CONMEBOL'],
    channels: ['ESPN', 'Star+'],
    season: 'feb',
    priority: 8,
  },

  // ==========================================
  // UEFA (Europa)
  // ==========================================
  {
    leagueName: 'UEFA Champions League',
    alternativeNames: [
      'Champions League',
      'Liga dos Campeões',
      'UCL',
      'Champions',
      'Liga dos Campeoes',
    ],
    channels: ['TNT Sports', 'Max', 'Space', 'TNT'],
    season: 'sep-may',
    priority: 10,
  },
  {
    leagueName: 'UEFA Europa League',
    alternativeNames: ['Europa League', 'UEL'],
    channels: ['ESPN', 'Star+', 'Disney+'],
    season: 'sep-may',
    priority: 9,
  },
  {
    leagueName: 'UEFA Conference League',
    alternativeNames: ['Conference League', 'UECL'],
    channels: ['ESPN', 'Star+'],
    season: 'sep-may',
    priority: 8,
  },

  // ==========================================
  // LIGAS EUROPEIAS
  // ==========================================
  {
    leagueName: 'Premier League',
    alternativeNames: ['Inglaterra', 'English Premier League', 'EPL'],
    channels: ['ESPN', 'Star+', 'Disney+'],
    season: 'aug-may',
    priority: 10,
  },
  {
    leagueName: 'La Liga',
    alternativeNames: ['LaLiga', 'Espanha', 'Liga Espanhola', 'La Liga EA Sports'],
    channels: ['ESPN', 'Star+', 'Disney+'],
    season: 'aug-may',
    priority: 10,
  },
  {
    leagueName: 'Serie A',
    alternativeNames: ['Itália', 'Serie A TIM', 'Campeonato Italiano', 'Serie A Italia'],
    channels: ['ESPN', 'Star+'],
    season: 'aug-may',
    priority: 9,
  },
  {
    leagueName: 'Bundesliga',
    alternativeNames: ['Alemanha', 'Liga Alemã', 'Campeonato Alemão'],
    channels: ['OneFootball', 'CazéTV', 'Nosso Futebol'],
    season: 'aug-may',
    priority: 9,
  },
  {
    leagueName: 'Ligue 1',
    alternativeNames: ['França', 'Liga Francesa', 'Campeonato Francês'],
    channels: ['CazéTV', 'OneFootball'],
    season: 'aug-may',
    priority: 8,
  },
  {
    leagueName: 'Primeira Liga',
    alternativeNames: ['Portugal', 'Liga Portuguesa', 'Campeonato Português'],
    channels: ['ESPN', 'Star+'],
    season: 'aug-may',
    priority: 8,
  },

  // ==========================================
  // LIGAS AMERICANAS
  // ==========================================
  {
    leagueName: 'MLS',
    alternativeNames: ['Major League Soccer', 'Estados Unidos', 'USA'],
    channels: ['Apple TV+', 'MLS Season Pass'],
    season: 'feb-oct',
    priority: 7,
  },
  {
    leagueName: 'Liga MX',
    alternativeNames: ['México', 'Campeonato Mexicano'],
    channels: ['Star+', 'ESPN'],
    season: 'year-round',
    priority: 7,
  },
  {
    leagueName: 'Campeonato Argentino',
    alternativeNames: [
      'Argentina',
      'Liga Profesional Argentina',
      'Primera División Argentina',
    ],
    channels: ['Star+', 'ESPN', 'Paramount+'],
    season: 'year-round',
    priority: 7,
  },

  // ==========================================
  // SELEÇÕES
  // ==========================================
  {
    leagueName: 'Copa do Mundo',
    alternativeNames: [
      'World Cup',
      'FIFA World Cup',
      'Mundial',
      'Copa do Mundo FIFA',
    ],
    channels: ['Globo', 'SporTV', 'FIFA+'],
    season: 'special', // Apenas em anos de Copa
    priority: 10,
  },
  {
    leagueName: 'Copa América',
    alternativeNames: ['CONMEBOL Copa América', 'Copa America'],
    channels: ['Globo', 'SporTV'],
    season: 'special',
    priority: 10,
  },
  {
    leagueName: 'Eliminatórias da Copa do Mundo',
    alternativeNames: [
      'Eliminatórias',
      'Qualificações Copa do Mundo',
      'WC Qualifiers',
      'Eliminatorias',
    ],
    channels: ['Globo', 'SporTV'],
    season: 'year-round',
    priority: 10,
  },
  {
    leagueName: 'Amistosos Internacionais',
    alternativeNames: ['Amistosos', 'Friendlies', 'Jogos Amistosos'],
    channels: ['SporTV', 'Globo', 'ESPN'],
    season: 'year-round',
    priority: 6,
  },
];

/**
 * Normaliza nome para comparação (remove acentos, espaços, maiúsculas)
 */
export function normalizeLeagueName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove acentos
    .replace(/[^a-z0-9]/g, '') // Remove caracteres especiais
    .trim();
}

/**
 * Busca preset de mapeamento para um campeonato
 */
export function findLeaguePreset(leagueName: string): LeagueMappingPreset | null {
  const normalized = normalizeLeagueName(leagueName);

  // Buscar por match exato ou alternativo
  for (const preset of BRAZIL_LEAGUE_MAPPINGS) {
    // Match direto
    if (normalizeLeagueName(preset.leagueName) === normalized) {
      return preset;
    }

    // Match alternativo
    for (const altName of preset.alternativeNames) {
      if (normalizeLeagueName(altName) === normalized) {
        return preset;
      }
    }

    // Match parcial (se o nome contém o preset ou vice-versa)
    const presetNormalized = normalizeLeagueName(preset.leagueName);
    if (
      normalized.includes(presetNormalized) ||
      presetNormalized.includes(normalized)
    ) {
      return preset;
    }
  }

  return null;
}

/**
 * Retorna lista de todos os campeonatos mapeados (para UI)
 */
export function getAllLeaguePresets(): LeagueMappingPreset[] {
  return BRAZIL_LEAGUE_MAPPINGS;
}
