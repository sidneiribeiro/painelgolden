/**
 * 🎬 VÍDEO PROMOCIONAL SERVICE
 * 
 * Módulo ISOLADO para geração de vídeos promocionais de filmes/séries
 * para redes sociais (Instagram Reels, TikTok, Facebook).
 * 
 * FORMATO: 1080x1920 (9:16 vertical)
 * DURAÇÃO: 20-35 segundos
 * 
 * NÃO ALTERA funcionalidades existentes de banners/vídeos.
 */

import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { spawn } from 'child_process';
import { createLogger } from '../../utils/logger.js';
import { TMDBService } from '../vod/tmdb.service.js';

const logger = createLogger('VideoPromocional');
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Diretório para vídeos promocionais (acessível pelo nginx)
const PROMO_VIDEO_DIR = '/var/www/painel/storage/promo-videos';
const PROMO_TEMP_DIR = path.join(PROMO_VIDEO_DIR, 'temp');

// Garantir que diretórios existem
fs.mkdirSync(PROMO_VIDEO_DIR, { recursive: true });
fs.mkdirSync(PROMO_TEMP_DIR, { recursive: true });

export interface TMDBSearchResult {
  id: number;
  title: string;
  originalTitle: string;
  year: string;
  type: 'movie' | 'tv';
  posterUrl: string | null;
  backdropUrl: string | null;
  overview: string;
  rating: number;
}

export interface PromoVideoData {
  tmdbId: number;
  type: 'movie' | 'tv';
  title: string;
  year: string;
  overview: string;
  posterUrl: string;
  backdropUrl: string;
  trailerUrl: string | null;
  trailerKey: string | null;
}

export interface GeneratedPromoVideo {
  filePath: string;
  publicPath: string;
  duration: number;
  title: string;
  year: string;
  synopsis: string;
  shareText: string;
}

export class PromoVideoService {
  private tmdbService: TMDBService;
  private currentVideoPath: string | null = null;

  constructor() {
    this.tmdbService = new TMDBService();
  }

  /**
   * Busca filmes/séries no TMDB
   */
  async searchContent(query: string): Promise<TMDBSearchResult[]> {
    const results: TMDBSearchResult[] = [];
    
    try {
      // Buscar filmes
      const movieResponse = await axios.get('https://api.themoviedb.org/3/search/movie', {
        params: {
          api_key: process.env.TMDB_API_KEY,
          query,
          language: 'pt-BR',
          page: 1,
        },
      });

      for (const movie of movieResponse.data.results?.slice(0, 5) || []) {
        results.push({
          id: movie.id,
          title: movie.title || movie.original_title,
          originalTitle: movie.original_title,
          year: movie.release_date?.substring(0, 4) || '',
          type: 'movie',
          posterUrl: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
          backdropUrl: movie.backdrop_path ? `https://image.tmdb.org/t/p/w1280${movie.backdrop_path}` : null,
          overview: movie.overview || '',
          rating: movie.vote_average || 0,
        });
      }

      // Buscar séries
      const tvResponse = await axios.get('https://api.themoviedb.org/3/search/tv', {
        params: {
          api_key: process.env.TMDB_API_KEY,
          query,
          language: 'pt-BR',
          page: 1,
        },
      });

      for (const tv of tvResponse.data.results?.slice(0, 5) || []) {
        results.push({
          id: tv.id,
          title: tv.name || tv.original_name,
          originalTitle: tv.original_name,
          year: tv.first_air_date?.substring(0, 4) || '',
          type: 'tv',
          posterUrl: tv.poster_path ? `https://image.tmdb.org/t/p/w500${tv.poster_path}` : null,
          backdropUrl: tv.backdrop_path ? `https://image.tmdb.org/t/p/w1280${tv.backdrop_path}` : null,
          overview: tv.overview || '',
          rating: tv.vote_average || 0,
        });
      }

      // Ordenar por rating
      results.sort((a, b) => b.rating - a.rating);
      
      return results.slice(0, 10);
    } catch (error: any) {
      logger.error(`[PromoVideo] Erro ao buscar conteúdo: ${error.message}`);
      throw error;
    }
  }

