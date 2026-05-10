import BannerGeneratorService, { ContentData } from './banner-generator.service.js';
import VideoGeneratorService from './video-generator.service.js';
import ConteudosAtualizadosService from './conteudos-atualizados.service.js';
import { prisma } from '../../config/database.js';
import { createLogger } from '../../utils/logger.js';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';

export interface ImportedContent {
  id: number;
  title: string;
  type: 'movie' | 'series';
  tmdbId?: number;
  posterUrl: string;
  backdropUrl?: string;
  synopsis: string;
  year: string;
  rating: number;
  duration?: string;
  seasons?: string;
  genres: string[];
}

const logger = createLogger('PostImportHook');

class PostImportHookService {
  private toAbsoluteStoragePath(filePath: string): string {
    // filePath normalmente vem como "/storage/...."
    if (filePath.startsWith('/storage/')) return path.join(process.cwd(), filePath.substring(1));
    if (filePath.startsWith('storage/')) return path.join(process.cwd(), filePath);
    // Se for absoluto real, retorna como está
    if (path.isAbsolute(filePath)) return filePath;
    return path.join(process.cwd(), filePath);
  }

  private async deleteVideosByTypeAndFiles(types: string[], videosDir: string): Promise<number> {
    const existing = await prisma.generatedVideo.findMany({
      where: { type: { in: types } },
      select: { id: true, filePath: true, type: true },
    });

    // Apagar arquivos referenciados no banco
    for (const v of existing) {
      try {
        const abs = this.toAbsoluteStoragePath(v.filePath);
        if (fsSync.existsSync(abs)) {
          await fs.unlink(abs);
        }
      } catch (e: any) {
        logger.warn(`[PostImportHook] ⚠️ Falha ao remover arquivo de vídeo antigo (${v.type}): ${e?.message || String(e)}`);
      }
    }

    // Apagar quaisquer sobras no diretório (mesmo que não estejam no banco)
    try {
      if (fsSync.existsSync(videosDir)) {
        const files = await fs.readdir(videosDir);
        const typeMatchers = types.map(t => t.toLowerCase());
        for (const f of files) {
          const lower = f.toLowerCase();
          // Limpar arquivos temporários do ffmpeg (sobras de travamentos/kill)
          if (lower.startsWith('temp_list_') && lower.endsWith('.txt')) {
            try { await fs.unlink(path.join(videosDir, f)); } catch {}
            continue;
          }
          // remove promo_<type>_*.mp4 e também legado promo_movie_*.mp4
          const matchesType =
            typeMatchers.some(t => lower.startsWith(`promo_${t}_`)) ||
            (typeMatchers.includes('movies') && lower.startsWith('promo_movie_'));

          if (matchesType && lower.endsWith('.mp4')) {
            try {
              await fs.unlink(path.join(videosDir, f));
            } catch {}
          }
        }
      }
    } catch (e: any) {
      logger.warn(`[PostImportHook] ⚠️ Falha ao limpar diretório de vídeos (${videosDir}): ${e?.message || String(e)}`);
    }

    const deleted = await prisma.generatedVideo.deleteMany({ where: { type: { in: types } } });
    return deleted.count;
  }

