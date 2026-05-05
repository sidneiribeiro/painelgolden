import { createCanvas, loadImage, registerFont, CanvasRenderingContext2D } from 'canvas';
import path from 'path';
import fs from 'fs';
import { prisma } from '../../config/database.js';
import { createLogger } from '../../utils/logger.js';
import { env } from '../../config/env.js';
import { tmdbKeyManager } from '../vod/tmdb-key-manager.service.js';

const logger = createLogger('BannerGenerator');

// Paleta oficial
const THEME_COLORS = {
  cyan: '#00E5FF',
  cyanLight: '#18FFFF',
  blue: '#1E88E5',
  blueDark: '#1565C0',
  blueDeep: '#0D47A1',
  gradientPrimary: ['#00E5FF', '#1E88E5'],
  bgDark: '#0a0e1a',
  bgCard: '#0f1629',
  purple: '#9C27B0',
  purpleLight: '#CE93D8',
  purpleDark: '#673AB7',
  green: '#4CAF50',
  greenLight: '#81C784',
  greenDark: '#2E7D32',
  gold: '#FFD700',
  white: '#FFFFFF',
  gray: '#9CA3AF',
  grayDark: '#4B5563',
};

const FONTS_DIR = path.join(process.cwd(), 'assets', 'fonts');
try {
  registerFont(path.join(FONTS_DIR, 'Montserrat-Bold.ttf'), { family: 'Montserrat', weight: 'bold' });
  registerFont(path.join(FONTS_DIR, 'Montserrat-Regular.ttf'), { family: 'Montserrat', weight: 'normal' });
} catch {
  logger.warn('[BannerGenerator] Fontes Montserrat não encontradas, usando fallback.');
}

export interface ContentData {
  id?: number;
  title: string;
  year: string;
  rating: number;
  duration?: string;
  seasons?: string;
  genres: string[];
  synopsis: string;
  posterUrl: string;
  backdropUrl?: string;
  type: 'movie' | 'series';
  tmdbId?: number;
  cast?: Array<{ name: string; profilePath: string | null }>; // Elenco principal
}

interface BannerConfig {
  painelName: string;
  painelLogo: string | null;
  slogan: string;
  primaryColor: string;
  secondaryColor: string;
  whatsapp: string;
}

class BannerGeneratorService {
  private config: BannerConfig | null = null;
  private outputBase = path.join(process.cwd(), 'storage', 'banners');
  private async loadLogo(): Promise<any> {
    try {
      if (this.config?.painelLogo) {
        // Suporta: URL absoluta, caminho /storage/..., ou caminho relativo em disco
        if (this.config.painelLogo.startsWith('http')) {
          return await loadImage(this.config.painelLogo);
        }
        const absPath = this.config.painelLogo.startsWith('/')
          ? path.join(process.cwd(), this.config.painelLogo)
          : path.join(process.cwd(), this.config.painelLogo);
        return await loadImage(absPath);
      }
    } catch (e: any) {
      logger.warn('[BannerGenerator] Falha ao carregar logo do painel:', e.message);
    }
    return null;
  }