  /**
   * Obtém detalhes completos incluindo trailer
   */
  async getContentDetails(tmdbId: number, type: 'movie' | 'tv'): Promise<PromoVideoData | null> {
    try {
      const endpoint = type === 'movie' ? 'movie' : 'tv';
      
      const response = await axios.get(`https://api.themoviedb.org/3/${endpoint}/${tmdbId}`, {
        params: {
          api_key: process.env.TMDB_API_KEY,
          language: 'pt-BR',
          append_to_response: 'videos',
        },
      });

      const data = response.data;
      
      // Buscar trailer oficial
      let trailerKey: string | null = null;
      let trailerUrl: string | null = null;
      
      if (data.videos?.results?.length > 0) {
        // Prioridade: Trailer oficial em português, depois em inglês
        const trailer = data.videos.results.find(
          (v: any) => v.site === 'YouTube' && v.type === 'Trailer' && v.iso_639_1 === 'pt'
        ) || data.videos.results.find(
          (v: any) => v.site === 'YouTube' && v.type === 'Trailer'
        ) || data.videos.results.find(
          (v: any) => v.site === 'YouTube'
        );

        if (trailer) {
          trailerKey = trailer.key;
          trailerUrl = `https://www.youtube.com/watch?v=${trailer.key}`;
        }
      }

      const title = type === 'movie' ? data.title : data.name;
      const year = type === 'movie' 
        ? data.release_date?.substring(0, 4) 
        : data.first_air_date?.substring(0, 4);

      return {
        tmdbId,
        type,
        title: title || '',
        year: year || '',
        overview: data.overview || '',
        posterUrl: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : '',
        backdropUrl: data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : '',
        trailerUrl,
        trailerKey,
      };
    } catch (error: any) {
      logger.error(`[PromoVideo] Erro ao obter detalhes: ${error.message}`);
      return null;
    }
  }

  /**
   * Baixa o trailer do YouTube usando múltiplas estratégias
   * 1. Tenta yt-dlp com player_client=android (mais rápido)
   * 2. Fallback: Piped API (proxy YouTube, bypassa bot detection)
   */
  private async downloadTrailer(trailerKey: string): Promise<string | null> {
    const outputPath = path.join(PROMO_TEMP_DIR, `trailer_${trailerKey}.mp4`);
    
    // Se já existe, retornar
    if (fs.existsSync(outputPath)) {
      return outputPath;
    }

    // 1. Tentar yt-dlp (rápido se não bloqueado)
    logger.info(`[PromoVideo] Tentando yt-dlp (android client)...`);
    const ytResult = await this.tryYtDlp(trailerKey, outputPath);
    if (ytResult) return ytResult;

    // 2. Fallback: Piped API (proxy YouTube público)
    logger.info(`[PromoVideo] yt-dlp bloqueado, tentando Piped API...`);
    const pipedResult = await this.tryPipedDownload(trailerKey, outputPath);
    if (pipedResult) return pipedResult;
    
    logger.error(`[PromoVideo] ❌ Todas as estratégias falharam para: ${trailerKey}`);
    return null;
  }

  /**
   * Tenta baixar via yt-dlp com player_client=android
   */
  private tryYtDlp(trailerKey: string, outputPath: string): Promise<string | null> {
    return new Promise((resolve) => {
      const ytdlp = spawn('yt-dlp', [
        '--js-runtimes', 'node',
        '-f', 'best[height<=720][ext=mp4]/best[height<=720]/best',
        '--merge-output-format', 'mp4',
        '-o', outputPath,
        '--no-playlist',
        '--socket-timeout', '30',
        '--extractor-args', 'youtube:player_client=android',
        '--no-check-certificates',
        `https://www.youtube.com/watch?v=${trailerKey}`
      ], {
        env: { ...process.env, HOME: process.env.HOME || '/home/expressjs' },
      });

      let stderr = '';

      ytdlp.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      ytdlp.on('close', (code: number) => {
        if (code === 0 && fs.existsSync(outputPath)) {
          logger.info(`[PromoVideo] ✅ Trailer baixado via yt-dlp: ${trailerKey}`);
          resolve(outputPath);
        } else {
          try { fs.unlinkSync(outputPath + '.part'); } catch {}
          try { fs.unlinkSync(outputPath); } catch {}
          logger.warn(`[PromoVideo] yt-dlp falhou (code=${code})`);
          resolve(null);
        }
      });

      ytdlp.on('error', () => resolve(null));

      setTimeout(() => { ytdlp.kill(); resolve(null); }, 60000);
    });
  }

