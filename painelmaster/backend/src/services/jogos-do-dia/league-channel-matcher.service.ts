/**
 * ⚽ SERVIÇO DE MAPEAMENTO INTELIGENTE POR CAMPEONATO
 * 
 * ESTRATÉGIA HIERÁRQUICA:
 * 1️⃣ PRIORIDADE MÁXIMA: Mapeamento manual por campeonato (usuário configurou)
 * 2️⃣ PRIORIDADE ALTA: API GE retornou canais direto (informação específica do jogo!)
 * 3️⃣ PRIORIDADE MÉDIA: Preset brasileiro (banco de dados estático - fallback genérico)
 * 4️⃣ PRIORIDADE BAIXA: Mapeamento por nome de canal (fuzzy search - último recurso)
 * 
 * ⚠️ IMPORTANTE: API direta tem prioridade sobre preset porque a API retorna
 * o canal ESPECÍFICO do jogo (ex: Disney), enquanto preset é genérico (ex: ESPN)
 */

import { prisma } from '../../config/database.js';
import { createLogger } from '../../utils/logger.js';
import { ChannelMatcherService, type MatchResult } from './channel-matcher.service.js';
import {
  findLeaguePreset,
  normalizeLeagueName,
  type LeagueMappingPreset,
} from './league-mappings-br.js';

const logger = createLogger('LeagueChannelMatcher');

export interface LeagueMatchResult {
  footballChannelId: number;
  xuiChannelName: string;
  matchedBy: 'manual' | 'preset' | 'api-direct' | 'channel-fallback';
  score: number; // 0-1 (1 = match perfeito)
  leagueName: string;
}

export class LeagueChannelMatcherService {
  private configId: number;
  private channelMatcher: ChannelMatcherService;
  private footballChannels: Map<number, { xuiStreamId: number; name: string; streamUrl?: string }> =
    new Map();

  constructor(configId: number) {
    this.configId = configId;
    this.channelMatcher = new ChannelMatcherService(configId);
  }

  /**
   * Inicializa o serviço
   */
  async initialize(): Promise<void> {
    // Inicializar matcher antigo (fallback)
    await this.channelMatcher.initialize();

    // Carregar canais cadastrados
    const channels = await prisma.footballChannel.findMany({
      where: { configId: this.configId, isActive: true },
      select: { id: true, xuiStreamId: true, xuiStreamName: true, streamUrl: true },
    });

    for (const ch of channels) {
      this.footballChannels.set(ch.id, {
        xuiStreamId: ch.xuiStreamId,
        name: ch.xuiStreamName,
        streamUrl: ch.streamUrl || undefined,
      });
    }

    logger.info(
      `LeagueChannelMatcher inicializado: ${this.footballChannels.size} canais disponíveis`
    );
  }

  /**
   * 🎯 MÉTODO PRINCIPAL: Encontrar canal para um jogo
   * 
   * @param leagueName Nome do campeonato (da API GE)
   * @param apiChannels Canais retornados pela API GE (array)
   * @returns Canal XUI mapeado ou null
   */
  async findChannelForMatch(
    leagueName: string,
    apiChannels: string[] = []
  ): Promise<LeagueMatchResult | null> {
    // 1️⃣ PRIORIDADE 1: Mapeamento manual salvo no banco
    const manualMapping = await this.findManualMapping(leagueName);
    if (manualMapping) {
      logger.info(
        `✅ [P1-MANUAL] ${leagueName} → ${manualMapping.xuiChannelName} (mapeamento manual)`
      );
      return manualMapping;
    }

    // 2️⃣ PRIORIDADE 2: API GE retornou canais direto (informação ESPECÍFICA do jogo!)
    // ⚠️ IMPORTANTE: API tem prioridade sobre preset porque retorna canal específico
    // Ex: API diz "Disney" para um jogo específico, mesmo que preset diga "ESPN" para a liga
    if (apiChannels.length > 0) {
      const apiDirectMapping = await this.findApiDirectMapping(leagueName, apiChannels);
      if (apiDirectMapping) {
        logger.info(
          `✅ [P2-API] ${leagueName} → ${apiDirectMapping.xuiChannelName} (API retornou: ${apiChannels.join(', ')})`
        );
        return apiDirectMapping;
      }
    }

    // 3️⃣ PRIORIDADE 3: Preset brasileiro (banco de dados estático - fallback genérico)
    const presetMapping = await this.findPresetMapping(leagueName);
    if (presetMapping) {
      logger.info(
        `✅ [P3-PRESET] ${leagueName} → ${presetMapping.xuiChannelName} (preset brasileiro)`
      );
      return presetMapping;
    }

    // 4️⃣ PRIORIDADE 4: Fallback para mapeamento por nome de canal (antigo)
    if (apiChannels.length > 0) {
      const fallbackMapping = await this.findChannelFallback(leagueName, apiChannels);
      if (fallbackMapping) {
        logger.info(
          `⚠️ [P4-FALLBACK] ${leagueName} → ${fallbackMapping.xuiChannelName} (fuzzy match: ${(fallbackMapping.score * 100).toFixed(0)}%)`
        );
        return fallbackMapping;
      }
    }

    logger.warn(`❌ NENHUM CANAL ENCONTRADO para: ${leagueName}`);
    return null;
  }

