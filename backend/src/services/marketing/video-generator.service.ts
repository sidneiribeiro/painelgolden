import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import path from 'path';
import fs from 'fs';
import { prisma } from '../../config/database.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('VideoGenerator');
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export interface VideoConfig {
  bannerDuration?: number;      // segundos por banner
  transitionDuration?: number;  // não usado na versão simples
  outputQuality?: 'low' | 'medium' | 'high';
}

const STORAGE_DIR = path.join(process.cwd(), 'storage', 'banners', 'videos');
fs.mkdirSync(STORAGE_DIR, { recursive: true });

export class VideoGeneratorService {
  async generatePromoVideo(
    bannerPaths: string[],
    contentType: 'movies' | 'series' | 'mixed',
    importId?: string,
    config?: VideoConfig
  ): Promise<string> {
    if (!bannerPaths.length) throw new Error('Nenhum banner fornecido');

    // Aumentar duração para dar tempo de ler título e sinopse (5 segundos)
    const bannerDuration = config?.bannerDuration || 5;
    // ⚠️ OTIMIZAÇÃO CRÍTICA: Usar qualidade "medium" ao invés de "high" para economizar CPU/RAM
    const outputQuality = config?.outputQuality || 'medium';

    const marketingConfig = await prisma.marketingConfig.findFirst();
    let musicPath: string | undefined;
    if (contentType === 'movies' && marketingConfig?.videoMusicFilmes) {
      musicPath = marketingConfig.videoMusicFilmes;
      logger.info(`[VideoGenerator] 🎵 Áudio configurado para filmes: ${musicPath}`);
    } else if (contentType === 'series' && marketingConfig?.videoMusicSeries) {
      musicPath = marketingConfig.videoMusicSeries;
      logger.info(`[VideoGenerator] 🎵 Áudio configurado para séries: ${musicPath}`);
    } else if (contentType === 'mixed' && marketingConfig?.videoMusicFilmes) {
      // Para mixed, usar música de filmes como fallback
      musicPath = marketingConfig.videoMusicFilmes;
      logger.info(`[VideoGenerator] 🎵 Áudio configurado para mixed (usando música de filmes): ${musicPath}`);
    }
    
    if (!musicPath) {
      logger.warn(`[VideoGenerator] ⚠️ Nenhum áudio configurado para tipo: ${contentType}`);
    }

    // ⚠️ IMPORTANTE: manter APENAS 1 vídeo por tipo (movies/series/mixed)
    // Usar nome FIXO para sobrescrever o anterior e evitar acúmulo no disco.
    const outputFileName = `promo_${contentType}_latest.mp4`;
    const outputPath = path.join(STORAGE_DIR, outputFileName);
    
    // Se existir um vídeo anterior com o mesmo nome (latest), remover antes de gerar
    // para evitar comportamento inesperado do ffmpeg ao sobrescrever.
    try {
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
    } catch (e: any) {
      logger.warn(`[VideoGenerator] ⚠️ Não foi possível remover vídeo anterior (${outputPath}): ${e?.message || String(e)}`);
    }

    const qualitySettings = {
      low: { crf: '28', preset: 'fast', bitrate: '2M' },
      medium: { crf: '23', preset: 'medium', bitrate: '4M' },
      high: { crf: '18', preset: 'slow', bitrate: '8M' },
    } as const;
    const quality = qualitySettings[outputQuality];

    return new Promise((resolve, reject) => {
      // ⚠️ OTIMIZAÇÃO CRÍTICA: Timeout geral de 15 minutos para todo o processo de geração de vídeo
      const overallTimeout = setTimeout(() => {
        logger.error(`[VideoGenerator] ❌ TIMEOUT CRÍTICO: Processo de geração de vídeo excedeu 15 minutos e será cancelado`);
        reject(new Error('Video generation timeout: processo excedeu 15 minutos'));
      }, 900000); // 15 minutos
      
      const listPath = path.join(STORAGE_DIR, `temp_list_${Date.now()}.txt`);
      let listContent = '';
      bannerPaths.forEach(p => {
        listContent += `file '${p.replace(/'/g, "'\\''")}'\n`;
        listContent += `duration ${bannerDuration}\n`;
      });
      listContent += `file '${bannerPaths[bannerPaths.length - 1].replace(/'/g, "'\\''")}'\n`;
      fs.writeFileSync(listPath, listContent.replace(/\\n/g, '\n'));

      let command = ffmpeg()
        .input(listPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .videoCodec('libx264')
        .outputOptions([
          `-crf ${quality.crf}`,
          `-preset ${quality.preset}`,
          '-pix_fmt yuv420p',
          '-movflags +faststart',
          '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2'
        ])
        .fps(30);

      if (musicPath) {
        // Converter caminho relativo (começa com /storage/) para absoluto
        // Os caminhos salvos são como: /storage/music/music_xxx.mp3
        // Mas o arquivo real está em: process.cwd()/storage/music/music_xxx.mp3
        let absoluteMusicPath: string;
        
        // IMPORTANTE: Verificar /storage/ ANTES de path.isAbsolute()
        // porque /storage/... é considerado absoluto no Linux, mas é relativo ao projeto
        if (musicPath.startsWith('/storage/')) {
          // Caminho relativo que começa com /storage/ -> remover / inicial e juntar com cwd
          absoluteMusicPath = path.join(process.cwd(), musicPath.substring(1));
        } else if (musicPath.startsWith('storage/')) {
          // Caminho relativo que começa com storage/
          absoluteMusicPath = path.join(process.cwd(), musicPath);
        } else if (path.isAbsolute(musicPath)) {
          // Caminho absoluto real (ex: /root/painel-iptv/backend/storage/...)
          absoluteMusicPath = musicPath;
        } else {
          // Outro tipo de caminho relativo
          absoluteMusicPath = path.join(process.cwd(), musicPath);
        }
        
        logger.info(`[VideoGenerator] 🔍 Verificando áudio:`);
        logger.info(`[VideoGenerator]   Caminho original: ${musicPath}`);
        logger.info(`[VideoGenerator]   Caminho absoluto: ${absoluteMusicPath}`);
        logger.info(`[VideoGenerator]   Existe: ${fs.existsSync(absoluteMusicPath)}`);
        
        if (fs.existsSync(absoluteMusicPath)) {
          const totalDuration = bannerPaths.length * bannerDuration;
          const fadeOutStart = Math.max(0, totalDuration - 3);
          logger.info(`[VideoGenerator] ✅ Adicionando áudio: ${absoluteMusicPath}`);
          command = command
            .input(absoluteMusicPath)
            .audioCodec('aac')
            .audioBitrate('192k')
            .outputOptions([
              '-shortest',
              '-af', `afade=t=in:st=0:d=1,afade=t=out:st=${fadeOutStart}:d=3`
            ]);
        } else {
          logger.error(`[VideoGenerator] ❌ Arquivo de áudio não encontrado!`);
          logger.error(`[VideoGenerator]   Tentou: ${absoluteMusicPath}`);
          logger.error(`[VideoGenerator]   CWD: ${process.cwd()}`);
          // Listar arquivos no diretório de música para debug
          const musicDir = path.join(process.cwd(), 'storage', 'music');
          if (fs.existsSync(musicDir)) {
            try {
              const files = fs.readdirSync(musicDir);
              logger.error(`[VideoGenerator]   Arquivos em storage/music: ${files.join(', ')}`);
            } catch (e: any) {
              logger.error(`[VideoGenerator]   Erro ao listar diretório: ${e?.message || String(e)}`);
            }
          }
          command = command.noAudio();
        }
      } else {
        logger.warn(`[VideoGenerator] ⚠️ Nenhum caminho de áudio fornecido, gerando vídeo sem áudio`);
        command = command.noAudio();
      }

      logger.info(`[VideoGenerator] 🎬 Iniciando geração de vídeo...`);
      logger.info(`[VideoGenerator]   Tipo: ${contentType}`);
      logger.info(`[VideoGenerator]   Banners: ${bannerPaths.length}`);
      logger.info(`[VideoGenerator]   Duração por banner: ${bannerDuration}s`);
      logger.info(`[VideoGenerator]   Qualidade: ${outputQuality}`);
      logger.info(`[VideoGenerator]   Arquivo de saída: ${outputPath}`);
      
      // ⚠️ OTIMIZAÇÃO CRÍTICA: Timeout de 10 minutos para o processo FFmpeg
      const ffmpegTimeout = setTimeout(() => {
        logger.error(`[VideoGenerator] ❌ TIMEOUT: FFmpeg excedeu 10 minutos, matando processo...`);
        command.kill('SIGKILL');
        try { fs.unlinkSync(listPath); } catch {}
        clearTimeout(overallTimeout);
        reject(new Error('FFmpeg timeout: processo excedeu 10 minutos'));
      }, 600000); // 10 minutos
      
      command
        .on('start', (cmd) => {
          logger.info(`[VideoGenerator] ✅ FFmpeg iniciado`);
          logger.info(`[VideoGenerator] Comando: ${cmd.substring(0, 200)}...`);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            const percent = Math.round(progress.percent);
            // ⚠️ OTIMIZAÇÃO: Log apenas a cada 20% para reduzir I/O
            if (percent % 20 === 0) {
              logger.info(`[VideoGenerator] Progresso: ${percent}%`);
            }
          }
        })
        .on('end', async () => {
          clearTimeout(ffmpegTimeout);
          logger.info(`[VideoGenerator] ✅ FFmpeg concluído!`);
          try { 
            fs.unlinkSync(listPath); 
            logger.info(`[VideoGenerator] ✅ Arquivo temporário removido`);
          } catch (e) {
            logger.warn(`[VideoGenerator] ⚠️ Erro ao remover arquivo temporário: ${e}`);
          }
          
          try {
            // ⚠️ CORREÇÃO: Aguardar mais tempo e verificar se arquivo existe
            let retries = 0;
            const maxRetries = 10;
            while (retries < maxRetries && !fs.existsSync(outputPath)) {
              await new Promise(resolve => setTimeout(resolve, 500));
              retries++;
            }
            
            if (!fs.existsSync(outputPath)) {
              logger.error(`[VideoGenerator] ❌ Arquivo de vídeo não foi criado após ${maxRetries} tentativas: ${outputPath}`);
              reject(new Error(`Arquivo de vídeo não foi criado: ${outputPath}`));
              return;
            }
            
            // Aguardar um pouco mais para garantir que o arquivo foi escrito completamente
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const stats = fs.statSync(outputPath);
            if (stats.size === 0) {
              logger.error(`[VideoGenerator] ❌ Arquivo de vídeo está vazio: ${outputPath}`);
              reject(new Error(`Arquivo de vídeo está vazio: ${outputPath}`));
              return;
            }
            
            logger.info(`[VideoGenerator] ✅ Arquivo de vídeo criado: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);
            
            const totalDuration = bannerPaths.length * bannerDuration;
            const publicPath = outputPath.replace(process.cwd(), '').replace(/\\/g, '/');
            const finalPath = publicPath.startsWith('/') ? publicPath : `/${publicPath}`;
            
            // ⚠️ REGRA: manter apenas 1 registro por tipo (movies/series/mixed)
            // Apagar registros antigos do tipo e criar um novo (com retry simples).
            let saved = false;
            let dbRetries = 0;
            const maxDbRetries = 3;
            while (!saved && dbRetries < maxDbRetries) {
              try {
                await prisma.generatedVideo.deleteMany({ where: { type: contentType } });
                await prisma.generatedVideo.create({
                  data: {
                    importId: importId || 'manual',
                    type: contentType,
                    filePath: finalPath,
                    duration: Math.round(totalDuration),
                    bannerCount: bannerPaths.length,
                  },
                });
                logger.info(`[VideoGenerator] ✅ Vídeo salvo no banco de dados (substituiu anteriores do tipo ${contentType})`);
                saved = true;
              } catch (dbError: any) {
                dbRetries++;
                if (dbRetries >= maxDbRetries) {
                  logger.error(`[VideoGenerator] ❌ Erro ao salvar no banco após ${maxDbRetries} tentativas: ${dbError.message}`);
                  resolve(finalPath);
                  return;
                }
                logger.warn(`[VideoGenerator] ⚠️ Erro ao salvar no banco (tentativa ${dbRetries}/${maxDbRetries}), tentando novamente...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            }
            
            logger.info(`[VideoGenerator] ✅ Vídeo gerado com sucesso: ${finalPath}`);
            clearTimeout(overallTimeout);
            resolve(finalPath);
          } catch (error: any) {
            clearTimeout(overallTimeout);
            logger.error(`[VideoGenerator] ❌ Erro crítico ao processar vídeo: ${error.message}`);
            logger.error(`[VideoGenerator] ❌ Stack: ${error.stack}`);
            reject(error);
          }
        })
        .on('error', (err) => {
          clearTimeout(ffmpegTimeout);
          clearTimeout(overallTimeout);
          logger.error(`[VideoGenerator] ❌ Erro no FFmpeg: ${err.message}`);
          logger.error(`[VideoGenerator] ❌ Stack: ${err.stack}`);
          try { fs.unlinkSync(listPath); } catch {}
          reject(err);
        })
        .save(outputPath);
      
      logger.info(`[VideoGenerator] 🎬 Comando FFmpeg configurado, aguardando processamento...`);
    });
  }
}

export default new VideoGeneratorService();
