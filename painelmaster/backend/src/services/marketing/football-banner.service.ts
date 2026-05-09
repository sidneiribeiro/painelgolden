import { createCanvas, loadImage, registerFont, CanvasRenderingContext2D, Image } from 'canvas';
import path from 'path';
import fs from 'fs';
import { prisma } from '../../config/database.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('FootballBanner');

const FONTS_DIR = path.join(process.cwd(), 'assets', 'fonts');
try {
  registerFont(path.join(FONTS_DIR, 'Montserrat-Bold.ttf'), { family: 'Montserrat', weight: 'bold' });
  registerFont(path.join(FONTS_DIR, 'Montserrat-Regular.ttf'), { family: 'Montserrat', weight: 'normal' });
} catch {}

const COLORS = {
  // Cores principais
  primary: '#00D4AA',      // Verde-água vibrante
  primaryDark: '#00A080',
  secondary: '#1A73E8',    // Azul Google
  accent: '#FFD700',       // Dourado
  // Backgrounds
  bgDark: '#0A0F1C',       // Azul muito escuro
  bgCard: '#151C2C',       // Azul escuro para cards
  bgCardHover: '#1E2740',
  // Texto
  white: '#FFFFFF',
  textLight: '#E8EAED',
  textMuted: '#9AA0A6',
  textDark: '#5F6368',
  // Destaques
  live: '#FF4444',         // Vermelho para "AO VIVO"
  cyan: '#00E5FF',
  gold: '#FFD700',
  green: '#4CAF50',
  blue: '#1E88E5',          // Azul para gradientes
};

const STORAGE_DIR = path.join(process.cwd(), 'storage', 'banners', 'football');
fs.mkdirSync(STORAGE_DIR, { recursive: true });

