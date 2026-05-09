/**
 * Serviço de matching automático de canais
 * 
 * Usa fuzzy search para encontrar o canal XUI mais similar
 * ao nome do canal retornado pela API/mapeamento
 */

import Fuse from 'fuse.js';
import { prisma } from '../../config/database.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('ChannelMatcher');

export interface XuiChannel {
  id: number;
  name: string;
  keywords: string[];
  streamUrl?: string;
  priority: number;
}

export interface MatchResult {
  channel: XuiChannel;
  score: number;  // 0-1 (1 = match perfeito)
  matchedBy: 'exact' | 'keyword' | 'fuzzy' | 'learned';
}

export class ChannelMatcherService {
  private configId: number;
  private channels: XuiChannel[] = [];
  private fuse: Fuse<XuiChannel> | null = null;
  private learnedMappings: Map<string, number> = new Map();
  
  constructor(configId: number) {
    this.configId = configId;
  }
  
  /**
   * Inicializa o matcher carregando canais e mapeamentos
   */
  async initialize(): Promise<void> {
    // Carregar canais cadastrados
    const dbChannels = await prisma.footballChannel.findMany({
      where: { configId: this.configId, isActive: true }
    });
    
    this.channels = dbChannels.map(ch => {
      const keywords = JSON.parse(ch.keywords || '[]');
      const customKeywords = JSON.parse(ch.customKeywords || '[]');
      
      return {
        id: ch.id,
        name: ch.xuiStreamName,
        keywords: [...keywords, ...customKeywords],
        streamUrl: ch.streamUrl || undefined,
        priority: ch.priority
      };
    });
    
    // Configurar Fuse.js para fuzzy search
    this.fuse = new Fuse(this.channels, {
      keys: ['name', 'keywords'],
      threshold: 0.4,  // 0 = match exato, 1 = match qualquer coisa
      includeScore: true,
      ignoreLocation: true,
    });
    
    // Carregar mapeamentos aprendidos
    const mappings = await prisma.channelMapping.findMany();
    for (const m of mappings) {
      this.learnedMappings.set(m.apiChannelName.toLowerCase(), m.xuiChannelId);
    }
    
    logger.info(`ChannelMatcher inicializado com ${this.channels.length} canais e ${this.learnedMappings.size} mapeamentos`);
  }
  
  /**
   * Normaliza nome do canal para comparação
   */
  private normalize(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')  // Remove acentos
      .replace(/[^a-z0-9]/g, '')         // Remove caracteres especiais
      .replace(/tv|hd|fhd|uhd|4k|brasil|brazil/gi, '')  // Remove sufixos comuns
      .trim();
  }
  
  /**
   * Encontra o melhor canal XUI para um nome de canal da API
   */
  findBestMatch(apiChannelName: string): MatchResult | null {
    if (!apiChannelName || this.channels.length === 0) {
      return null;
    }
    
    const normalizedApi = this.normalize(apiChannelName);
    
    // 1. PRIORIDADE 1: Mapeamento aprendido
    const learnedId = this.learnedMappings.get(apiChannelName.toLowerCase());
    if (learnedId) {
      const channel = this.channels.find(c => c.id === learnedId);
      if (channel) {
        return { channel, score: 1.0, matchedBy: 'learned' };
      }
    }
    
    // 2. PRIORIDADE 2: Match exato (normalizado)
    for (const channel of this.channels) {
      if (this.normalize(channel.name) === normalizedApi) {
        return { channel, score: 1.0, matchedBy: 'exact' };
      }
    }
    
    // 3. PRIORIDADE 3: Match por keyword
    for (const channel of this.channels) {
      for (const keyword of channel.keywords) {
        const normalizedKeyword = this.normalize(keyword);
        if (normalizedApi.includes(normalizedKeyword) || 
            normalizedKeyword.includes(normalizedApi)) {
          return { channel, score: 0.9, matchedBy: 'keyword' };
        }
      }
    }
    
    // 4. PRIORIDADE 4: Fuzzy search
    if (this.fuse) {
      const results = this.fuse.search(apiChannelName);
      if (results.length > 0 && results[0].score !== undefined) {
        const score = 1 - results[0].score;  // Fuse retorna 0 = perfeito
        if (score >= 0.6) {  // Threshold mínimo de 60%
          return { 
            channel: results[0].item, 
            score, 
            matchedBy: 'fuzzy' 
          };
        }
      }
    }
    
    logger.warn(`Nenhum match encontrado para canal: "${apiChannelName}"`);
    return null;
  }
  
  /**
   * Encontra o melhor canal para uma lista de canais da API
   * Retorna o primeiro match válido
   */
  findBestMatchFromList(apiChannels: string[]): MatchResult | null {
    for (const apiChannel of apiChannels) {
      const match = this.findBestMatch(apiChannel);
      if (match) {
        return match;
      }
    }
    return null;
  }
  
  /**
   * Salva um mapeamento manual (para aprendizado)
   */
  async saveMapping(apiChannelName: string, xuiChannelId: number): Promise<void> {
    const channel = this.channels.find(c => c.id === xuiChannelId);
    if (!channel) return;
    
    await prisma.channelMapping.upsert({
      where: { apiChannelName },
      create: {
        apiChannelName,
        xuiChannelId,
        xuiChannelName: channel.name,
        mappingType: 'manual',
        useCount: 1
      },
      update: {
        xuiChannelId,
        xuiChannelName: channel.name,
        mappingType: 'manual',
        useCount: { increment: 1 }
      }
    });
    
    this.learnedMappings.set(apiChannelName.toLowerCase(), xuiChannelId);
    logger.info(`Mapeamento salvo: "${apiChannelName}" → "${channel.name}"`);
  }
  
  /**
   * Incrementa uso de um mapeamento (para ranking de sugestões)
   */
  async incrementUsage(apiChannelName: string): Promise<void> {
    await prisma.channelMapping.updateMany({
      where: { apiChannelName },
      data: { useCount: { increment: 1 } }
    });
  }
}