  /**
   * 1️⃣ Busca mapeamento manual (salvo pelo usuário)
   */
  private async findManualMapping(leagueName: string): Promise<LeagueMatchResult | null> {
    try {
      const mapping = await prisma.leagueChannelMapping.findUnique({
        where: {
          configId_leagueName: {
            configId: this.configId,
            leagueName: normalizeLeagueName(leagueName),
          },
        },
      });

      if (!mapping || !mapping.isActive) return null;

      const channel = this.footballChannels.get(mapping.footballChannelId);
      if (!channel) return null;

      // Incrementar uso
      await prisma.leagueChannelMapping.update({
        where: { id: mapping.id },
        data: { useCount: { increment: 1 } },
      });

      return {
        footballChannelId: mapping.footballChannelId,
        xuiChannelName: mapping.xuiChannelName,
        matchedBy: 'manual',
        score: 1.0,
        leagueName,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * 2️⃣ Busca preset brasileiro (banco de dados estático)
   */
  private async findPresetMapping(leagueName: string): Promise<LeagueMatchResult | null> {
    const preset = findLeaguePreset(leagueName);
    if (!preset) return null;

    // Tentar mapear primeiro canal do preset
    for (const channelName of preset.channels) {
      const channel = await this.findXuiChannelByName(channelName);
      if (channel) {
        return {
          footballChannelId: channel.id,
          xuiChannelName: channel.name,
          matchedBy: 'preset',
          score: 0.95, // Alta confiança em presets
          leagueName,
        };
      }
    }

    return null;
  }

  /**
   * 3️⃣ API GE retornou canais direto - tentar mapear
   */
  private async findApiDirectMapping(
    leagueName: string,
    apiChannels: string[]
  ): Promise<LeagueMatchResult | null> {
    for (const apiChannel of apiChannels) {
      const channel = await this.findXuiChannelByName(apiChannel);
      if (channel) {
        return {
          footballChannelId: channel.id,
          xuiChannelName: channel.name,
          matchedBy: 'api-direct',
          score: 0.9,
          leagueName,
        };
      }
    }

    return null;
  }

  /**
   * 4️⃣ Fallback: Usar matcher antigo (fuzzy search por nome de canal)
   */
  private async findChannelFallback(
    leagueName: string,
    apiChannels: string[]
  ): Promise<LeagueMatchResult | null> {
    const match = this.channelMatcher.findBestMatchFromList(apiChannels);
    if (!match) return null;

    // Buscar footballChannelId pelo xuiStreamId
    for (const [id, channel] of this.footballChannels.entries()) {
      if (channel.name === match.channel.name) {
        return {
          footballChannelId: id,
          xuiChannelName: channel.name,
          matchedBy: 'channel-fallback',
          score: match.score,
          leagueName,
        };
      }
    }

    return null;
  }

  /**
   * Mapa de aliases para canais (API → nomes comuns no XUI)
   * ⚠️ IMPORTANTE: A API GE pode retornar nomes diferentes dos cadastrados
   */
  private static CHANNEL_ALIASES: Record<string, string[]> = {
    // Disney
    'disney': ['disney', 'disneyplus', 'disney+', 'disneyhd', 'disney hd', 'disney plus'],
    'disney+': ['disney', 'disneyplus', 'disney+', 'disneyhd', 'disney hd', 'disney plus'],
    'disneyplus': ['disney', 'disneyplus', 'disney+', 'disneyhd', 'disney hd'],
    // ESPN
    'espn': ['espn', 'espnbrasil', 'espn brasil', 'espn hd', 'espnhd'],
    'espn brasil': ['espn', 'espnbrasil', 'espn brasil', 'espn hd'],
    'espn 2': ['espn2', 'espn 2', 'espn2hd'],
    'espn 3': ['espn3', 'espn 3', 'espn3hd', 'espn extra'],
    'espn 4': ['espn4', 'espn 4', 'espn4hd'],
    // Fox Sports
    'fox sports': ['foxsports', 'fox sports', 'foxsportshd', 'fox sports hd'],
    'fox sports 2': ['foxsports2', 'fox sports 2'],
    // SporTV
    'sportv': ['sportv', 'sportv1', 'sportv 1', 'sportvhd'],
    'sportv 2': ['sportv2', 'sportv 2'],
    'sportv 3': ['sportv3', 'sportv 3'],
    // Premiere
    'premiere': ['premiere', 'premierehd', 'premiere hd', 'premiere fc', 'premierefc'],
    'premiere fc': ['premierefc', 'premiere fc', 'premiere'],
    'premiere clubes': ['premiereclubes', 'premiere clubes', 'premiere'],
    // TNT/Max
    'tnt': ['tnt', 'tntsports', 'tnt sports', 'tnthd'],
    'tnt sports': ['tntsports', 'tnt sports', 'tnt'],
    'max': ['max', 'hbomax', 'hbo max'],
    // Star+
    'star+': ['star', 'starplus', 'star+', 'starhd'],
    'starplus': ['star', 'starplus', 'star+'],
    // Globo
    'globo': ['globo', 'tvglobo', 'tv globo', 'globohd', 'rede globo'],
    // Band
    'band': ['band', 'bandeirantes', 'bandhd', 'tv band'],
    // Record
    'record': ['record', 'recordtv', 'record tv', 'recordhd'],
    'record news': ['recordnews', 'record news'],
    // CazéTV
    'cazetv': ['cazetv', 'caze tv', 'caze', 'cazé tv', 'cazétv'],
    // Paramount+
    'paramount+': ['paramount', 'paramountplus', 'paramount+'],
  };

  /**
   * Helper: Buscar canal XUI por nome (com aliases e fuzzy matching)
   */
  private async findXuiChannelByName(
    channelName: string
  ): Promise<{ id: number; name: string; streamUrl?: string } | null> {
    const normalized = normalizeLeagueName(channelName);
    
    // Obter aliases para o canal da API
    const aliases = LeagueChannelMatcherService.CHANNEL_ALIASES[channelName.toLowerCase()] || 
                    LeagueChannelMatcherService.CHANNEL_ALIASES[normalized] || 
                    [normalized];

    // Buscar por match exato ou parcial em todos os aliases
    for (const [id, channel] of this.footballChannels.entries()) {
      const channelNormalized = normalizeLeagueName(channel.name);

      // Match exato com nome original
      if (channelNormalized === normalized) {
        return { id, name: channel.name, streamUrl: channel.streamUrl };
      }

      // Match com aliases
      for (const alias of aliases) {
        const aliasNormalized = normalizeLeagueName(alias);
        if (channelNormalized === aliasNormalized) {
          return { id, name: channel.name, streamUrl: channel.streamUrl };
        }
        // Match parcial (se um contém o outro)
        if (channelNormalized.includes(aliasNormalized) || aliasNormalized.includes(channelNormalized)) {
          return { id, name: channel.name, streamUrl: channel.streamUrl };
        }
      }

      // Match parcial com nome original
      if (channelNormalized.includes(normalized) || normalized.includes(channelNormalized)) {
        return { id, name: channel.name, streamUrl: channel.streamUrl };
      }
    }

    return null;
  }

  /**
   * 💾 Salvar mapeamento manual (usuário configurou)
   */
  async saveManualMapping(
    leagueName: string,
    footballChannelId: number,
    priority: number = 0
  ): Promise<void> {
    const channel = this.footballChannels.get(footballChannelId);
    if (!channel) {
      throw new Error(`Canal ${footballChannelId} não encontrado`);
    }

    const normalizedName = normalizeLeagueName(leagueName);

    await prisma.leagueChannelMapping.upsert({
      where: {
        configId_leagueName: {
          configId: this.configId,
          leagueName: normalizedName,
        },
      },
      create: {
        configId: this.configId,
        leagueName: normalizedName,
        footballChannelId,
        xuiChannelName: channel.name,
        mappingType: 'manual',
        priority,
        useCount: 1,
        isActive: true,
      },
      update: {
        footballChannelId,
        xuiChannelName: channel.name,
        priority,
        isActive: true,
        useCount: { increment: 1 },
      },
    });

    logger.info(`💾 Mapeamento manual salvo: "${leagueName}" → "${channel.name}"`);
  }

  /**
   * 🗑️ Remover mapeamento manual
   */
  async removeManualMapping(leagueName: string): Promise<void> {
    const normalizedName = normalizeLeagueName(leagueName);

    await prisma.leagueChannelMapping.deleteMany({
      where: {
        configId: this.configId,
        leagueName: normalizedName,
      },
    });

    logger.info(`🗑️ Mapeamento removido: "${leagueName}"`);
  }

  /**
   * 📋 Listar todos os mapeamentos salvos
   */
  async listManualMappings(): Promise<
    Array<{
      leagueName: string;
      xuiChannelName: string;
      priority: number;
      useCount: number;
    }>
  > {
    const mappings = await prisma.leagueChannelMapping.findMany({
      where: { configId: this.configId, isActive: true },
      orderBy: [{ priority: 'desc' }, { useCount: 'desc' }],
    });

    return mappings.map((m) => ({
      leagueName: m.leagueName,
      xuiChannelName: m.xuiChannelName,
      priority: m.priority,
      useCount: m.useCount,
    }));
  }

  /**
   * 📊 Estatísticas de uso
   */
  async getStats(): Promise<{
    totalMappings: number;
    manualMappings: number;
    totalUses: number;
  }> {
    const mappings = await prisma.leagueChannelMapping.findMany({
      where: { configId: this.configId, isActive: true },
    });

    return {
      totalMappings: mappings.length,
      manualMappings: mappings.filter((m) => m.mappingType === 'manual').length,
      totalUses: mappings.reduce((sum, m) => sum + m.useCount, 0),
    };
  }
}