// ✅ Mapeamento expandido de times brasileiros e internacionais
const TEAM_LOGOS: Record<string, string> = {
  // Brasileiros - Série A
  Flamengo: 'https://logodetimes.com/times/flamengo/logo-flamengo-256.png',
  Palmeiras: 'https://logodetimes.com/times/palmeiras/logo-palmeiras-256.png',
  Corinthians: 'https://logodetimes.com/times/corinthians/logo-corinthians-256.png',
  'São Paulo': 'https://logodetimes.com/times/sao-paulo/logo-sao-paulo-256.png',
  Santos: 'https://logodetimes.com/times/santos/logo-santos-256.png',
  Fluminense: 'https://logodetimes.com/times/fluminense/logo-fluminense-256.png',
  Botafogo: 'https://logodetimes.com/times/botafogo/logo-botafogo-256.png',
  Vasco: 'https://logodetimes.com/times/vasco-da-gama/logo-vasco-256.png',
  'Atlético-MG': 'https://logodetimes.com/times/atletico-mineiro/logo-atletico-mineiro-256.png',
  'Atletico-MG': 'https://logodetimes.com/times/atletico-mineiro/logo-atletico-mineiro-256.png',
  'Atlético Mineiro': 'https://logodetimes.com/times/atletico-mineiro/logo-atletico-mineiro-256.png',
  Cruzeiro: 'https://logodetimes.com/times/cruzeiro/logo-cruzeiro-256.png',
  'Athletico-PR': 'https://logodetimes.com/times/atletico-paranaense/logo-atletico-paranaense-256.png',
  'Athletico Paranaense': 'https://logodetimes.com/times/atletico-paranaense/logo-atletico-paranaense-256.png',
  Grêmio: 'https://logodetimes.com/times/gremio/logo-gremio-256.png',
  Internacional: 'https://logodetimes.com/times/internacional/logo-internacional-256.png',
  Bahia: 'https://logodetimes.com/times/bahia/logo-bahia-256.png',
  Fortaleza: 'https://logodetimes.com/times/fortaleza/logo-fortaleza-256.png',
  Ceará: 'https://logodetimes.com/times/ceara/logo-ceara-256.png',
  'Red Bull Bragantino': 'https://logodetimes.com/times/red-bull-bragantino/logo-red-bull-bragantino-256.png',
  Bragantino: 'https://logodetimes.com/times/red-bull-bragantino/logo-red-bull-bragantino-256.png',
  Cuiabá: 'https://logodetimes.com/times/cuiaba/logo-cuiaba-256.png',
  Goiás: 'https://logodetimes.com/times/goias/logo-goias-256.png',
  'América-MG': 'https://logodetimes.com/times/america-mineiro/logo-america-mineiro-256.png',
  Coritiba: 'https://logodetimes.com/times/coritiba/logo-coritiba-256.png',
  'Atlético-GO': 'https://logodetimes.com/times/atletico-goianiense/logo-atletico-goianiense-256.png',
  Vitória: 'https://logodetimes.com/times/vitoria/logo-vitoria-256.png',
  Sport: 'https://logodetimes.com/times/sport/logo-sport-256.png',
  Juventude: 'https://logodetimes.com/times/juventude/logo-juventude-256.png',
  Chapecoense: 'https://logodetimes.com/times/chapecoense/logo-chapecoense-256.png',
  // Europeus principais
  'Real Madrid': 'https://logodetimes.com/times/real-madrid/logo-real-madrid-256.png',
  Barcelona: 'https://logodetimes.com/times/barcelona/logo-barcelona-256.png',
  'Manchester City': 'https://logodetimes.com/times/manchester-city/logo-manchester-city-256.png',
  'Manchester United': 'https://logodetimes.com/times/manchester-united/logo-manchester-united-256.png',
  Liverpool: 'https://logodetimes.com/times/liverpool/logo-liverpool-256.png',
  Chelsea: 'https://logodetimes.com/times/chelsea/logo-chelsea-256.png',
  Arsenal: 'https://logodetimes.com/times/arsenal/logo-arsenal-256.png',
  'Bayern Munich': 'https://logodetimes.com/times/bayern-de-munique/logo-bayern-de-munique-256.png',
  'Bayern de Munique': 'https://logodetimes.com/times/bayern-de-munique/logo-bayern-de-munique-256.png',
  'Paris Saint-Germain': 'https://logodetimes.com/times/psg-paris-saint-germain/logo-psg-paris-saint-germain-256.png',
  PSG: 'https://logodetimes.com/times/psg-paris-saint-germain/logo-psg-paris-saint-germain-256.png',
  Juventus: 'https://logodetimes.com/times/juventus/logo-juventus-256.png',
  'AC Milan': 'https://logodetimes.com/times/milan/logo-milan-256.png',
  Milan: 'https://logodetimes.com/times/milan/logo-milan-256.png',
  Inter: 'https://logodetimes.com/times/internazionale/logo-internazionale-256.png',
  'Inter Milan': 'https://logodetimes.com/times/internazionale/logo-internazionale-256.png',
  // Argentinos
  'River Plate': 'https://logodetimes.com/times/river-plate/logo-river-plate-256.png',
  'Boca Juniors': 'https://logodetimes.com/times/boca-juniors/logo-boca-juniors-256.png',
  // Premier League (Inglaterra)
  Brighton: 'https://logodetimes.com/times/brighton-hove-albion/logo-brighton-hove-albion-256.png',
  'Brighton & Hove Albion': 'https://logodetimes.com/times/brighton-hove-albion/logo-brighton-hove-albion-256.png',
  Everton: 'https://logodetimes.com/times/everton/logo-everton-256.png',
  'Leeds United': 'https://logodetimes.com/times/leeds-united/logo-leeds-united-256.png',
  Leeds: 'https://logodetimes.com/times/leeds-united/logo-leeds-united-256.png',
  Wolverhampton: 'https://logodetimes.com/times/wolverhampton-wanderers/logo-wolverhampton-wanderers-256.png',
  Wolves: 'https://logodetimes.com/times/wolverhampton-wanderers/logo-wolverhampton-wanderers-256.png',
  Bournemouth: 'https://logodetimes.com/times/bournemouth/logo-bournemouth-256.png',
  'AFC Bournemouth': 'https://logodetimes.com/times/bournemouth/logo-bournemouth-256.png',
  Tottenham: 'https://logodetimes.com/times/tottenham-hotspur/logo-tottenham-hotspur-256.png',
  'Tottenham Hotspur': 'https://logodetimes.com/times/tottenham-hotspur/logo-tottenham-hotspur-256.png',
  Newcastle: 'https://logodetimes.com/times/newcastle-united/logo-newcastle-united-256.png',
  'Newcastle United': 'https://logodetimes.com/times/newcastle-united/logo-newcastle-united-256.png',
  'Aston Villa': 'https://logodetimes.com/times/aston-villa/logo-aston-villa-256.png',
  'West Ham': 'https://logodetimes.com/times/west-ham-united/logo-west-ham-united-256.png',
  'West Ham United': 'https://logodetimes.com/times/west-ham-united/logo-west-ham-united-256.png',
  'Crystal Palace': 'https://logodetimes.com/times/crystal-palace/logo-crystal-palace-256.png',
  Fulham: 'https://logodetimes.com/times/fulham/logo-fulham-256.png',
  Brentford: 'https://logodetimes.com/times/brentford/logo-brentford-256.png',
  'Nottingham Forest': 'https://logodetimes.com/times/nottingham-forest/logo-nottingham-forest-256.png',
  Nottingham: 'https://logodetimes.com/times/nottingham-forest/logo-nottingham-forest-256.png',
  Southampton: 'https://logodetimes.com/times/southampton/logo-southampton-256.png',
  Leicester: 'https://logodetimes.com/times/leicester-city/logo-leicester-city-256.png',
  'Leicester City': 'https://logodetimes.com/times/leicester-city/logo-leicester-city-256.png',
  Ipswich: 'https://logodetimes.com/times/ipswich-town/logo-ipswich-town-256.png',
  'Ipswich Town': 'https://logodetimes.com/times/ipswich-town/logo-ipswich-town-256.png',
  // Bundesliga (Alemanha)
  'Eintracht Frankfurt': 'https://logodetimes.com/times/eintracht-frankfurt/logo-eintracht-frankfurt-256.png',
  Frankfurt: 'https://logodetimes.com/times/eintracht-frankfurt/logo-eintracht-frankfurt-256.png',
  'Bayer Leverkusen': 'https://logodetimes.com/times/bayer-leverkusen/logo-bayer-leverkusen-256.png',
  Leverkusen: 'https://logodetimes.com/times/bayer-leverkusen/logo-bayer-leverkusen-256.png',
  'RB Leipzig': 'https://logodetimes.com/times/rb-leipzig/logo-rb-leipzig-256.png',
  Leipzig: 'https://logodetimes.com/times/rb-leipzig/logo-rb-leipzig-256.png',
  Mainz: 'https://logodetimes.com/times/mainz-05/logo-mainz-05-256.png',
  'Mainz 05': 'https://logodetimes.com/times/mainz-05/logo-mainz-05-256.png',
  'Werder Bremen': 'https://logodetimes.com/times/werder-bremen/logo-werder-bremen-256.png',
  Bremen: 'https://logodetimes.com/times/werder-bremen/logo-werder-bremen-256.png',
  'Borussia Mönchengladbach': 'https://logodetimes.com/times/borussia-monchengladbach/logo-borussia-monchengladbach-256.png',
  Gladbach: 'https://logodetimes.com/times/borussia-monchengladbach/logo-borussia-monchengladbach-256.png',
  'Borussia Dortmund': 'https://logodetimes.com/times/borussia-dortmund/logo-borussia-dortmund-256.png',
  Dortmund: 'https://logodetimes.com/times/borussia-dortmund/logo-borussia-dortmund-256.png',
  Augsburg: 'https://logodetimes.com/times/fc-augsburg/logo-fc-augsburg-256.png',
  'St. Pauli': 'https://logodetimes.com/times/st-pauli/logo-st-pauli-256.png',
  Hoffenheim: 'https://logodetimes.com/times/hoffenheim/logo-hoffenheim-256.png',
  'Union Berlin': 'https://logodetimes.com/times/union-berlin/logo-union-berlin-256.png',
  Stuttgart: 'https://logodetimes.com/times/vfb-stuttgart/logo-vfb-stuttgart-256.png',
  'VfB Stuttgart': 'https://logodetimes.com/times/vfb-stuttgart/logo-vfb-stuttgart-256.png',
  Freiburg: 'https://logodetimes.com/times/freiburg/logo-freiburg-256.png',
  'SC Freiburg': 'https://logodetimes.com/times/freiburg/logo-freiburg-256.png',
  Wolfsburg: 'https://logodetimes.com/times/wolfsburg/logo-wolfsburg-256.png',
  'VfL Wolfsburg': 'https://logodetimes.com/times/wolfsburg/logo-wolfsburg-256.png',
  // La Liga (Espanha)
  'Atlético Madrid': 'https://logodetimes.com/times/atletico-de-madrid/logo-atletico-de-madrid-256.png',
  'Atletico Madrid': 'https://logodetimes.com/times/atletico-de-madrid/logo-atletico-de-madrid-256.png',
  Atletico: 'https://logodetimes.com/times/atletico-de-madrid/logo-atletico-de-madrid-256.png',
  'Real Sociedad': 'https://logodetimes.com/times/real-sociedad/logo-real-sociedad-256.png',
  Sevilla: 'https://logodetimes.com/times/sevilla/logo-sevilla-256.png',
  Valencia: 'https://logodetimes.com/times/valencia/logo-valencia-256.png',
  Villarreal: 'https://logodetimes.com/times/villarreal/logo-villarreal-256.png',
  'Athletic Bilbao': 'https://logodetimes.com/times/athletic-bilbao/logo-athletic-bilbao-256.png',
  Bilbao: 'https://logodetimes.com/times/athletic-bilbao/logo-athletic-bilbao-256.png',
  Betis: 'https://logodetimes.com/times/real-betis/logo-real-betis-256.png',
  'Real Betis': 'https://logodetimes.com/times/real-betis/logo-real-betis-256.png',
  // Serie A (Itália)
  Roma: 'https://logodetimes.com/times/roma/logo-roma-256.png',
  'AS Roma': 'https://logodetimes.com/times/roma/logo-roma-256.png',
  Napoli: 'https://logodetimes.com/times/napoli/logo-napoli-256.png',
  Lazio: 'https://logodetimes.com/times/lazio/logo-lazio-256.png',
  Fiorentina: 'https://logodetimes.com/times/fiorentina/logo-fiorentina-256.png',
  Atalanta: 'https://logodetimes.com/times/atalanta/logo-atalanta-256.png',
  Bologna: 'https://logodetimes.com/times/bologna/logo-bologna-256.png',
  Torino: 'https://logodetimes.com/times/torino/logo-torino-256.png',
  Sassuolo: 'https://logodetimes.com/times/sassuolo/logo-sassuolo-256.png',
  Pisa: 'https://logodetimes.com/times/pisa/logo-pisa-256.png',
  // Ligue 1 (França)
  Marseille: 'https://logodetimes.com/times/olympique-de-marseille/logo-olympique-de-marseille-256.png',
  'Olympique Marseille': 'https://logodetimes.com/times/olympique-de-marseille/logo-olympique-de-marseille-256.png',
  Lyon: 'https://logodetimes.com/times/olympique-lyonnais/logo-olympique-lyonnais-256.png',
  'Olympique Lyon': 'https://logodetimes.com/times/olympique-lyonnais/logo-olympique-lyonnais-256.png',
  Monaco: 'https://logodetimes.com/times/monaco/logo-monaco-256.png',
  'AS Monaco': 'https://logodetimes.com/times/monaco/logo-monaco-256.png',
  Lille: 'https://logodetimes.com/times/lille/logo-lille-256.png',
  Nice: 'https://logodetimes.com/times/nice/logo-nice-256.png',
  // Brasileiros Série B e outros
  'Ponte Preta': 'https://logodetimes.com/times/ponte-preta/logo-ponte-preta-256.png',
  Guarani: 'https://logodetimes.com/times/guarani/logo-guarani-256.png',
  Mirassol: 'https://logodetimes.com/times/mirassol/logo-mirassol-256.png',
  Novorizontino: 'https://logodetimes.com/times/novorizontino/logo-novorizontino-256.png',
  'Botafogo-SP': 'https://logodetimes.com/times/botafogo-sp/logo-botafogo-sp-256.png',
  'Ituano': 'https://logodetimes.com/times/ituano/logo-ituano-256.png',
  'CRB': 'https://logodetimes.com/times/crb/logo-crb-256.png',
  'CSA': 'https://logodetimes.com/times/csa/logo-csa-256.png',
  'Náutico': 'https://logodetimes.com/times/nautico/logo-nautico-256.png',
  'Santa Cruz': 'https://logodetimes.com/times/santa-cruz/logo-santa-cruz-256.png',
  'ABC': 'https://logodetimes.com/times/abc/logo-abc-256.png',
  'América-RN': 'https://logodetimes.com/times/america-rn/logo-america-rn-256.png',
  Sampaio: 'https://logodetimes.com/times/sampaio-correa/logo-sampaio-correa-256.png',
  'Sampaio Corrêa': 'https://logodetimes.com/times/sampaio-correa/logo-sampaio-correa-256.png',
  Londrina: 'https://logodetimes.com/times/londrina/logo-londrina-256.png',
  Operário: 'https://logodetimes.com/times/operario-pr/logo-operario-pr-256.png',
  'Operário-PR': 'https://logodetimes.com/times/operario-pr/logo-operario-pr-256.png',
  Avaí: 'https://logodetimes.com/times/avai/logo-avai-256.png',
  Figueirense: 'https://logodetimes.com/times/figueirense/logo-figueirense-256.png',
  Criciúma: 'https://logodetimes.com/times/criciuma/logo-criciuma-256.png',
  Paysandu: 'https://logodetimes.com/times/paysandu/logo-paysandu-256.png',
  Remo: 'https://logodetimes.com/times/remo/logo-remo-256.png',
};