  /**
   * Fallback: Baixa trailer via Piped API (proxy YouTube público)
   * Piped é um frontend alternativo do YouTube que fornece URLs diretas
   */
  private async tryPipedDownload(trailerKey: string, outputPath: string): Promise<string | null> {
    const pipedInstances = [
      'https://pipedapi.kavin.rocks',
      'https://pipedapi.adminforge.de',
      'https://api.piped.yt',
    ];

    for (const apiBase of pipedInstances) {
      try {
        logger.info(`[PromoVideo] Tentando Piped: ${apiBase}...`);
        
        const response = await axios.get(`${apiBase}/streams/${trailerKey}`, {
          timeout: 15000,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0' },
        });

        const data = response.data;
        if (!data?.videoStreams?.length && !data?.audioStreams?.length) {
          logger.warn(`[PromoVideo] Piped ${apiBase}: sem streams disponíveis`);
          continue;
        }

        // Buscar melhor stream de vídeo (com áudio, <= 720p)
        const videoStreams = (data.videoStreams || [])
          .filter((s: any) => s.videoOnly === false && s.quality && s.mimeType?.includes('video/mp4'))
          .sort((a: any, b: any) => {
            const aH = parseInt(a.quality) || 0;
            const bH = parseInt(b.quality) || 0;
            return bH - aH; // Maior resolução primeiro
          });

        // Pegar 720p ou menor
        let streamUrl = '';
        for (const s of videoStreams) {
          const h = parseInt(s.quality) || 0;
          if (h <= 720 && s.url) {
            streamUrl = s.url;
            logger.info(`[PromoVideo] Piped: usando stream ${s.quality} (${s.mimeType})`);
            break;
          }
        }

        // Se não achou <= 720p, pegar qualquer um
        if (!streamUrl && videoStreams.length > 0) {
          streamUrl = videoStreams[videoStreams.length - 1].url;
        }

        // Último recurso: qualquer stream de vídeo (incluindo video-only)
        if (!streamUrl) {
          const anyVideo = (data.videoStreams || []).find((s: any) => s.url);
          if (anyVideo) streamUrl = anyVideo.url;
        }

        if (!streamUrl) {
          logger.warn(`[PromoVideo] Piped ${apiBase}: nenhuma URL de stream encontrada`);
          continue;
        }

        // Baixar o vídeo
        logger.info(`[PromoVideo] Baixando trailer via Piped...`);
        const videoResponse = await axios.get(streamUrl, {
          responseType: 'arraybuffer',
          timeout: 120000,
          maxContentLength: 200 * 1024 * 1024, // 200MB max
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0' },
        });

        fs.writeFileSync(outputPath, videoResponse.data);
        
        const sizeMB = (videoResponse.data.length / 1024 / 1024).toFixed(1);
        logger.info(`[PromoVideo] ✅ Trailer baixado via Piped (${sizeMB}MB): ${trailerKey}`);
        return outputPath;

      } catch (error: any) {
        logger.warn(`[PromoVideo] Piped ${apiBase} falhou: ${error.message}`);
        try { fs.unlinkSync(outputPath); } catch {}
      }
    }

    return null;
  }

  /**
   * Baixa uma imagem para arquivo local
   */
  private async downloadImage(url: string, filename: string): Promise<string | null> {
    try {
      const outputPath = path.join(PROMO_TEMP_DIR, filename);
      
      const response = await axios.get(url, { responseType: 'arraybuffer' });
      fs.writeFileSync(outputPath, response.data);
      
      return outputPath;
    } catch (error: any) {
      logger.error(`[PromoVideo] Erro ao baixar imagem: ${error.message}`);
      return null;
    }
  }

