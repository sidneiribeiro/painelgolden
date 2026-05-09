import BannerGeneratorService from './banner-generator.service.js';
import VideoGeneratorService from './video-generator.service.js';
import { prisma } from '../../config/database.js';
import path from 'path';
import fs from 'fs';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('PostImportMarketing');

interface ImportedContent {
  id: number;
  title: string;
  type: 'movie' | 'series';
  posterUrl: string;
  backdropUrl?: string;
  synopsis: string;
  year: string;
  rating: number;
  genres: string[];
  duration?: string;
  tmdbId?: number;
}

export class PostImportMarketingService {
  async processImportedContent(importId: string, content: ImportedContent[]): Promise<void> {
    logger.info(`Processando ${content.length} itens da importação ${importId}`);

    // 1. Buscar configurações
    const config = await prisma.marketingConfig.findFirst();
    if (!config) {
      logger.warn('Configuração não encontrada, pulando geração de banners');
      return;
    }

    // 2. Limitar a maxBannersPerImport (padrão: 30)
    const limitedContent = content.slice(0, config.maxBannersPerImport);
    logger.info(`Gerando banners para ${limitedContent.length} itens`);

    // 3. Limpar banners/vídeos antigos
    await this.cleanOldBanners();

    // 4. Criar diretórios
    const verticalDir = path.join(process.cwd(), 'storage', 'banners', 'vertical');
    const horizontalDir = path.join(process.cwd(), 'storage', 'banners', 'horizontal');
    const videoDir = path.join(process.cwd(), 'storage', 'banners', 'videos');
    
    fs.mkdirSync(verticalDir, { recursive: true });
    fs.mkdirSync(horizontalDir, { recursive: true });
    fs.mkdirSync(videoDir, { recursive: true });

    // 5. Gerar banners
    const horizontalPaths: string[] = [];
    
    for (let i = 0; i < limitedContent.length; i++) {
      const item = limitedContent[i];
      logger.info(`Gerando banner ${i + 1}/${limitedContent.length}: ${item.title}`);

      try {
        // Banner vertical
        const verticalPath = await BannerGeneratorService.generateVerticalBanner(item);
        
        // Banner horizontal
        const horizontalPath = await BannerGeneratorService.generateHorizontalBanner(item);
        horizontalPaths.push(horizontalPath);

        // Salvar no banco
        await prisma.generatedBanner.create({
          data: {
            importId,
            type: item.type,
            orientation: 'vertical',
            contentTitle: item.title,
            tmdbId: item.tmdbId,
            filePath: verticalPath,
          },
        });

        await prisma.generatedBanner.create({
          data: {
            importId,
            type: item.type,
            orientation: 'horizontal',
            contentTitle: item.title,
            tmdbId: item.tmdbId,
            filePath: horizontalPath,
          },
        });
      } catch (error: any) {
        logger.error(`Erro ao gerar banner para ${item.title}:`, error.message);
      }
    }

    // 6. Gerar vídeo
    if (horizontalPaths.length > 0) {
      logger.info('Gerando vídeo promocional...');
      
      const videoType = limitedContent[0].type; // filmes ou series
      const musicPath = videoType === 'movie' 
        ? config.videoMusicFilmes 
        : config.videoMusicSeries;

      const videoPath = path.join(videoDir, `promo_${videoType}_${Date.now()}.mp4`);
      
      try {
        await VideoGeneratorService.generateVideo(horizontalPaths, videoPath, {
          bannerDuration: 3,
          transitionDuration: 0.5,
          musicPath: musicPath || undefined,
        });

        await prisma.generatedVideo.create({
          data: {
            importId,
            type: videoType === 'movie' ? 'movies' : 'series',
            filePath: videoPath,
            duration: horizontalPaths.length * 3,
            bannerCount: horizontalPaths.length,
          },
        });

        logger.info(`✅ Vídeo gerado: ${videoPath}`);
      } catch (error: any) {
        logger.error('Erro ao gerar vídeo:', error.message);
      }
    }

    logger.info(`✅ ${limitedContent.length} banners e vídeo gerados!`);
  }

  private async cleanOldBanners(): Promise<void> {
    // Apagar banners de importações anteriores (manter apenas os últimos)
    const oldBanners = await prisma.generatedBanner.findMany({
      orderBy: { createdAt: 'desc' },
      skip: 100, // Manter os 100 mais recentes
    });
    
    for (const banner of oldBanners) {
      try {
        if (fs.existsSync(banner.filePath)) {
          fs.unlinkSync(banner.filePath);
        }
      } catch (e) {
        // Ignorar erros de arquivo não encontrado
      }
    }
    
    if (oldBanners.length > 0) {
      await prisma.generatedBanner.deleteMany({
        where: {
          id: { in: oldBanners.map(b => b.id) }
        }
      });
    }

    // Apagar vídeos antigos (manter apenas os últimos 10)
    const oldVideos = await prisma.generatedVideo.findMany({
      orderBy: { createdAt: 'desc' },
      skip: 10,
    });
    
    for (const video of oldVideos) {
      try {
        if (fs.existsSync(video.filePath)) {
          fs.unlinkSync(video.filePath);
        }
      } catch (e) {
        // Ignorar erros
      }
    }
    
    if (oldVideos.length > 0) {
      await prisma.generatedVideo.deleteMany({
        where: {
          id: { in: oldVideos.map(v => v.id) }
        }
      });
    }

    logger.info('Banners e vídeos antigos removidos');
  }
}

export default new PostImportMarketingService();