  async processImportedContent(
    contents: ImportedContent[],
    importId: string,
    xuiServerId?: string,  // ID do servidor XUI (tabela xui_servers)
    streamServerId?: number,  // ID do servidor de streaming (tabela servers) - OBRIGATÓRIO para vincular canais
    bouquetId?: number  // ID do bouquet para adicionar canais (padrão: 1 = "All Channels")
  ): Promise<{ success: boolean; bannersGenerated: number; videoPaths?: { movies?: string; series?: string }; error?: string }> {
    logger.info(`[PostImportHook] Iniciando processamento de ${contents.length} itens...`);

    try {
      // 🔍 DETERMINAR TIPO DA IMPORTAÇÃO (movies ou series)
      const movieCount = contents.filter(c => c.type === 'movie').length;
      const seriesCount = contents.filter(c => c.type === 'series').length;
      const importType: 'movies' | 'series' | 'mixed' = 
        movieCount > 0 && seriesCount === 0 ? 'movies' :
        seriesCount > 0 && movieCount === 0 ? 'series' :
        'mixed';
      
      logger.info(`[PostImportHook] 📊 Tipo de importação detectado: ${importType} (Filmes: ${movieCount}, Séries: ${seriesCount})`);

      // 🧹 LIMPAR APENAS BANNERS/VÍDEOS DO TIPO IMPORTADO
      const storageBase = path.join(process.cwd(), 'storage', 'banners');
      try {
        const videosDir = path.join(storageBase, 'videos');
        if (importType === 'movies') {
          // Limpar apenas banners e vídeos de FILMES
          const deletedBanners = await prisma.generatedBanner.deleteMany({ where: { type: 'movie' } });
          const deletedVideosCount = await this.deleteVideosByTypeAndFiles(['movies', 'movie'], videosDir);
          logger.info(`[PostImportHook] 🧹 Deletados ${deletedBanners.count} banners e ${deletedVideosCount} vídeos de FILMES do banco + disco`);
          
          // Remover apenas diretório de filmes
          const moviesDir = path.join(storageBase, 'movies');
          await fs.rm(moviesDir, { recursive: true, force: true });
          await fs.mkdir(path.join(moviesDir, 'vertical'), { recursive: true });
          await fs.mkdir(path.join(moviesDir, 'horizontal'), { recursive: true });
          logger.info('[PostImportHook] 🧹 Limpou apenas banners e vídeos de FILMES (manteve séries)');
        } else if (importType === 'series') {
          // Limpar apenas banners e vídeos de SÉRIES
          const deletedBanners = await prisma.generatedBanner.deleteMany({ where: { type: 'series' } });
          const deletedVideosCount = await this.deleteVideosByTypeAndFiles(['series'], videosDir);
          logger.info(`[PostImportHook] 🧹 Deletados ${deletedBanners.count} banners e ${deletedVideosCount} vídeos de SÉRIES do banco + disco`);
          
          // Remover apenas diretório de séries
          const seriesDir = path.join(storageBase, 'series');
          await fs.rm(seriesDir, { recursive: true, force: true });
          await fs.mkdir(path.join(seriesDir, 'vertical'), { recursive: true });
          await fs.mkdir(path.join(seriesDir, 'horizontal'), { recursive: true });
          logger.info('[PostImportHook] 🧹 Limpou apenas banners e vídeos de SÉRIES (manteve filmes)');
        } else {
          // Mixed: limpar tudo (comportamento antigo para segurança)
          const deletedBanners = await prisma.generatedBanner.deleteMany({});
          const deletedVideosCount = await this.deleteVideosByTypeAndFiles(['movies', 'movie', 'series', 'mixed'], videosDir);
          logger.info(`[PostImportHook] 🧹 Deletados ${deletedBanners.count} banners e ${deletedVideosCount} vídeos (importação mista) do banco + disco`);
          
          await fs.rm(storageBase, { recursive: true, force: true });
          await fs.mkdir(path.join(storageBase, 'movies', 'vertical'), { recursive: true });
          await fs.mkdir(path.join(storageBase, 'movies', 'horizontal'), { recursive: true });
          await fs.mkdir(path.join(storageBase, 'series', 'vertical'), { recursive: true });
          await fs.mkdir(path.join(storageBase, 'series', 'horizontal'), { recursive: true });
          logger.info('[PostImportHook] 🧹 Limpou todos os banners e vídeos (importação mista)');
        }
        
        // Garantir que diretório de vídeos existe
        await fs.mkdir(path.join(storageBase, 'videos'), { recursive: true });
      } catch (cleanErr: any) {
        logger.warn('[PostImportHook] Falha ao limpar banners/vídeos anteriores:', cleanErr.message);
      }

      const config = await prisma.marketingConfig.findFirst();
      // ⚠️ OTIMIZAÇÃO CRÍTICA: Reduzir limite padrão de 30 para 10 para evitar sobrecarga
      const maxBanners = Math.min(config?.maxBannersPerImport ?? 10, 10); // Máximo de 10 banners
      
      // 🔧 FILTRO: Remover itens com título vazio ou "Sem título"
      const validContents = contents.filter(c => {
        const hasValidTitle = c.title && c.title.trim().length > 0 && c.title.trim() !== 'Sem título';
        if (!hasValidTitle) {
          logger.warn(`[PostImportHook] ⚠️ Pulando item sem título válido: "${c.title}" (tipo: ${c.type})`);
        }
        return hasValidTitle;
      });
      
      const limited = validContents.slice(0, maxBanners);
      logger.info(`[PostImportHook] Processando ${limited.length}/${validContents.length} válidos de ${contents.length} total (limite ${maxBanners})`);

      const bannerContents: ContentData[] = limited.map(c => ({
        id: c.id,
        title: c.title,
        year: c.year,
        rating: c.rating > 0 ? c.rating : 7.0,
        duration: c.duration,
        seasons: c.seasons,
        genres: c.genres?.length ? c.genres : ['Gênero não informado'],
        synopsis: (c.synopsis && c.synopsis.trim().length > 0) ? c.synopsis : 'Sinopse indisponível.',
        posterUrl: c.posterUrl,
        backdropUrl: c.backdropUrl,
        type: c.type,
        tmdbId: c.tmdbId,
      }));

      const banners = await BannerGeneratorService.generateBatchBanners(bannerContents, importId, maxBanners);
      logger.info(`[PostImportHook] Banners gerados: V=${banners.vertical.length} H=${banners.horizontal.length}`);

      // 🎬 GERAR VÍDEOS APENAS DO TIPO IMPORTADO
      const videoPaths: { movies?: string; series?: string } = {};

      // 🎬 VÍDEO DE FILMES (apenas se importação for de filmes)
      if (importType === 'movies' || importType === 'mixed') {
        const movieContents = limited.filter(c => c.type === 'movie');
        if (movieContents.length > 0) {
          const movieBanners = banners.horizontal.filter((_, i) => limited[i]?.type === 'movie');
          logger.info(`[PostImportHook] 🎬 Verificando vídeo de filmes: ${movieBanners.length} banners encontrados`);
          if (movieBanners.length >= 3) {
            const movieBannerPaths = movieBanners.map(p => {
              const absPath = p.startsWith('/') ? path.join(process.cwd(), p) : path.join(process.cwd(), p);
              // Verificar se o arquivo existe
              if (!fsSync.existsSync(absPath)) {
                logger.warn(`[PostImportHook] ⚠️ Banner não encontrado: ${absPath}`);
              }
              return absPath;
            }).filter(p => fsSync.existsSync(p)); // Filtrar apenas banners que existem
            
            if (movieBannerPaths.length >= 3) {
              // ⚠️ OTIMIZAÇÃO CRÍTICA: Limitar número de banners no vídeo para evitar sobrecarga
              const MAX_BANNERS_IN_VIDEO = 10; // Máximo de 10 banners por vídeo
              const limitedBannerPaths = movieBannerPaths.slice(0, MAX_BANNERS_IN_VIDEO);
              
              logger.info(`[PostImportHook] 🎬 Iniciando geração de vídeo de filmes com ${limitedBannerPaths.length}/${movieBannerPaths.length} banners (limite: ${MAX_BANNERS_IN_VIDEO})...`);
              try {
                // ⚠️ OTIMIZAÇÃO: Usar qualidade medium e timeout já está no video-generator
                const movieVideoPath = await VideoGeneratorService.generatePromoVideo(
                  limitedBannerPaths,
                  'movies',
                  importId,
                  { outputQuality: 'medium' } // Qualidade média para economizar recursos
                );
                
                videoPaths.movies = movieVideoPath;
                logger.info(`[PostImportHook] ✅ Vídeo de filmes gerado com sucesso: ${movieVideoPath}`);
              } catch (error: any) {
                logger.error(`[PostImportHook] ❌ Erro ao gerar vídeo de filmes: ${error.message}`);
                if (error.stack) {
                  logger.error(`[PostImportHook] ❌ Stack: ${error.stack}`);
                }
                // Não falhar o processo, apenas logar o erro
              }
            } else {
              logger.warn(`[PostImportHook] ⚠️ Poucos banners válidos de filmes (${movieBannerPaths.length}/3) para gerar vídeo`);
            }
          } else {
            logger.warn(`[PostImportHook] ⚠️ Poucos banners de filmes (${movieBanners.length}/3) para gerar vídeo`);
          }
        } else {
          logger.info(`[PostImportHook] ℹ️ Nenhum filme encontrado para gerar vídeo`);
        }
      }

      // 🎬 VÍDEO DE SÉRIES (apenas se importação for de séries)
      if (importType === 'series' || importType === 'mixed') {
        const seriesContents = limited.filter(c => c.type === 'series');
        if (seriesContents.length > 0) {
          const seriesBanners = banners.horizontal.filter((_, i) => limited[i]?.type === 'series');
          logger.info(`[PostImportHook] 🎬 Verificando vídeo de séries: ${seriesBanners.length} banners encontrados`);
          if (seriesBanners.length >= 3) {
            const seriesBannerPaths = seriesBanners.map(p => {
              const absPath = p.startsWith('/') ? path.join(process.cwd(), p) : path.join(process.cwd(), p);
              // Verificar se o arquivo existe
              if (!fsSync.existsSync(absPath)) {
                logger.warn(`[PostImportHook] ⚠️ Banner não encontrado: ${absPath}`);
              }
              return absPath;
            }).filter(p => fsSync.existsSync(p)); // Filtrar apenas banners que existem
            
            if (seriesBannerPaths.length >= 3) {
              // ⚠️ OTIMIZAÇÃO CRÍTICA: Limitar número de banners no vídeo para evitar sobrecarga
              const MAX_BANNERS_IN_VIDEO = 10; // Máximo de 10 banners por vídeo
              const limitedBannerPaths = seriesBannerPaths.slice(0, MAX_BANNERS_IN_VIDEO);
              
              logger.info(`[PostImportHook] 🎬 Iniciando geração de vídeo de séries com ${limitedBannerPaths.length}/${seriesBannerPaths.length} banners (limite: ${MAX_BANNERS_IN_VIDEO})...`);
              try {
                // ⚠️ OTIMIZAÇÃO: Usar qualidade medium e timeout já está no video-generator
                const seriesVideoPath = await VideoGeneratorService.generatePromoVideo(
                  limitedBannerPaths,
                  'series',
                  importId,
                  { outputQuality: 'medium' } // Qualidade média para economizar recursos
                );
                
                videoPaths.series = seriesVideoPath;
                logger.info(`[PostImportHook] ✅ Vídeo de séries gerado com sucesso: ${seriesVideoPath}`);
              } catch (error: any) {
                logger.error(`[PostImportHook] ❌ Erro ao gerar vídeo de séries: ${error.message}`);
                if (error.stack) {
                  logger.error(`[PostImportHook] ❌ Stack: ${error.stack}`);
                }
                // Não falhar o processo, apenas logar o erro
              }
            } else {
              logger.warn(`[PostImportHook] ⚠️ Poucos banners válidos de séries (${seriesBannerPaths.length}/3) para gerar vídeo`);
            }
          } else {
            logger.warn(`[PostImportHook] ⚠️ Poucos banners de séries (${seriesBanners.length}/3) para gerar vídeo`);
          }
        } else {
          logger.info(`[PostImportHook] ℹ️ Nenhuma série encontrada para gerar vídeo`);
        }
      }

      // 🎬 CRIAR/ATUALIZAR CANAIS "CONTEÚDOS ATUALIZADOS"
      if (Object.keys(videoPaths).length > 0) {
        try {
          logger.info(`[PostImportHook] 🎬 Criando/atualizando canais "Conteúdos Atualizados"...`);
          logger.info(`[PostImportHook] 🎬 XUI Server ID: ${xuiServerId}, Stream Server ID: ${streamServerId}, Bouquet ID: ${bouquetId || 1}`);
          logger.info(`[PostImportHook] 🎬 VideoPaths recebidos: ${JSON.stringify(videoPaths)}`);
          
          if (!xuiServerId) {
            logger.error(`[PostImportHook] ❌ xuiServerId não fornecido! Não é possível criar canais.`);
          }
          
          if (!streamServerId) {
            logger.warn(`[PostImportHook] ⚠️ streamServerId não fornecido! Canais não serão vinculados ao servidor de streaming.`);
            logger.warn(`[PostImportHook] ⚠️ Os canais serão criados mas podem não funcionar corretamente sem streamServerId.`);
          }
          
          const channelsResult = await ConteudosAtualizadosService.createOrUpdateChannels(
            videoPaths, 
            xuiServerId,  // ID do servidor XUI (para criar categoria)
            streamServerId,  // ID do servidor de streaming (para vincular canais)
            bouquetId || 1  // ID do bouquet (padrão: 1 = "All Channels")
          );
          if (channelsResult.success) {
            logger.info(`[PostImportHook] ✅ Canais criados/atualizados com sucesso! Categoria ID: ${channelsResult.categoryId}, Canais: ${channelsResult.channelsCreated}`);
          } else {
            logger.error(`[PostImportHook] ❌ Erro ao criar canais: ${channelsResult.error}`);
            logger.error(`[PostImportHook] ❌ Stack trace completo será logado abaixo se disponível`);
          }
        } catch (channelsError: any) {
          logger.error(`[PostImportHook] ❌ Erro ao criar canais "Conteúdos Atualizados": ${channelsError.message}`);
          logger.error(`[PostImportHook] ❌ Stack: ${channelsError.stack}`);
          // Não falhar o processo se não conseguir criar canais
        }
      } else {
        logger.warn(`[PostImportHook] ⚠️ Nenhum vídeo gerado (videoPaths vazio), pulando criação de canais`);
      }

      return { 
        success: true, 
        bannersGenerated: banners.vertical.length + banners.horizontal.length, 
        videoPaths: Object.keys(videoPaths).length > 0 ? videoPaths : undefined
      };
    } catch (error: any) {
      logger.error('[PostImportHook] Erro:', error.message || error);
      return { success: false, bannersGenerated: 0, error: error?.message || 'Erro desconhecido' };
    }
  }

}

export default new PostImportHookService();