export interface MatchData {
  id?: number;
  homeTeam: string;
  homeTeamLogo?: string;
  awayTeam: string;
  awayTeamLogo?: string;
  competition: string;
  competitionLogo?: string;
  matchTime: string;
  channel?: string;  // Canal mapeado do XUI (mantido para compatibilidade)
  channels?: string[]; // ✨ NOVO: Lista de canais da API do GE (onde passa na TV)
}

export class FootballBannerService {
  constructor() {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }

  private async loadPainelLogo(): Promise<any> {
    try {
      const config = await prisma.marketingConfig.findFirst();
      if (config?.painelLogo) {
        // Suporta: URL absoluta, caminho /storage/..., ou caminho relativo em disco
        if (config.painelLogo.startsWith('http')) {
          return await loadImage(config.painelLogo);
        }
        const absPath = config.painelLogo.startsWith('/')
          ? path.join(process.cwd(), config.painelLogo)
          : path.join(process.cwd(), config.painelLogo);
        return await loadImage(absPath);
      }
    } catch (e: any) {
      logger.warn('[FootballBanner] Falha ao carregar logo do painel:', e.message);
    }
    return null;
  }

  /**
   * ✅ MELHORADO: Carrega logo do time com múltiplas tentativas e fallbacks
   * Prioridade: Mapeamento local (PNG) > API-Football > TheSportsDB > Placeholder
   * 
   * ⚠️ A API GE retorna SVGs que não funcionam bem com canvas, então priorizamos PNGs
   */
  private async loadTeamLogo(teamName: string, providedUrl?: string): Promise<Image | null> {
    const normalizedName = teamName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    
    // 1. ✅ PRIORIDADE: Tentar mapeamento local primeiro (sempre PNG, mais confiável)
    for (const [name, url] of Object.entries(TEAM_LOGOS)) {
      const normalizedMapName = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (normalizedName.includes(normalizedMapName) || normalizedMapName.includes(normalizedName)) {
        try {
          const logo = await this.loadImageWithTimeout(url, 5000);
          if (logo) {
            logger.debug(`[FootballBanner] ✅ Logo local: ${teamName} -> ${name}`);
            return logo;
          }
        } catch {}
      }
    }
    
    // 2. Tentar buscar por partes do nome (ex: "Flamengo RJ" -> "Flamengo")
    const nameParts = teamName.split(/[\s-]+/);
    for (const part of nameParts) {
      if (part.length < 3) continue;
      for (const [name, url] of Object.entries(TEAM_LOGOS)) {
        if (name.toLowerCase().includes(part.toLowerCase()) || part.toLowerCase().includes(name.toLowerCase().substring(0, 4))) {
          try {
            const logo = await this.loadImageWithTimeout(url, 3000);
            if (logo) {
              logger.debug(`[FootballBanner] ✅ Logo por parte: ${teamName} -> ${name}`);
              return logo;
            }
          } catch {}
        }
      }
    }
    
    // 3. Tentar URL da API se não for SVG (ou tentar converter SVG para PNG URL)
    if (providedUrl && providedUrl.trim()) {
      let urlToTry = providedUrl;
      
      // Se for SVG do GE, tentar buscar versão PNG (alguns times têm)
      if (providedUrl.includes('.svg')) {
        // Tentar substituir .svg por .png
        urlToTry = providedUrl.replace('.svg', '.png');
      }
      
      try {
        const logo = await this.loadImageWithTimeout(urlToTry, 5000);
        if (logo) {
          logger.debug(`[FootballBanner] ✅ Logo da API: ${teamName}`);
          return logo;
        }
      } catch {}
      
      // Se PNG não funcionou e era SVG, tentar o SVG original mesmo assim
      if (urlToTry !== providedUrl) {
        try {
          const logo = await this.loadImageWithTimeout(providedUrl, 5000);
          if (logo) {
            logger.debug(`[FootballBanner] ✅ Logo SVG da API: ${teamName}`);
            return logo;
          }
        } catch {}
      }
    }
    
    // 4. ✅ NOVO: Tentar TheSportsDB como fallback (sempre tem PNG)
    try {
      const theSportsDbLogo = await this.fetchLogoFromTheSportsDB(teamName);
      if (theSportsDbLogo) {
        logger.debug(`[FootballBanner] ✅ Logo TheSportsDB: ${teamName}`);
        return theSportsDbLogo;
      }
    } catch {}
    
    logger.warn(`[FootballBanner] ⚠️ Sem logo para: ${teamName} - usando placeholder`);
    return null;
  }
  