  private cleanTitle(raw: string): string {
    return (raw || '')
      .replace(/^⚡\s*/g, '')
      .replace(/\[[^\]]+\]/g, '') // remove [Cinema], [Legendado], etc
      .replace(/\([^)]*\)/g, '')  // remove (Cinema), (4K), etc
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  private ensureDirs(type: 'movie' | 'series') {
    const sub = type === 'movie' ? 'movies' : 'series';
    fs.mkdirSync(path.join(this.outputBase, sub, 'vertical'), { recursive: true });
    fs.mkdirSync(path.join(this.outputBase, sub, 'horizontal'), { recursive: true });
  }

  private async loadConfig(): Promise<BannerConfig> {
    const db = await prisma.marketingConfig.findFirst();
    this.config = {
      painelName: db?.painelName || 'PAINEL MASTER',
      painelLogo: db?.painelLogo || null,
      slogan: db?.sloganText || 'O melhor do streaming você encontra aqui',
      primaryColor: db?.primaryColor || THEME_COLORS.cyan,
      secondaryColor: db?.secondaryColor || THEME_COLORS.blue,
      whatsapp: db?.whatsappNumber || '',
    };
    return this.config;
  }

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  private wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth) {
        lines.push(line);
        line = word;
        if (lines.length >= maxLines) break;
      } else {
        line = test;
      }
    }
    if (line && lines.length < maxLines) lines.push(line);
    if (lines.length > maxLines) return lines.slice(0, maxLines);
    if (lines.length > 0) {
      const lastIdx = lines.length - 1;
      let last = lines[lastIdx];
      while (ctx.measureText(last + '...').width > maxWidth && last.length > 0) {
        last = last.slice(0, -1);
      }
      lines[lastIdx] = last !== lines[lastIdx] ? last.trim() + '...' : last;
    }
    return lines;
  }

  // 🔧 VERSÃO SIMPLIFICADA - 100% INDEPENDENTE
  // Busca por TÍTULO quando não tem tmdbId
  // Usa fetch direto na API do TMDB (não depende do TMDBService)
  private async enrichWithTMDB(data: ContentData): Promise<ContentData> {
    const cleanTitle = this.cleanTitle(data.title);
    
    // Buscar API Key do gerenciador (banco de dados) ou fallback para .env
    let apiKey: string | null = null;
    try {
      apiKey = await tmdbKeyManager.getAvailableKey();
      if (apiKey) {
        logger.info(`[TMDB] ✅ API Key obtida do gerenciador (tamanho: ${apiKey.length})`);
      }
    } catch (error: any) {
      logger.warn(`[TMDB] ⚠️ Erro ao buscar chave do gerenciador: ${error.message}`);
    }
    
    // Fallback para .env se não encontrou no banco
    if (!apiKey || apiKey.length < 10) {
      apiKey = env.TMDB_API_KEY;
      if (apiKey && apiKey.length >= 10) {
        logger.info(`[TMDB] ✅ Usando API Key do .env (tamanho: ${apiKey.length})`);
      } else {
        logger.error(`[TMDB] ❌ API KEY não configurada!`);
        return data;
      }
    }
    
    logger.info(`[TMDB] ========================================`);
    logger.info(`[TMDB] Buscando dados para: "${cleanTitle}"`);
    logger.info(`[TMDB] Tipo: ${data.type} | tmdbId: ${data.tmdbId || 'NENHUM'}`);

    // Se já tem dados completos, pula
    const hasGoodSynopsis = data.synopsis && data.synopsis.length > 50 && !data.synopsis.includes('indisponível');
    const hasGoodRating = data.rating > 0 && data.rating !== 7.0;
    const hasGoodGenres = data.genres && data.genres.length > 0 && data.genres[0] !== 'Gênero não informado';
    
    if (data.tmdbId && hasGoodSynopsis && hasGoodRating && hasGoodGenres) {
      logger.info(`[TMDB] ✅ Dados já completos, pulando busca`);
      return data;
    }

    try {
      let enriched = { ...data };
      let tmdbId = data.tmdbId;
      
      // ========================================
      // PASSO 1: Se não tem tmdbId, buscar por título
      // ========================================
      if (!tmdbId) {
        logger.info(`[TMDB] 🔍 Buscando por título: "${cleanTitle}"`);
        
        const searchType = data.type === 'movie' ? 'movie' : 'tv';
        const yearParam = data.year ? `&year=${data.year}` : '';
        
        const searchUrl = `https://api.themoviedb.org/3/search/${searchType}?api_key=${apiKey}&language=pt-BR&query=${encodeURIComponent(cleanTitle)}${yearParam}`;
        
        logger.info(`[TMDB] URL: ${searchUrl.replace(apiKey, '***')}`);
        
        // ⚠️ OTIMIZAÇÃO: Adicionar timeout de 10 segundos para chamadas HTTP
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        try {
          const searchResponse = await fetch(searchUrl, { 
            signal: controller.signal,
            headers: { 'Accept': 'application/json' }
          });
          clearTimeout(timeoutId);
          const searchData = await searchResponse.json() as any;
          
          if (searchData.results && searchData.results.length > 0) {
            // Pegar o resultado mais popular
            const best = searchData.results.sort((a: any, b: any) => (b.popularity || 0) - (a.popularity || 0))[0];
            tmdbId = best.id;
            enriched.tmdbId = tmdbId;
            
            const foundTitle = best.title || best.name;
            logger.info(`[TMDB] ✅ Encontrado: "${foundTitle}" (ID: ${tmdbId})`);
          } else {
            logger.warn(`[TMDB] ❌ Nenhum resultado para: "${cleanTitle}"`);
            return data;
          }
        } catch (fetchError: any) {
          clearTimeout(timeoutId);
          if (fetchError.name === 'AbortError') {
            logger.warn(`[TMDB] ⚠️ Timeout na busca por "${cleanTitle}"`);
          } else {
            logger.warn(`[TMDB] ⚠️ Erro na busca: ${fetchError.message}`);
          }
          return data;
        }
      }
      
      // ========================================
      // PASSO 2: Buscar detalhes completos
      // ========================================
      if (tmdbId) {
        logger.info(`[TMDB] 📦 Buscando detalhes para ID: ${tmdbId}`);
        
        const detailsType = data.type === 'movie' ? 'movie' : 'tv';
        const detailsUrl = `https://api.themoviedb.org/3/${detailsType}/${tmdbId}?api_key=${apiKey}&language=pt-BR&append_to_response=credits`;
        
        // ⚠️ OTIMIZAÇÃO: Adicionar timeout de 10 segundos para chamadas HTTP
        const detailsController = new AbortController();
        const detailsTimeoutId = setTimeout(() => detailsController.abort(), 10000);
        
        try {
          const detailsResponse = await fetch(detailsUrl, { 
            signal: detailsController.signal,
            headers: { 'Accept': 'application/json' }
          });
          clearTimeout(detailsTimeoutId);
          const details = await detailsResponse.json() as any;
          
          // Buscar elenco principal (primeiros 3 atores)
          if (details.credits && details.credits.cast && details.credits.cast.length > 0) {
            enriched.cast = details.credits.cast.slice(0, 3).map((actor: any) => ({
              name: actor.name,
              profilePath: actor.profile_path,
            }));
            logger.info(`[TMDB]   → Elenco: ${enriched.cast?.map(c => c.name).join(', ') || 'N/A'}`);
          } else {
            enriched.cast = [];
          }
          
          if (details && details.id) {
          // SINOPSE
          if (!hasGoodSynopsis && details.overview) {
            enriched.synopsis = details.overview;
            logger.info(`[TMDB]   → Sinopse: ${details.overview.substring(0, 50)}...`);
          }
          
          // RATING
          if (!hasGoodRating && details.vote_average) {
            enriched.rating = Math.round(details.vote_average * 10) / 10;
            logger.info(`[TMDB]   → Rating: ${enriched.rating}`);
          }
          
          // GÊNEROS
          if (!hasGoodGenres && details.genres && details.genres.length > 0) {
            enriched.genres = details.genres.map((g: any) => g.name);
            logger.info(`[TMDB]   → Gêneros: ${enriched.genres.join(', ')}`);
          }
          
          // POSTER
          if (!enriched.posterUrl && details.poster_path) {
            enriched.posterUrl = `https://image.tmdb.org/t/p/w500${details.poster_path}`;
            logger.info(`[TMDB]   → Poster OK`);
          }
          
          // BACKDROP
          if (!enriched.backdropUrl && details.backdrop_path) {
            enriched.backdropUrl = `https://image.tmdb.org/t/p/w1280${details.backdrop_path}`;
            logger.info(`[TMDB]   → Backdrop OK`);
          }
          
          // ANO
          if (!enriched.year) {
            const releaseDate = details.release_date || details.first_air_date;
            if (releaseDate) {
              enriched.year = releaseDate.substring(0, 4);
              logger.info(`[TMDB]   → Ano: ${enriched.year}`);
            }
          }
          
          // DURAÇÃO (filmes)
          if (data.type === 'movie' && !enriched.duration && details.runtime) {
            const h = Math.floor(details.runtime / 60);
            const m = details.runtime % 60;
            enriched.duration = h > 0 ? `${h}h ${m}min` : `${m}min`;
            logger.info(`[TMDB]   → Duração: ${enriched.duration}`);
          }
          
          // TEMPORADAS (séries)
          if (data.type === 'series' && !enriched.seasons && details.number_of_seasons) {
            const n = details.number_of_seasons;
            enriched.seasons = `${n} temporada${n > 1 ? 's' : ''}`;
            logger.info(`[TMDB]   → Temporadas: ${enriched.seasons}`);
          }
          
            logger.info(`[TMDB] ✅ Dados enriquecidos com sucesso!`);
          } else {
            logger.warn(`[TMDB] ❌ Detalhes não encontrados para ID: ${tmdbId}`);
          }
        } catch (detailsError: any) {
          clearTimeout(detailsTimeoutId);
          if (detailsError.name === 'AbortError') {
            logger.warn(`[TMDB] ⚠️ Timeout ao buscar detalhes para ID: ${tmdbId}`);
          } else {
            logger.warn(`[TMDB] ⚠️ Erro ao buscar detalhes: ${detailsError.message}`);
          }
        }
      }
      
      logger.info(`[TMDB] ========================================`);
      return enriched;
      
    } catch (error: any) {
      logger.error(`[TMDB] ❌ Erro: ${error.message}`);
      logger.error(`[TMDB] Stack: ${error.stack}`);
      return data;
    }
  }

  // ---------- Vertical ----------
  async generateVerticalBanner(data: ContentData, importId?: string): Promise<string> {
    // 🎯 SOLUÇÃO: Enriquecer com dados frescos do TMDB antes de gerar
    const enrichedData = await this.enrichWithTMDB(data);
    
    await this.loadConfig();
    this.ensureDirs(enrichedData.type);
    const cfg = this.config!;
    const logoImg = await this.loadLogo();
    const whatsapp = cfg.whatsapp;
    const WIDTH = 1080, HEIGHT = 1920;
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');
    const theme = enrichedData.type === 'movie' ? THEME_COLORS.cyan : THEME_COLORS.purple;
    const themeDark = enrichedData.type === 'movie' ? THEME_COLORS.blueDark : THEME_COLORS.purpleDark;
    const cleanTitle = this.cleanTitle(enrichedData.title);
    const rawSyn = (enrichedData.synopsis || '').trim();
    const synopsisText = rawSyn.length > 10 ? rawSyn : 'Sinopse indisponível.';
    const rating = enrichedData.rating > 0 ? enrichedData.rating : 7.0;
    const releaseInfo = enrichedData.year && enrichedData.year.trim().length ? enrichedData.year.trim() : '—';
    const genresText = enrichedData.genres && enrichedData.genres.length > 0 ? enrichedData.genres.slice(0, 3).join('  •  ') : 'Gênero não informado';
    
    logger.info(`[BannerGenerator] 📦 Dados FINAIS para banner - Título: ${enrichedData.title} | Título limpo: ${cleanTitle} | Rating: ${rating} | Sinopse (${rawSyn.length} chars): ${rawSyn.substring(0, 50)}... | Gêneros: ${genresText} | Logo: ${logoImg ? 'SIM' : 'NÃO'}`);

    const bg = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    bg.addColorStop(0, THEME_COLORS.bgDark);
    bg.addColorStop(1, THEME_COLORS.bgCard);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const posterH = Math.floor(HEIGHT * 0.55);
    try {
      // ⚠️ OTIMIZAÇÃO: Adicionar timeout de 15 segundos para carregar imagens
      const posterPromise = loadImage(enrichedData.posterUrl);
      const posterTimeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Timeout: Carregamento de poster excedeu 15 segundos')), 15000);
      });
      const poster = await Promise.race([posterPromise, posterTimeout]);
      ctx.drawImage(poster, 0, 0, WIDTH, posterH);
      const fade = ctx.createLinearGradient(0, posterH - 300, 0, posterH);
      fade.addColorStop(0, 'rgba(10,14,26,0)');
      fade.addColorStop(0.5, 'rgba(10,14,26,0.7)');
      fade.addColorStop(1, 'rgba(10,14,26,1)');
      ctx.fillStyle = fade;
      ctx.fillRect(0, posterH - 300, WIDTH, 300);
    } catch {
      const fb = ctx.createLinearGradient(0, 0, 0, posterH);
      fb.addColorStop(0, themeDark);
      fb.addColorStop(1, THEME_COLORS.bgDark);
      ctx.fillStyle = fb;
      ctx.fillRect(0, 0, WIDTH, posterH);
    }

    // ========== LOGO NO TOPO DIREITO ==========
    if (logoImg) {
      const logoSize = 80;
      const lx = WIDTH - logoSize - 50; // Topo direito
      const ly = 50;
      this.roundRect(ctx, lx - 8, ly - 8, logoSize + 16, logoSize + 16, 16);
      ctx.fillStyle = `${theme}15`;
      ctx.fill();
      ctx.strokeStyle = `${theme}40`;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.drawImage(logoImg as any, lx, ly, logoSize, logoSize);
    }

    // ========== BADGES NO TOPO ESQUERDO (sem cor #01f4fa/cyan) ==========
    let badgeY = 80;
    const badgeHeight = 44;
    const badgePadding = 15;
    
    // Badge 1: Tipo (FILME ou SÉRIE) - SEM EMOJIS
    const typeBadge = enrichedData.type === 'movie' ? 'FILME' : 'SÉRIE';
    ctx.font = 'bold 26px Montserrat, Arial';
    ctx.textAlign = 'left';
    const typeW = ctx.measureText(typeBadge).width + (badgePadding * 2);
    this.roundRect(ctx, 80, badgeY, typeW, badgeHeight, 10);
    
    // Usar cor do tema (cyan/azul neon para filmes, purple/roxo para séries)
    const badgeTheme = enrichedData.type === 'movie' ? THEME_COLORS.cyan : THEME_COLORS.purple;
    const badgeThemeDark = enrichedData.type === 'movie' ? THEME_COLORS.blueDark : THEME_COLORS.purpleDark;
    const badgeGrad = ctx.createLinearGradient(80, badgeY, 80 + typeW, badgeY);
    badgeGrad.addColorStop(0, badgeTheme);
    badgeGrad.addColorStop(1, badgeThemeDark);
    ctx.fillStyle = badgeGrad;
    ctx.fill();
    ctx.fillStyle = THEME_COLORS.white;
    ctx.fillText(typeBadge, 80 + badgePadding, badgeY + 30);
    
    // Badge 2: Status (NOVO ou ATUALIZADA) - SEM EMOJIS
    const statusBadge = enrichedData.type === 'movie' ? 'NOVO' : 'ATUALIZADA';
    const statusW = ctx.measureText(statusBadge).width + (badgePadding * 2);
    const statusX = 80 + typeW + 15;
    this.roundRect(ctx, statusX, badgeY, statusW, badgeHeight, 10);
    ctx.fillStyle = `${badgeTheme}25`;
    ctx.fill();
    ctx.strokeStyle = `${badgeTheme}60`;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = badgeTheme;
    ctx.fillText(statusBadge, statusX + badgePadding, badgeY + 30);

    ctx.fillStyle = THEME_COLORS.white;
    ctx.font = 'bold 64px Montserrat, Arial';
    ctx.textAlign = 'center';
    const titleLines = this.wrapText(ctx, cleanTitle.toUpperCase(), WIDTH - 120, 2);
    let ty = Math.floor(HEIGHT * 0.58);
    titleLines.forEach(line => {
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
      ctx.fillText(line, WIDTH / 2, ty);
      ctx.shadowColor = 'transparent';
      ty += 75;
    });

    // ========== INFO CENTRALIZADA (Rating, Ano, Duração) ==========
    const infoY = ty + 45; // Aumentado de 30 para 45 (50% mais espaço)
    ctx.textAlign = 'center';
    
    // Rating
    ctx.font = 'bold 32px Montserrat, Arial';
    const ratingTxt = `★ ${rating.toFixed(1)}`;
    const ratingW = ctx.measureText(ratingTxt).width;
    ctx.fillStyle = theme;
    ctx.fillText(ratingTxt, WIDTH / 2 - 150, infoY);
    
    // Separador
    ctx.fillStyle = THEME_COLORS.grayDark;
    ctx.font = '32px Montserrat, Arial';
    ctx.fillText('•', WIDTH / 2 - 50, infoY);
    
    // Ano
    ctx.fillStyle = THEME_COLORS.gray;
    ctx.fillText(releaseInfo, WIDTH / 2, infoY);
    
    // Separador
    ctx.fillText('•', WIDTH / 2 + 50, infoY);
    
    // Duração/Temporadas
    const extra = enrichedData.type === 'movie'
      ? enrichedData.duration || ''
      : enrichedData.seasons || '';
    if (extra) {
      ctx.fillText(extra, WIDTH / 2 + 150, infoY);
    }

    const genresY = infoY + 75; // Aumentado de 70 para 75
    ctx.fillStyle = theme;
    ctx.font = '30px Montserrat, Arial';
    ctx.textAlign = 'center';
    ctx.fillText(genresText, WIDTH / 2, genresY);

    // ========== SINOPSE (MAIOR E MAIS PRÓXIMA DO LOGO) ==========
    const synY = genresY + 60; // Aumentado de 50 para 60 (20% mais espaço)
    ctx.fillStyle = THEME_COLORS.gray;
    ctx.font = '32px Montserrat, Arial'; // Aumentado de 28px para 32px
    let sy = synY;
    this.wrapText(ctx, synopsisText, WIDTH - 100, 3).forEach(line => {
      ctx.fillText(line, WIDTH / 2, sy);
      sy += 45; // Aumentado de 42 para 45
    });

    // ========== ELENCO PRINCIPAL (3 ATORES) ==========
    let castY = sy + 65; // Aumentado de 50 para 65 (30% mais espaço após sinopse)
    if (enrichedData.cast && enrichedData.cast.length > 0) {
      // Título "Elenco Principal"
      ctx.fillStyle = theme;
      ctx.font = 'bold 28px Montserrat, Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Elenco Principal', WIDTH / 2, castY);
      
      castY += 70; // Aumentado espaçamento entre título e fotos
      
      // Desenhar 3 atores
      const castCount = Math.min(enrichedData.cast.length, 3);
      const castSpacing = WIDTH / (castCount + 1);
      const castPhotoSize = 100;
      const castPhotoRadius = 50;
      const photoY = castY; // Y da foto (centro do círculo)
      
      for (let i = 0; i < castCount; i++) {
        const actor = enrichedData.cast[i];
        const castX = castSpacing * (i + 1) - castPhotoSize / 2;
        
        try {
          if (actor.profilePath) {
            const profileUrl = `https://image.tmdb.org/t/p/w185${actor.profilePath}`;
            // ⚠️ OTIMIZAÇÃO: Adicionar timeout de 10 segundos para carregar imagens de elenco
            const profilePromise = loadImage(profileUrl);
            const profileTimeout = new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error('Timeout: Carregamento de foto de elenco excedeu 10 segundos')), 10000);
            });
            const profileImg = await Promise.race([profilePromise, profileTimeout]);
            
            // Desenhar foto circular
            ctx.save();
            ctx.beginPath();
            ctx.arc(castX + castPhotoSize / 2, photoY, castPhotoRadius, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(profileImg, castX, photoY - castPhotoRadius, castPhotoSize, castPhotoSize);
            ctx.restore();
            
            // Borda circular
            ctx.beginPath();
            ctx.arc(castX + castPhotoSize / 2, photoY, castPhotoRadius, 0, Math.PI * 2);
            ctx.strokeStyle = `${theme}80`;
            ctx.lineWidth = 3;
            ctx.stroke();
          } else {
            // Placeholder circular
            ctx.beginPath();
            ctx.arc(castX + castPhotoSize / 2, photoY, castPhotoRadius, 0, Math.PI * 2);
            ctx.fillStyle = `${theme}30`;
            ctx.fill();
            ctx.strokeStyle = `${theme}60`;
            ctx.lineWidth = 3;
            ctx.stroke();
            
            // Inicial do nome
            ctx.fillStyle = theme;
            ctx.font = 'bold 36px Montserrat, Arial';
            ctx.textAlign = 'center';
            ctx.fillText(actor.name.charAt(0).toUpperCase(), castX + castPhotoSize / 2, photoY + 12);
          }
        } catch (e) {
          // Se falhar ao carregar imagem, desenhar placeholder
          ctx.beginPath();
          ctx.arc(castX + castPhotoSize / 2, photoY, castPhotoRadius, 0, Math.PI * 2);
          ctx.fillStyle = `${theme}30`;
          ctx.fill();
          ctx.strokeStyle = `${theme}60`;
          ctx.lineWidth = 3;
          ctx.stroke();
          
          ctx.fillStyle = theme;
          ctx.font = 'bold 36px Montserrat, Arial';
          ctx.textAlign = 'center';
          ctx.fillText(actor.name.charAt(0).toUpperCase(), castX + castPhotoSize / 2, photoY + 12);
        }
        
        // Nome do ator ABAIXO da foto (com espaçamento adequado)
        ctx.fillStyle = THEME_COLORS.white;
        ctx.font = '22px Montserrat, Arial';
        ctx.textAlign = 'center';
        const nameLines = this.wrapText(ctx, actor.name, castPhotoSize + 20, 2);
        let nameY = photoY + castPhotoRadius + 20; // Espaçamento de 20px abaixo da foto
        nameLines.forEach(line => {
          ctx.fillText(line, castX + castPhotoSize / 2, nameY);
          nameY += 28;
        });
      }
      
      // Calcular altura total do elenco (fotos + nomes)
      const nameHeights = enrichedData.cast.slice(0, 3).map(actor => {
        const nameLines = this.wrapText(ctx, actor.name, castPhotoSize + 20, 2);
        return nameLines.length * 28;
      });
      const maxNameHeight = nameHeights.length > 0 ? Math.max(...nameHeights) : 0;
      castY += castPhotoSize + maxNameHeight + 40; // Espaço após elenco completo
    }

    // WhatsApp no rodapé (sempre fixo no final)
    if (whatsapp) {
      const footerH = 70;
      const footerMargin = 30;
      const fy = HEIGHT - footerH - footerMargin;
      this.roundRect(ctx, 40, fy, WIDTH - 80, footerH, 16);
      ctx.fillStyle = `${theme}15`; ctx.fill();
      ctx.strokeStyle = `${theme}40`; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = THEME_COLORS.white;
      ctx.font = 'bold 30px Montserrat, Arial';
      ctx.textAlign = 'center';
      ctx.fillText(`WhatsApp: ${whatsapp}`, WIDTH / 2, fy + 46);
    }

    // Remover texto "PAINEL MASTER" e slogan para não poluir a área

    const topLine = ctx.createLinearGradient(0, 0, WIDTH, 0);
    topLine.addColorStop(0, theme);
    topLine.addColorStop(0.5, themeDark);
    topLine.addColorStop(1, theme);
    ctx.fillStyle = topLine;
    ctx.fillRect(0, 0, WIDTH, 4);

    const subDir = enrichedData.type === 'movie' ? 'movies' : 'series';
    // ⚠️ OTIMIZAÇÃO: Usar JPEG com qualidade 85% para reduzir tamanho (~70-80% menor que PNG)
    const fileName = `vertical_${enrichedData.type}_${enrichedData.tmdbId || Date.now()}_${Date.now()}.jpg`;
    const filePath = path.join(this.outputBase, subDir, 'vertical', fileName);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    // JPEG com qualidade 85% (boa qualidade visual, tamanho reduzido)
    const buffer = canvas.toBuffer('image/jpeg', { quality: 0.85 });
    fs.writeFileSync(filePath, buffer);
    const publicPath = filePath.replace(process.cwd(), '').replace(/\\/g, '/');

    await prisma.generatedBanner.create({
      data: {
        type: enrichedData.type,
        orientation: 'vertical',
        contentTitle: enrichedData.title,
        tmdbId: enrichedData.tmdbId ?? null,
        filePath: publicPath.startsWith('/') ? publicPath : `/${publicPath}`,
        importId: importId || null,
      },
    });

    return publicPath.startsWith('/') ? publicPath : `/${publicPath}`;
  }

  // ---------- Horizontal ----------
  async generateHorizontalBanner(data: ContentData, importId?: string): Promise<string> {
    // 🎯 SOLUÇÃO: Enriquecer com dados frescos do TMDB antes de gerar
    const enrichedData = await this.enrichWithTMDB(data);
    
    await this.loadConfig();
    this.ensureDirs(enrichedData.type);
    const cfg = this.config!;
    const logoImg = await this.loadLogo();
    const WIDTH = 1920, HEIGHT = 1080;
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');
    const theme = enrichedData.type === 'movie' ? THEME_COLORS.cyan : THEME_COLORS.purple;
    const themeDark = enrichedData.type === 'movie' ? THEME_COLORS.blueDark : THEME_COLORS.purpleDark;
    const cleanTitle = this.cleanTitle(enrichedData.title);
    const rawSyn = (enrichedData.synopsis || '').trim();
    const synopsisText = rawSyn.length > 10 ? rawSyn : 'Sinopse indisponível.';
    const rating = enrichedData.rating > 0 ? enrichedData.rating : 7.0;
    const releaseInfo = enrichedData.year && enrichedData.year.trim().length ? enrichedData.year.trim() : '—';
    const genresText = enrichedData.genres && enrichedData.genres.length ? enrichedData.genres.slice(0, 3).join('  •  ') : 'Gênero não informado';

    ctx.fillStyle = THEME_COLORS.bgDark;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    try {
      if (enrichedData.backdropUrl) {
        // ⚠️ OTIMIZAÇÃO: Adicionar timeout de 15 segundos para carregar backdrop
        const backdropPromise = loadImage(enrichedData.backdropUrl);
        const backdropTimeout = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Timeout: Carregamento de backdrop excedeu 15 segundos')), 15000);
        });
        const b = await Promise.race([backdropPromise, backdropTimeout]);
        ctx.globalAlpha = 0.4;
        ctx.drawImage(b, 0, 0, WIDTH, HEIGHT);
        ctx.globalAlpha = 1;
      }
    } catch {}
    const lateral = ctx.createLinearGradient(0, 0, WIDTH * 0.7, 0);
    lateral.addColorStop(0, 'rgba(10,14,26,0.95)');
    lateral.addColorStop(1, 'rgba(10,14,26,0.35)');
    ctx.fillStyle = lateral;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const pW = 400, pH = 600, pX = 80, pY = (HEIGHT - pH) / 2;
    try {
      // ⚠️ OTIMIZAÇÃO: Adicionar timeout de 15 segundos para carregar poster
      const posterPromise = loadImage(enrichedData.posterUrl);
      const posterTimeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Timeout: Carregamento de poster excedeu 15 segundos')), 15000);
      });
      const poster = await Promise.race([posterPromise, posterTimeout]);
      ctx.save();
      this.roundRect(ctx, pX, pY, pW, pH, 20);
      ctx.clip();
      ctx.drawImage(poster, pX, pY, pW, pH);
      ctx.restore();
      this.roundRect(ctx, pX, pY, pW, pH, 20);
      ctx.strokeStyle = `${theme}60`;
      ctx.lineWidth = 3;
      ctx.stroke();
    } catch {}

    const contentX = pX + pW + 60;
    // ========== BADGES NO TOPO ESQUERDO (sem cor #01f4fa/cyan) ==========
    let badgeY = pY - 10;
    const badgeHeight = 44;
    const badgePadding = 15;
    
    // Badge 1: Tipo (FILME ou SÉRIE) - SEM EMOJIS
    const typeBadge = enrichedData.type === 'movie' ? 'FILME' : 'SÉRIE';
    ctx.font = 'bold 26px Montserrat, Arial';
    ctx.textAlign = 'left';
    let badgeX = contentX;
    const typeW = ctx.measureText(typeBadge).width + (badgePadding * 2);
    this.roundRect(ctx, badgeX, badgeY, typeW, badgeHeight, 10);
    
    // Usar cor do tema (cyan/azul neon para filmes, purple/roxo para séries)
    const badgeTheme = enrichedData.type === 'movie' ? THEME_COLORS.cyan : THEME_COLORS.purple;
    const badgeThemeDark = enrichedData.type === 'movie' ? THEME_COLORS.blueDark : THEME_COLORS.purpleDark;
    const badgeGrad = ctx.createLinearGradient(badgeX, badgeY, badgeX + typeW, badgeY);
    badgeGrad.addColorStop(0, badgeTheme);
    badgeGrad.addColorStop(1, badgeThemeDark);
    ctx.fillStyle = badgeGrad;
    ctx.fill();
    ctx.fillStyle = THEME_COLORS.white;
    ctx.fillText(typeBadge, badgeX + badgePadding, badgeY + 30);
    
    // Badge 2: Status (NOVO ou ATUALIZADA) - SEM EMOJIS
    const statusBadge = enrichedData.type === 'movie' ? 'NOVO' : 'ATUALIZADA';
    badgeX += typeW + 15;
    const statusW = ctx.measureText(statusBadge).width + (badgePadding * 2);
    this.roundRect(ctx, badgeX, badgeY, statusW, badgeHeight, 10);
    ctx.fillStyle = `${badgeTheme}25`;
    ctx.fill();
    ctx.strokeStyle = `${badgeTheme}60`;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = badgeTheme;
    ctx.fillText(statusBadge, badgeX + badgePadding, badgeY + 30);
    
    // Iniciar o título abaixo dos badges
    let ty = badgeY + badgeHeight + 50; // Aumentado de 40 para 50 (25% mais espaço entre badges e título)
    ctx.fillStyle = THEME_COLORS.white;
    ctx.font = 'bold 54px Montserrat, Arial';
    ctx.textAlign = 'left';
    const titleLines = this.wrapText(ctx, cleanTitle.toUpperCase(), WIDTH - contentX - 80, 2);
    titleLines.forEach(line => {
      ctx.fillText(line, contentX, ty);
      ty += 62;
    });

    const infoY = ty + 40; // Aumentado de 30 para 40 (33% mais espaço entre título e info)
    ctx.fillStyle = theme;
    ctx.font = '32px Montserrat, Arial';
    ctx.fillText('★★★★★', contentX, infoY);
    ctx.fillStyle = THEME_COLORS.white;
    ctx.font = 'bold 32px Montserrat, Arial';
    ctx.fillText(rating.toFixed(1), contentX + 175, infoY);
    ctx.fillStyle = THEME_COLORS.grayDark;
    ctx.fillText('|', contentX + 235, infoY);
    ctx.fillStyle = THEME_COLORS.gray;
    ctx.fillText(releaseInfo, contentX + 265, infoY);
    ctx.fillStyle = THEME_COLORS.grayDark;
    ctx.fillText('|', contentX + 345, infoY);
    const extra = enrichedData.type === 'movie' ? enrichedData.duration : enrichedData.seasons;
    if (extra) {
      ctx.fillStyle = THEME_COLORS.gray;
      ctx.fillText(extra, contentX + 375, infoY);
    }

    const genresY = infoY + 60; // Aumentado de 55 para 60
    ctx.fillStyle = theme;
    ctx.font = '28px Montserrat, Arial';
    ctx.fillText(genresText, contentX, genresY);

    // ========== SINOPSE (MAIOR) ==========
    const synY = genresY + 60; // Aumentado de 50 para 60 (20% mais espaço)
    ctx.fillStyle = THEME_COLORS.gray;
    ctx.font = '28px Montserrat, Arial'; // Aumentado de 26px para 28px
    let sY = synY;
    this.wrapText(ctx, synopsisText, WIDTH - contentX - 80, 2).forEach(line => {
      ctx.fillText(line, contentX, sY);
      sY += 40; // Aumentado de 38 para 40
    });

    // ========== ELENCO PRINCIPAL (3 ATORES) ==========
    let castY = sY + 45; // Aumentado de 30 para 45 (50% mais espaço após sinopse)
    if (enrichedData.cast && enrichedData.cast.length > 0) {
      // Título "Elenco Principal"
      ctx.fillStyle = theme;
      ctx.font = 'bold 24px Montserrat, Arial';
      ctx.fillText('Elenco Principal', contentX, castY);
      
      castY += 50; // Aumentado de 40 para 50 (25% mais espaço entre título e fotos)
      
      // Desenhar 3 atores
      const castCount = Math.min(enrichedData.cast.length, 3);
      const castPhotoSize = 80;
      const castPhotoRadius = 40;
      const castSpacing = 120;
      const photoY = castY; // Y da foto (centro do círculo)
      
      for (let i = 0; i < castCount; i++) {
        const actor = enrichedData.cast[i];
        const castX = contentX + (i * castSpacing);
        
        try {
          if (actor.profilePath) {
            const profileUrl = `https://image.tmdb.org/t/p/w185${actor.profilePath}`;
            // ⚠️ OTIMIZAÇÃO: Adicionar timeout de 10 segundos para carregar imagens de elenco
            const profilePromise = loadImage(profileUrl);
            const profileTimeout = new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error('Timeout: Carregamento de foto de elenco excedeu 10 segundos')), 10000);
            });
            const profileImg = await Promise.race([profilePromise, profileTimeout]);
            
            // Desenhar foto circular
            ctx.save();
            ctx.beginPath();
            ctx.arc(castX + castPhotoSize / 2, photoY, castPhotoRadius, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(profileImg, castX, photoY - castPhotoRadius, castPhotoSize, castPhotoSize);
            ctx.restore();
            
            // Borda circular
            ctx.beginPath();
            ctx.arc(castX + castPhotoSize / 2, photoY, castPhotoRadius, 0, Math.PI * 2);
            ctx.strokeStyle = `${theme}80`;
            ctx.lineWidth = 2;
            ctx.stroke();
          } else {
            // Placeholder circular
            ctx.beginPath();
            ctx.arc(castX + castPhotoSize / 2, photoY, castPhotoRadius, 0, Math.PI * 2);
            ctx.fillStyle = `${theme}30`;
            ctx.fill();
            ctx.strokeStyle = `${theme}60`;
            ctx.lineWidth = 2;
            ctx.stroke();
            
            // Inicial do nome
            ctx.fillStyle = theme;
            ctx.font = 'bold 28px Montserrat, Arial';
            ctx.textAlign = 'center';
            ctx.fillText(actor.name.charAt(0).toUpperCase(), castX + castPhotoSize / 2, photoY + 10);
          }
        } catch (e) {
          // Se falhar ao carregar imagem, desenhar placeholder
          ctx.beginPath();
          ctx.arc(castX + castPhotoSize / 2, photoY, castPhotoRadius, 0, Math.PI * 2);
          ctx.fillStyle = `${theme}30`;
          ctx.fill();
          ctx.strokeStyle = `${theme}60`;
          ctx.lineWidth = 2;
          ctx.stroke();
          
          ctx.fillStyle = theme;
          ctx.font = 'bold 28px Montserrat, Arial';
          ctx.textAlign = 'center';
          ctx.fillText(actor.name.charAt(0).toUpperCase(), castX + castPhotoSize / 2, photoY + 10);
        }
        
        // Nome do ator ABAIXO da foto (com espaçamento adequado)
        ctx.fillStyle = THEME_COLORS.white;
        ctx.font = '18px Montserrat, Arial';
        ctx.textAlign = 'left';
        const nameLines = this.wrapText(ctx, actor.name, castPhotoSize, 1);
        const nameY = photoY + castPhotoRadius + 20; // Espaçamento de 20px abaixo da foto
        nameLines.forEach((line, idx) => {
          ctx.fillText(line, castX, nameY + (idx * 22));
        });
      }
      
      castY += castPhotoSize + 60; // Espaço após elenco
    } else {
      castY = sY + 30; // Se não tem elenco, usar posição após sinopse
    }

    // ========== LOGO NO RODAPÉ ==========
    const footerY = Math.min(castY + 40, HEIGHT - 100); // Ajustado para ficar mais próximo do elenco
    const logoSize = 60;
    
    if (logoImg) {
      // Desenhar logo configurada
      const logoX = contentX;
      const logoY = footerY - 15;
      
      // Fundo arredondado para logo
      this.roundRect(ctx, logoX - 8, logoY - 8, logoSize + 16, logoSize + 16, 15);
      ctx.fillStyle = `${theme}15`;
      ctx.fill();
      ctx.strokeStyle = `${theme}40`;
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // Desenhar logo
      ctx.drawImage(logoImg as any, logoX, logoY, logoSize, logoSize);
      logger.info(`[BannerGenerator] ✅ Logo desenhada no banner horizontal`);
    } else {
      // Placeholder de logo (se não tiver logo configurada)
      this.roundRect(ctx, contentX, footerY - 15, logoSize, logoSize, 15);
      const lg = ctx.createLinearGradient(contentX, footerY, contentX + logoSize, footerY + logoSize);
      lg.addColorStop(0, THEME_COLORS.cyan);
      lg.addColorStop(1, THEME_COLORS.blue);
      ctx.fillStyle = lg;
      ctx.fill();
      ctx.fillStyle = THEME_COLORS.white;
      ctx.beginPath();
      ctx.moveTo(contentX + 22, footerY - 3);
      ctx.lineTo(contentX + 22, footerY + 33);
      ctx.lineTo(contentX + 45, footerY + 15);
      ctx.closePath();
      ctx.fill();
      logger.info(`[BannerGenerator] ⚠️ Logo não configurada, usando placeholder`);
    }

    const bottom = ctx.createLinearGradient(0, HEIGHT - 4, WIDTH, HEIGHT - 4);
    bottom.addColorStop(0, theme);
    bottom.addColorStop(0.5, themeDark);
    bottom.addColorStop(1, theme);
    ctx.fillStyle = bottom;
    ctx.fillRect(0, HEIGHT - 4, WIDTH, 4);

    const subDir = enrichedData.type === 'movie' ? 'movies' : 'series';
    // ⚠️ OTIMIZAÇÃO: Usar JPEG com qualidade 85% para reduzir tamanho (~70-80% menor que PNG)
    const fileName = `horizontal_${enrichedData.type}_${enrichedData.tmdbId || Date.now()}_${Date.now()}.jpg`;
    const filePath = path.join(this.outputBase, subDir, 'horizontal', fileName);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    // JPEG com qualidade 85% (boa qualidade visual, tamanho reduzido)
    const buffer = canvas.toBuffer('image/jpeg', { quality: 0.85 });
    fs.writeFileSync(filePath, buffer);
    const publicPath = filePath.replace(process.cwd(), '').replace(/\\/g, '/');
    await prisma.generatedBanner.create({
      data: {
        type: enrichedData.type,
        orientation: 'horizontal',
        contentTitle: enrichedData.title,
        tmdbId: enrichedData.tmdbId ?? null,
        filePath: publicPath.startsWith('/') ? publicPath : `/${publicPath}`,
        importId: importId || null,
      },
    });
    return publicPath.startsWith('/') ? publicPath : `/${publicPath}`;
  }

  async generateBatchBanners(contents: ContentData[], importId: string, maxBanners = 30) {
    const limited = contents.slice(0, maxBanners);
    const vertical: string[] = [];
    const horizontal: string[] = [];
    
    // ⚠️ OTIMIZAÇÃO CRÍTICA: Processar em lotes menores para evitar sobrecarga de memória
    const BATCH_SIZE = 3; // Reduzido de 5 para 3 banners por vez
    const DELAY_BETWEEN_BATCHES = 5000; // Aumentado de 2s para 5 segundos entre lotes
    const DELAY_BETWEEN_BANNERS = 1000; // Aumentado de 500ms para 1 segundo entre banners
    
    logger.info(`[BannerGenerator] Processando ${limited.length} banners em lotes de ${BATCH_SIZE}...`);
    
    for (let batchStart = 0; batchStart < limited.length; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, limited.length);
      const batch = limited.slice(batchStart, batchEnd);
      
      logger.info(`[BannerGenerator] Processando lote ${Math.floor(batchStart / BATCH_SIZE) + 1}/${Math.ceil(limited.length / BATCH_SIZE)} (${batch.length} banners)...`);
      
      for (let i = 0; i < batch.length; i++) {
        const c = batch[i];
        try {
          logger.info(`[BannerGenerator] Gerando banners ${batchStart + i + 1}/${limited.length}: "${c.title}"`);
          
          // ⚠️ OTIMIZAÇÃO: Adicionar timeout para evitar travamento
          const bannerPromise = Promise.all([
            this.generateVerticalBanner(c, importId),
            this.generateHorizontalBanner(c, importId)
          ]);
          
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Timeout: Geração de banner excedeu 2 minutos')), 120000); // 2 minutos por banner
          });
          
          const [v, h] = await Promise.race([bannerPromise, timeoutPromise]);
          vertical.push(v);
          horizontal.push(h);
          
          logger.info(`[BannerGenerator] ✅ Banners gerados para "${c.title}"`);
          
          // Delay entre banners (exceto o último do lote)
          if (i < batch.length - 1) {
            await new Promise(r => setTimeout(r, DELAY_BETWEEN_BANNERS));
          }
        } catch (e: any) {
          logger.error(`[BannerGenerator] ❌ Erro em ${c.title}: ${e.message}`);
          // Continuar mesmo se um banner falhar
        }
      }
      
      // Delay entre lotes (exceto o último lote)
      if (batchEnd < limited.length) {
        logger.info(`[BannerGenerator] Aguardando ${DELAY_BETWEEN_BATCHES}ms antes do próximo lote...`);
        await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES));
      }
    }
    
    logger.info(`[BannerGenerator] ✅ Todos os banners processados: ${vertical.length} verticais, ${horizontal.length} horizontais`);
    return { vertical, horizontal };
  }
}

export default new BannerGeneratorService();