  /**
   * Trunca texto inteligentemente
   */
  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    
    const truncated = text.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    
    return truncated.substring(0, lastSpace > 0 ? lastSpace : maxLength) + '...';
  }

  /**
   * Escapa texto para uso no FFmpeg drawtext
   */
  private escapeFFmpegText(text: string): string {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "'\\''")
      .replace(/:/g, '\\:')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/;/g, '\\;')
      .replace(/%/g, '\\%');
  }

  /**
   * Gera o vídeo promocional no formato 9:16
   */
  async generatePromoVideo(
    contentData: PromoVideoData,
    ctaText: string = '👉 Quer assistir? Chama no WhatsApp'
  ): Promise<GeneratedPromoVideo> {
    logger.info(`[PromoVideo] 🎬 Iniciando geração de vídeo promocional: ${contentData.title}`);

    // Limpar vídeo anterior (apenas 1 vídeo por vez)
    await this.cleanupPreviousVideo();

    // 1. Baixar trailer
    let trailerPath: string | null = null;
    if (contentData.trailerKey) {
      trailerPath = await this.downloadTrailer(contentData.trailerKey);
    }

    if (!trailerPath) {
      throw new Error('Não foi possível baixar o trailer. Verifique se yt-dlp está instalado.');
    }

    // 2. Baixar poster/backdrop
    const posterPath = contentData.posterUrl 
      ? await this.downloadImage(contentData.posterUrl, `poster_${contentData.tmdbId}.jpg`)
      : null;

    // 3. Preparar textos
    const title = this.truncateText(contentData.title, 50);
    const synopsis = this.truncateText(contentData.overview, 160);
    const year = contentData.year;

    // 4. Gerar vídeo
    const outputFileName = `promo_${Date.now()}.mp4`;
    const outputPath = path.join(PROMO_VIDEO_DIR, outputFileName);

    await this.createVerticalVideo(
      trailerPath,
      posterPath,
      title,
      year,
      synopsis,
      ctaText,
      outputPath
    );

    // Salvar caminho do vídeo atual
    this.currentVideoPath = outputPath;

    // Gerar texto de compartilhamento
    const shareText = this.generateShareText(title, year, synopsis);

    const publicPath = `/api/storage/promo-videos/${outputFileName}`;

    const result: GeneratedPromoVideo = {
      filePath: outputPath,
      publicPath,
      duration: 25, // Aproximado
      title,
      year,
      synopsis,
      shareText,
    };

    // Persistir metadados em JSON para sobreviver a reloads
    try {
      const metaPath = path.join(PROMO_VIDEO_DIR, 'current_meta.json');
      fs.writeFileSync(metaPath, JSON.stringify({
        publicPath: result.publicPath,
        duration: result.duration,
        title: result.title,
        year: result.year,
        synopsis: result.synopsis,
        shareText: result.shareText,
      }, null, 2));
    } catch (e: any) {
      logger.warn(`[PromoVideo] Erro ao salvar metadados: ${e.message}`);
    }

    logger.info(`[PromoVideo] ✅ Vídeo gerado: ${publicPath}`);

    return result;
  }

  /**
   * Quebra texto em múltiplas linhas para FFmpeg
   */
  private wrapText(text: string, maxCharsPerLine: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      if ((currentLine + ' ' + word).trim().length <= maxCharsPerLine) {
        currentLine = (currentLine + ' ' + word).trim();
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);

    return lines.slice(0, 4); // Máximo 4 linhas
  }

  /**
   * Cria o vídeo vertical usando FFmpeg (via spawn direto)
   * 
   * LAYOUT PROFISSIONAL (1080x1920):
   * ┌─────────────────────────┐ 0
   * │    🎬 TÍTULO GRANDE     │ 
   * │         (2024)          │ ~180px
   * ├─────────────────────────┤
   * │                         │
   * │                         │
   * │    [  TRAILER  ]        │ ~1200px (maior parte)
   * │    (fullscreen)         │
   * │                         │
   * ├─────────────────────────┤ ~1380px
   * │   Sinopse grande e      │
   * │   legível aqui          │ ~300px
   * ├─────────────────────────┤
   * │  ▶ CHAMA NO WHATSAPP    │ ~240px (CTA)
   * └─────────────────────────┘ 1920
   */
  private async createVerticalVideo(
    trailerPath: string,
    posterPath: string | null,
    title: string,
    year: string,
    synopsis: string,
    ctaText: string,
    outputPath: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // Configuração do vídeo 9:16 (1080x1920)
      const width = 1080;
      const height = 1920;
      
      // Layout zones - Áreas seguras Instagram/Facebook/TikTok
      // Top 14% = profile/icons, Bottom 35% = captions/CTA
      const safeTop = 270;           // 14% de 1920px (área segura abaixo)
      const safeBottom = 1250;       // 65% de 1920px (antes do bottom 35%)
      const trailerHeight = safeBottom - safeTop; // Trailer na área segura
      const synopsisHeight = 280;    // Sinopse
      const ctaHeight = 290;         // CTA
      
      // Posições Y
      const trailerY = safeTop;      // Trailer começa na área segura
      const synopsisY = safeBottom;
      const ctaY = synopsisY + synopsisHeight;
      
      // Escapar textos
      const escapedTitle = this.escapeFFmpegText(title.toUpperCase());
      const escapedYear = this.escapeFFmpegText(year);
      const escapedCta = this.escapeFFmpegText(ctaText.replace(/👉/g, '').trim().toUpperCase());
      
      // Sinopse em linhas (texto maior = menos chars por linha)
      const synopsisLines = this.wrapText(synopsis, 45);
      
      // Fontes
      const fontBold = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
      const fontRegular = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';

      // Construir filtros de sinopse (múltiplas linhas, texto GRANDE)
      let synopsisFilters = '';
      const synopsisTextStartY = synopsisY + 40;
      const lineHeight = 48;
      
      synopsisLines.forEach((line, index) => {
        const escapedLine = this.escapeFFmpegText(line);
        const yPos = synopsisTextStartY + (index * lineHeight);
        synopsisFilters += `,drawtext=fontfile=${fontRegular}:text='${escapedLine}':fontcolor=white:fontsize=38:x=(w-text_w)/2:y=${yPos}`;
      });

      // Filtro complexo - Layout profissional
      const filterComplex = [
        // 1. Escalar trailer para ocupar a zona central (crop para preencher, sem barras)
        `[0:v]scale=${width}:${trailerHeight}:force_original_aspect_ratio=increase,crop=${width}:${trailerHeight},setsar=1[trailer]`,
        
        // 2. Criar fundo gradiente escuro (azul escuro -> preto)
        `color=c=0x0f0f23:s=${width}x${height}:d=35[bg]`,
        
        // 3. Overlay do trailer no topo
        `[bg][trailer]overlay=0:${trailerY}[with_trailer]`,
        
        // 4. Faixa azul semi-transparente na área segura (para o título)
        `[with_trailer]drawbox=x=0:y=${safeTop}:w=${width}:h=180:c=0x1a1a3e@0.85:t=fill[with_header_bg]`,
        
        // 5. Gradiente suave na transição header->trailer
        `[with_header_bg]drawbox=x=0:y=${safeTop + 160}:w=${width}:h=40:c=0x1a1a3e@0.4:t=fill[with_top_grad]`,
        
        // 6. Gradiente inferior sobre o trailer (transição para sinopse)
        `[with_top_grad]drawbox=x=0:y=${synopsisY - 80}:w=${width}:h=80:c=0x0f0f23@0.7:t=fill[with_bot_grad]`,
        
        // 7. Área da sinopse (fundo semi-transparente)
        `[with_bot_grad]drawbox=x=0:y=${synopsisY}:w=${width}:h=${synopsisHeight}:c=0x1a1a3e@0.9:t=fill[with_synopsis_bg]`,
        
        // 8. Área do CTA (fundo escuro elegante)
        `[with_synopsis_bg]drawbox=x=0:y=${ctaY}:w=${width}:h=${ctaHeight}:c=0x12121f:t=fill[with_cta_bg]`,
        
        // 9. TÍTULO GRANDE no topo
        `[with_cta_bg]drawtext=fontfile=${fontBold}:text='${escapedTitle}':fontcolor=white:fontsize=52:x=(w-text_w)/2:y=${safeTop + 50}:shadowcolor=black:shadowx=3:shadowy=3[with_title]`,
        
        // 10. Ano abaixo do título
        `[with_title]drawtext=fontfile=${fontRegular}:text='${escapedYear}':fontcolor=0xcccccc:fontsize=32:x=(w-text_w)/2:y=${safeTop + 115}[with_year]`,
        
        // 11. Linha decorativa abaixo do ano
        `[with_year]drawbox=x=440:y=${safeTop + 155}:w=200:h=3:c=0xff6b35:t=fill[with_line]`,
        
        // 12. Sinopse (texto grande, múltiplas linhas)
        `[with_line]drawtext=fontfile=${fontRegular}:text='':x=0:y=0${synopsisFilters}[with_synopsis]`,
        
        // 13. Borda do botão CTA
        `[with_synopsis]drawbox=x=90:y=${ctaY + 100}:w=900:h=90:c=0xff6b35:t=4[with_btn_border]`,
        
        // 14. Fundo do botão CTA
        `[with_btn_border]drawbox=x=95:y=${ctaY + 105}:w=890:h=80:c=0xff6b35@0.2:t=fill[with_btn_bg]`,
        
        // 15. Texto do CTA
        `[with_btn_bg]drawtext=fontfile=${fontBold}:text='${escapedCta}':fontcolor=white:fontsize=40:x=(w-text_w)/2:y=${ctaY + 125}`
      ].join(';');

      const args = [
        '-y',
        '-ss', '8',              // Pular 8 segundos iniciais (logos/créditos)
        '-t', '35',              // Duração total: 35 segundos
        '-i', trailerPath,
        '-filter_complex', filterComplex,
        '-map', '0:a?',
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '22',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-t', '35',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        outputPath
      ];

      logger.info(`[PromoVideo] Gerando vídeo com layout profissional...`);
      
      const ffmpegProcess = spawn('ffmpeg', args);
      let stderr = '';

      ffmpegProcess.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      ffmpegProcess.on('close', (code: number) => {
        if (code === 0) {
          logger.info(`[PromoVideo] ✅ FFmpeg concluído com sucesso`);
          resolve();
        } else {
          logger.error(`[PromoVideo] ❌ FFmpeg falhou (code ${code}): ${stderr.slice(-500)}`);
          reject(new Error(`FFmpeg falhou: ${stderr.slice(-200)}`));
        }
      });

      ffmpegProcess.on('error', (err: Error) => {
        logger.error(`[PromoVideo] ❌ Erro spawn FFmpeg: ${err.message}`);
        reject(err);
      });

      // Timeout de 5 minutos
      setTimeout(() => {
        ffmpegProcess.kill('SIGKILL');
        reject(new Error('Timeout na geração do vídeo'));
      }, 300000);
    });
  }

  /**
   * Gera texto de compartilhamento para redes sociais
   */
  private generateShareText(title: string, year: string, synopsis: string): string {
    const shortSynopsis = this.truncateText(synopsis, 100);
    
    return `🎬 ${title} (${year})
${shortSynopsis}

👉 Quer saber como assistir? Fale comigo no WhatsApp

#filmes #series #cinemaemcasa #dicasdefilmes #streaming`;
  }

  /**
   * Remove vídeo anterior (apenas 1 vídeo por vez)
   */
  private async cleanupPreviousVideo(): Promise<void> {
    try {
      const files = fs.readdirSync(PROMO_VIDEO_DIR);
      
      for (const file of files) {
        if (file.startsWith('promo_') && file.endsWith('.mp4')) {
          const filePath = path.join(PROMO_VIDEO_DIR, file);
          fs.unlinkSync(filePath);
          logger.info(`[PromoVideo] 🗑️ Vídeo anterior removido: ${file}`);
        }
      }
    } catch (error: any) {
      logger.warn(`[PromoVideo] Erro ao limpar vídeos anteriores: ${error.message}`);
    }
  }

  /**
   * Limpa arquivos temporários
   */
  async cleanupTempFiles(): Promise<void> {
    try {
      const files = fs.readdirSync(PROMO_TEMP_DIR);
      
      for (const file of files) {
        const filePath = path.join(PROMO_TEMP_DIR, file);
        const stats = fs.statSync(filePath);
        
        // Remover arquivos com mais de 1 hora
        if (Date.now() - stats.mtimeMs > 3600000) {
          fs.unlinkSync(filePath);
          logger.debug(`[PromoVideo] Arquivo temp removido: ${file}`);
        }
      }
    } catch (error: any) {
      logger.warn(`[PromoVideo] Erro ao limpar temp: ${error.message}`);
    }
  }

  /**
   * Obtém o vídeo atual (se existir)
   */
  getCurrentVideo(): { publicPath: string; title?: string; year?: string; synopsis?: string; shareText?: string; duration?: number } | null {
    try {
      const files = fs.readdirSync(PROMO_VIDEO_DIR);
      let videoFile: string | null = null;
      
      for (const file of files) {
        if (file.startsWith('promo_') && file.endsWith('.mp4')) {
          videoFile = file;
          break;
        }
      }

      if (!videoFile) return null;

      const publicPath = `/api/storage/promo-videos/${videoFile}`;

      // Tentar ler metadados salvos
      try {
        const metaPath = path.join(PROMO_VIDEO_DIR, 'current_meta.json');
        if (fs.existsSync(metaPath)) {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          return { ...meta, publicPath };
        }
      } catch { /* ignorar erro de leitura */ }

      return { publicPath };
    } catch (error) {
      // Ignorar
    }
    
    return null;
  }
}

export const promoVideoService = new PromoVideoService();