  /**
   * Busca logo do time na TheSportsDB (sempre retorna PNG)
   */
  private async fetchLogoFromTheSportsDB(teamName: string): Promise<Image | null> {
    try {
      // Normalizar nome para busca
      const searchName = encodeURIComponent(teamName);
      const url = `https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${searchName}`;
      
      const response = await fetch(url, { 
        signal: AbortSignal.timeout(5000),
        headers: { 'User-Agent': 'PainelIPTV/1.0' }
      });
      
      if (!response.ok) return null;
      
      const data = await response.json() as { teams?: Array<{ strTeamBadge?: string; strTeamLogo?: string }> };
      if (data.teams && data.teams.length > 0) {
        const team = data.teams[0];
        const badgeUrl = team.strTeamBadge || team.strTeamLogo;
        
        if (badgeUrl) {
          return await this.loadImageWithTimeout(badgeUrl, 5000);
        }
      }
    } catch (e: any) {
      logger.debug(`[FootballBanner] TheSportsDB falhou para ${teamName}: ${e.message}`);
    }
    return null;
  }
  
  /**
   * Carrega imagem com timeout para evitar travamentos
   */
  private async loadImageWithTimeout(url: string, timeoutMs: number): Promise<Image | null> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(null);
      }, timeoutMs);
      
      loadImage(url)
        .then((img) => {
          clearTimeout(timeout);
          resolve(img);
        })
        .catch(() => {
          clearTimeout(timeout);
          resolve(null);
        });
    });
  }

  /**
   * ✅ MELHORADO: Placeholder mais bonito e profissional quando não há escudo
   */
  private drawTeamPlaceholder(ctx: CanvasRenderingContext2D, teamName: string, x: number, y: number, size: number) {
    // Gradiente de fundo mais moderno (azul escuro)
    const gradient = ctx.createRadialGradient(x + size / 2, y + size / 2, 0, x + size / 2, y + size / 2, size / 2);
    gradient.addColorStop(0, '#2A3F5F');
    gradient.addColorStop(0.7, '#1A2A40');
    gradient.addColorStop(1, '#0D1B2A');
    
    // Círculo principal
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
    
    // Borda com gradiente cyan
    const borderGrad = ctx.createLinearGradient(x, y, x + size, y + size);
    borderGrad.addColorStop(0, COLORS.primary);
    borderGrad.addColorStop(1, COLORS.cyan);
    ctx.strokeStyle = borderGrad;
    ctx.lineWidth = 3;
    ctx.stroke();
    
    // Sigla do time (primeiras letras)
    const sigla = teamName
      .split(/[\s-]+/)
      .filter(w => w.length > 0)
      .map(w => w[0].toUpperCase())
      .join('')
      .substring(0, 3);
    
    ctx.fillStyle = COLORS.white;
    ctx.font = `bold ${Math.floor(size / 2.5)}px Montserrat, Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sigla, x + size / 2, y + size / 2);
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

  private drawPlayIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
    this.roundRect(ctx, x, y, size, size, 18);
    const playGrad = ctx.createLinearGradient(x, y, x + size, y + size);
    playGrad.addColorStop(0, COLORS.cyan);
    playGrad.addColorStop(1, COLORS.blue);
    ctx.fillStyle = playGrad;
    ctx.fill();
    ctx.fillStyle = COLORS.white;
    ctx.beginPath();
    ctx.moveTo(x + 25, y + 18);
    ctx.lineTo(x + 25, y + size - 18);
    ctx.lineTo(x + size - 18, y + size / 2);
    ctx.closePath();
    ctx.fill();
  }

  async generateDailyMatchesBanner(matches: MatchData[]): Promise<string[]> {
    const MATCHES_PER_BANNER = 5;
    const banners: string[] = [];
    const groups: MatchData[][] = [];
    for (let i = 0; i < matches.length; i += MATCHES_PER_BANNER) {
      groups.push(matches.slice(i, i + MATCHES_PER_BANNER));
    }
    const config = await prisma.marketingConfig.findFirst();
    const painelName = config?.painelName || 'PAINEL MASTER';
    const painelLogo = await this.loadPainelLogo();

    for (let i = 0; i < groups.length; i++) {
      const banner = await this.generateSingleBanner(groups[i], painelName, painelLogo, i + 1);
      banners.push(banner);
    }
    return banners;
  }

  private async generateSingleBanner(matches: MatchData[], painelName: string, painelLogo: any, bannerNumber: number): Promise<string> {
    const WIDTH = 1080;
    const HEIGHT = 1920;
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');

    // ========== FUNDO GRADIENTE MODERNO ==========
    const bgGradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    bgGradient.addColorStop(0, '#0D1B2A');
    bgGradient.addColorStop(0.5, '#1B263B');
    bgGradient.addColorStop(1, '#0D1B2A');
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Padrão de linhas diagonais sutis
    ctx.strokeStyle = 'rgba(255,255,255,0.02)';
    ctx.lineWidth = 1;
    for (let i = -HEIGHT; i < WIDTH + HEIGHT; i += 50) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + HEIGHT, HEIGHT);
      ctx.stroke();
    }

    // Barra superior com gradiente cyan/verde
    const topLine = ctx.createLinearGradient(0, 0, WIDTH, 0);
    topLine.addColorStop(0, COLORS.primary);
    topLine.addColorStop(0.5, COLORS.cyan);
    topLine.addColorStop(1, COLORS.primary);
    ctx.fillStyle = topLine;
    ctx.fillRect(0, 0, WIDTH, 6);

    // ========== LOGO DO PAINEL ==========
    const logoY = 40;
    const logoSize = 100;
    
    if (painelLogo) {
      const logoStartX = (WIDTH - logoSize) / 2;
      try {
        ctx.drawImage(painelLogo, logoStartX, logoY, logoSize, logoSize);
      } catch (error: any) {
        this.drawPlayIcon(ctx, logoStartX, logoY, logoSize);
      }
    } else {
      const playSize = 60;
      ctx.font = 'bold 40px Montserrat, Arial';
      const textWidth = ctx.measureText(painelName).width;
      const totalWidth = playSize + 15 + textWidth;
      const logoStartX = (WIDTH - totalWidth) / 2;
      this.drawPlayIcon(ctx, logoStartX, logoY + 10, playSize);
      const nameGrad = ctx.createLinearGradient(logoStartX + playSize + 15, 0, logoStartX + playSize + 15 + textWidth, 0);
      nameGrad.addColorStop(0, COLORS.primary);
      nameGrad.addColorStop(1, COLORS.cyan);
      ctx.fillStyle = nameGrad;
      ctx.textAlign = 'left';
      ctx.fillText(painelName, logoStartX + playSize + 15, logoY + 50);
    }

    // ========== BADGE "JOGOS DO DIA" ==========
    const badgeY = logoY + logoSize + 40;
    const badgeText = 'JOGOS DO DIA';
    ctx.font = 'bold 42px Montserrat, Arial';
    const badgeWidth = ctx.measureText(badgeText).width + 70;
    const badgeX = (WIDTH - badgeWidth) / 2;
    const badgeHeight = 65;
    
    this.roundRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, 32);
    const badgeGrad = ctx.createLinearGradient(badgeX, badgeY, badgeX + badgeWidth, badgeY + badgeHeight);
    badgeGrad.addColorStop(0, COLORS.primary);
    badgeGrad.addColorStop(1, COLORS.primaryDark);
    ctx.fillStyle = badgeGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    ctx.fillStyle = COLORS.white;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, WIDTH / 2, badgeY + badgeHeight / 2);
    ctx.textBaseline = 'alphabetic';

    // ========== DATA ==========
    const dateY = badgeY + badgeHeight + 35;
    const today = new Date();
    const opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: '2-digit', month: 'long' };
    let dateStr = today.toLocaleDateString('pt-BR', opts);
    dateStr = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
    ctx.font = '24px Montserrat, Arial';
    ctx.fillStyle = COLORS.textMuted;
    ctx.fillText(dateStr, WIDTH / 2, dateY);

    const cardStartY = dateY + 50;
    const cardHeight = 320;
    const cardSpacing = 25;
    const cardPadding = 35;

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const cardY = cardStartY + i * (cardHeight + cardSpacing);
      const cardW = WIDTH - cardPadding * 2;
      
      // ========== CARD GLASSMORPHISM ==========
      this.roundRect(ctx, cardPadding, cardY, cardW, cardHeight, 20);
      const cardGrad = ctx.createLinearGradient(cardPadding, cardY, cardPadding + cardW, cardY + cardHeight);
      cardGrad.addColorStop(0, 'rgba(255,255,255,0.08)');
      cardGrad.addColorStop(0.5, 'rgba(255,255,255,0.04)');
      cardGrad.addColorStop(1, 'rgba(255,255,255,0.08)');
      ctx.fillStyle = cardGrad;
      ctx.fill();
      
      const borderGrad = ctx.createLinearGradient(cardPadding, cardY, cardPadding + cardW, cardY);
      borderGrad.addColorStop(0, 'rgba(0, 212, 170, 0.5)');
      borderGrad.addColorStop(0.5, 'rgba(0, 229, 255, 0.3)');
      borderGrad.addColorStop(1, 'rgba(0, 212, 170, 0.5)');
      ctx.strokeStyle = borderGrad;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // ========== HEADER: Competição + Horário ==========
      const headerY = cardY + 38;
      
      // Competição (esquerda)
      ctx.font = 'bold 20px Montserrat, Arial';
      ctx.fillStyle = COLORS.textMuted;
      ctx.textAlign = 'left';
      const compText = match.competition.length > 28 ? match.competition.substring(0, 26) + '...' : match.competition;
      ctx.fillText(compText, cardPadding + 20, headerY);

      // Horário (direita) com badge
      ctx.textAlign = 'right';
      ctx.font = 'bold 24px Montserrat, Arial';
      const timeText = match.matchTime;
      const timeWidth = ctx.measureText(timeText).width + 24;
      const timeX = WIDTH - cardPadding - 20 - timeWidth;
      
      this.roundRect(ctx, timeX, headerY - 20, timeWidth, 32, 16);
      const timeGrad = ctx.createLinearGradient(timeX, headerY - 20, timeX + timeWidth, headerY - 20);
      timeGrad.addColorStop(0, 'rgba(0, 212, 170, 0.4)');
      timeGrad.addColorStop(1, 'rgba(0, 229, 255, 0.4)');
      ctx.fillStyle = timeGrad;
      ctx.fill();
      ctx.fillStyle = COLORS.primary;
      ctx.fillText(timeText, WIDTH - cardPadding - 20, headerY);

      // ========== TIMES E ESCUDOS ==========
      const teamsY = cardY + cardHeight / 2 + 15;
      const logoSize = 100;
      const teamNameY = teamsY + logoSize / 2 + 30;

      // === TIME DA CASA ===
      const homeLogoX = cardPadding + 60;
      const homeLogoY = teamsY - logoSize / 2;
      
      // Círculo de fundo
      ctx.beginPath();
      ctx.arc(homeLogoX + logoSize / 2, homeLogoY + logoSize / 2, logoSize / 2 + 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fill();
      
      const homeLogo = await this.loadTeamLogo(match.homeTeam, match.homeTeamLogo);
      if (homeLogo) {
        ctx.drawImage(homeLogo, homeLogoX, homeLogoY, logoSize, logoSize);
      } else {
        this.drawTeamPlaceholder(ctx, match.homeTeam, homeLogoX, homeLogoY, logoSize);
      }
      
      ctx.font = 'bold 22px Montserrat, Arial';
      ctx.fillStyle = COLORS.white;
      ctx.textAlign = 'center';
      const homeTeamName = match.homeTeam.length > 12 ? match.homeTeam.substring(0, 10) + '...' : match.homeTeam;
      ctx.fillText(homeTeamName, homeLogoX + logoSize / 2, teamNameY);

      // === VS NO CENTRO ===
      const centerX = WIDTH / 2;
      
      // Círculo decorativo
      ctx.beginPath();
      ctx.arc(centerX, teamsY, 38, 0, Math.PI * 2);
      const vsGrad = ctx.createRadialGradient(centerX, teamsY, 0, centerX, teamsY, 38);
      vsGrad.addColorStop(0, 'rgba(255, 215, 0, 0.25)');
      vsGrad.addColorStop(1, 'rgba(255, 215, 0, 0.05)');
      ctx.fillStyle = vsGrad;
      ctx.fill();
      
      ctx.font = 'bold 32px Montserrat, Arial';
      ctx.fillStyle = COLORS.gold;
      ctx.textBaseline = 'middle';
      ctx.fillText('VS', centerX, teamsY);
      ctx.textBaseline = 'alphabetic';

      // === TIME VISITANTE ===
      const awayLogoX = WIDTH - cardPadding - 60 - logoSize;
      const awayLogoY = teamsY - logoSize / 2;
      
      ctx.beginPath();
      ctx.arc(awayLogoX + logoSize / 2, awayLogoY + logoSize / 2, logoSize / 2 + 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fill();
      
      const awayLogo = await this.loadTeamLogo(match.awayTeam, match.awayTeamLogo);
      if (awayLogo) {
        ctx.drawImage(awayLogo, awayLogoX, awayLogoY, logoSize, logoSize);
      } else {
        this.drawTeamPlaceholder(ctx, match.awayTeam, awayLogoX, awayLogoY, logoSize);
      }
      
      ctx.font = 'bold 22px Montserrat, Arial';
      ctx.fillStyle = COLORS.white;
      const awayTeamName = match.awayTeam.length > 12 ? match.awayTeam.substring(0, 10) + '...' : match.awayTeam;
      ctx.fillText(awayTeamName, awayLogoX + logoSize / 2, teamNameY);

      // ========== CANAIS (parte inferior) ==========
      const channelsToShow = match.channels && match.channels.length > 0 
        ? match.channels 
        : match.channel ? [match.channel] : [];
      
      if (channelsToShow.length > 0) {
        const channelY = cardY + cardHeight - 30;
        const displayChannels = channelsToShow.slice(0, 2);
        const channelText = displayChannels.join(' • ');
        ctx.font = '18px Montserrat, Arial';
        ctx.fillStyle = COLORS.cyan;
        ctx.textAlign = 'center';
        ctx.fillText(channelText, WIDTH / 2, channelY);
      }
    }

    // ========== RODAPÉ ==========
    const footerY = HEIGHT - 50;
    ctx.font = '22px Montserrat, Arial';
    ctx.fillStyle = COLORS.textDark;
    ctx.textAlign = 'center';
    ctx.fillText('Assista aos melhores jogos conosco!', WIDTH / 2, footerY);

    const fileName = `jogos_do_dia_${Date.now()}_parte${bannerNumber}.jpeg`;
    const filePath = path.join(STORAGE_DIR, fileName);
    const buffer = canvas.toBuffer('image/jpeg', { quality: 0.92 });
    fs.writeFileSync(filePath, buffer);
    logger.info(`[FootballBanner] ✅ Banner salvo: ${fileName}`);
    return filePath;
  }
}

export default new FootballBannerService();
