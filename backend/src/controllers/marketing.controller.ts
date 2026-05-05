import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { createLogger } from '../utils/logger.js';
import BannerGeneratorService from '../services/marketing/banner-generator.service.js';
import VideoGeneratorService from '../services/marketing/video-generator.service.js';
import PostImportHookService from '../services/marketing/post-import-hook.service.js';
import { XUIVodApiClient } from '../services/vod/xui-vod-api.client.js';
import path from 'path';
import fs from 'fs';
import multer from 'multer';

const logger = createLogger('MarketingController');

// Configurar multer para upload de logo
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(process.cwd(), 'storage', 'logos');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `logo_${Date.now()}${path.extname(file.originalname)}`);
  },
});

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Apenas imagens são permitidas'));
    }
  },
});

/**
 * GET /api/marketing/config
 * Buscar configuração de marketing
 */
export const getMarketingConfig = asyncHandler(async (req: Request, res: Response) => {
  const config = await prisma.marketingConfig.findFirst();
  
  if (!config) {
    // Criar configuração padrão se não existir
    const defaultConfig = await prisma.marketingConfig.create({
      data: {
        painelName: 'PAINEL MASTER',
        primaryColor: '#00E5FF',
        secondaryColor: '#1E88E5',
        maxBannersPerImport: 30,
      },
    });
    return res.json(defaultConfig);
  }

  res.json(config);
});

/**
 * POST /api/marketing/config
 * Salvar configuração de marketing
 */
export const saveMarketingConfig = asyncHandler(async (req: Request, res: Response) => {
  const {
    painelName,
    painelLogo,
    telegramBotToken,
    telegramChatId,
    whatsappNumber,
    primaryColor,
    secondaryColor,
    sloganText,
    maxBannersPerImport,
    videoMusicFilmes,
    videoMusicSeries,
    videoMusicFutebol,
  } = req.body;

  const config = await prisma.marketingConfig.upsert({
    where: { id: 1 },
    update: {
      painelName: painelName || 'PAINEL MASTER',
      painelLogo: painelLogo || undefined,
      telegramBotToken: telegramBotToken || undefined,
      telegramChatId: telegramChatId || undefined,
      whatsappNumber: whatsappNumber || undefined,
      primaryColor: primaryColor || '#00E5FF',
      secondaryColor: secondaryColor || '#1E88E5',
      sloganText: sloganText || undefined,
      maxBannersPerImport: maxBannersPerImport || 30,
      videoMusicFilmes: videoMusicFilmes || undefined,
      videoMusicSeries: videoMusicSeries || undefined,
      videoMusicFutebol: videoMusicFutebol || undefined,
    },
    create: {
      painelName: painelName || 'PAINEL MASTER',
      painelLogo: painelLogo || undefined,
      telegramBotToken: telegramBotToken || undefined,
      telegramChatId: telegramChatId || undefined,
      whatsappNumber: whatsappNumber || undefined,
      primaryColor: primaryColor || '#00E5FF',
      secondaryColor: secondaryColor || '#1E88E5',
      sloganText: sloganText || undefined,
      maxBannersPerImport: maxBannersPerImport || 30,
      videoMusicFilmes: videoMusicFilmes || undefined,
      videoMusicSeries: videoMusicSeries || undefined,
      videoMusicFutebol: videoMusicFutebol || undefined,
    },
  });

  res.json(config);
});

/**
 * POST /api/marketing/upload-logo
 * Upload de logo do painel
 */
export const uploadLogo = [
  upload.single('logo'),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      throw new AppError(400, 'Nenhum arquivo enviado');
    }

    const logoUrl = `/storage/logos/${req.file.filename}`;
    
    // Atualizar configuração com o logo
    await prisma.marketingConfig.upsert({
      where: { id: 1 },
      update: { painelLogo: logoUrl },
      create: {
        painelName: 'PAINEL MASTER',
        painelLogo: logoUrl,
        primaryColor: '#00E5FF',
        secondaryColor: '#1E88E5',
        maxBannersPerImport: 30,
      },
    });

    res.json({ url: logoUrl });
  }),
];

// Configurar multer para upload de música (limite maior: 100MB)
const musicStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(process.cwd(), 'storage', 'music');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const type = req.body.type || 'music';
    cb(null, `${type}_${Date.now()}${path.extname(file.originalname)}`);
  },
});

const uploadMusic = multer({ 
  storage: musicStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Apenas arquivos de áudio são permitidos'));
    }
  },
});

/**
 * POST /api/marketing/upload-music
 * Upload de música para vídeos
 */
export const uploadMusicHandler = [
  uploadMusic.single('music'),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      throw new AppError(400, 'Nenhum arquivo enviado');
    }

    const musicPath = `/storage/music/${req.file.filename}`;
    const type = req.body.type || 'music';
    
    // Atualizar configuração com o caminho da música
    const updateData: any = {};
    if (type === 'filmes') {
      updateData.videoMusicFilmes = musicPath;
    } else if (type === 'series') {
      updateData.videoMusicSeries = musicPath;
    } else if (type === 'futebol') {
      updateData.videoMusicFutebol = musicPath;
    }

    await prisma.marketingConfig.upsert({
      where: { id: 1 },
      update: updateData,
      create: {
        painelName: 'PAINEL MASTER',
        primaryColor: '#00E5FF',
        secondaryColor: '#1E88E5',
        maxBannersPerImport: 30,
        ...updateData,
      },
    });

    res.json({ path: musicPath });
  }),
];

/**
 * GET /api/marketing/banners
 * Listar banners gerados
 */
export const getBanners = asyncHandler(async (req: Request, res: Response) => {
  const { type, orientation, importId } = req.query;

  const where: any = {};
  if (type) where.type = type;
  if (orientation) where.orientation = orientation;
  if (importId) where.importId = importId;

  const banners = await prisma.generatedBanner.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  res.json(banners);
});

/**
 * GET /api/marketing/videos
 * Listar vídeos gerados
 */
export const getVideos = asyncHandler(async (req: Request, res: Response) => {
  const videos = await prisma.generatedVideo.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  res.json(videos);
});

/**
 * POST /api/marketing/generate-banner
 * Gerar banner manualmente
 */
export const generateBanner = asyncHandler(async (req: Request, res: Response) => {
  const { data, orientation } = req.body;

  if (!data || !orientation) {
    throw new AppError(400, 'Dados do banner e orientação são obrigatórios');
  }

  let bannerPath: string;
  
  if (orientation === 'vertical') {
    bannerPath = await BannerGeneratorService.generateVerticalBanner(data);
  } else {
    bannerPath = await BannerGeneratorService.generateHorizontalBanner(data);
  }

  res.json({ filePath: bannerPath });
});

/**
 * GET /api/marketing/banner/:id
 * Servir banner
 */
export const serveBanner = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const banner = await prisma.generatedBanner.findUnique({
    where: { id: parseInt(id) },
  });

  if (!banner) {
    throw new AppError(404, 'Banner não encontrado');
  }

  if (!fs.existsSync(banner.filePath)) {
    throw new AppError(404, 'Arquivo do banner não encontrado');
  }

  res.sendFile(path.resolve(banner.filePath));
});

/**
 * GET /api/marketing/video/:id
 * Servir vídeo
 */
export const serveVideo = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const video = await prisma.generatedVideo.findUnique({
    where: { id: parseInt(id) },
  });

  if (!video) {
    throw new AppError(404, 'Vídeo não encontrado');
  }

  if (!fs.existsSync(video.filePath)) {
    throw new AppError(404, 'Arquivo do vídeo não encontrado');
  }

  res.sendFile(path.resolve(video.filePath));
});

/**
 * GET /api/marketing/conteudos-atualizados
 * Buscar informações sobre a categoria "Conteúdos Atualizados" e seus canais
 */
export const getConteudosAtualizados = asyncHandler(async (req: Request, res: Response) => {
  const ConteudosAtualizadosService = (await import('../services/marketing/conteudos-atualizados.service.js')).default;
  const { XUIVodDBClient } = await import('../services/vod/xui-vod-db.client.js');
  
  // Buscar servidor XUI ativo
  const server = await prisma.xuiServer.findFirst({ where: { isActive: true } });
  
  if (!server) {
    return res.json({
      success: false,
      error: 'Nenhum servidor XUI encontrado',
      category: null,
      channels: [],
    });
  }

  const xuiClient = new XUIVodDBClient(server);
  
  try {
    // Buscar categoria
    const category = await xuiClient.findCategoryByName('Conteúdos Atualizados', 'live');
    
    if (!category) {
      return res.json({
        success: false,
        error: 'Categoria "Conteúdos Atualizados" não encontrada',
        category: null,
        channels: [],
      });
    }

    // Buscar canais da categoria
    // ⚠️ CORREÇÃO: category_id é um campo JSON no XUI, usar JSON_CONTAINS
    const conn = await xuiClient.connect();
    const categoryIdJson = JSON.stringify([category.id]);
    
    const [channels] = await conn.query<any[]>(
      `SELECT id, stream_display_name, stream_source, stream_icon, added 
       FROM streams 
       WHERE type = 1 
       AND JSON_CONTAINS(category_id, ?)
       ORDER BY stream_display_name`,
      [categoryIdJson]
    );

    await xuiClient.disconnect();

    // Buscar o vídeo mais recente de CADA tipo (evita caso em que os 2 últimos sejam do mesmo tipo)
    const moviesVideo = await prisma.generatedVideo.findFirst({
      where: { type: 'movies' },
      orderBy: { createdAt: 'desc' },
    });
    const seriesVideo = await prisma.generatedVideo.findFirst({
      where: { type: 'series' },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      category: {
        id: category.id,
        name: category.category_name,
        type: 'live',
      },
      channels: (channels || []).map(ch => ({
        id: ch.id,
        name: ch.stream_display_name,
        streamSource: ch.stream_source ? JSON.parse(ch.stream_source) : [],
        icon: ch.stream_icon,
        added: ch.added,
      })),
      latestVideos: {
        movies: moviesVideo ? {
          id: moviesVideo.id,
          filePath: moviesVideo.filePath,
          createdAt: moviesVideo.createdAt,
        } : null,
        series: seriesVideo ? {
          id: seriesVideo.id,
          filePath: seriesVideo.filePath,
          createdAt: seriesVideo.createdAt,
        } : null,
      },
    });
  } catch (error: any) {
    logger.error('[Marketing] Erro ao buscar Conteúdos Atualizados:', error.message);
    res.json({
      success: false,
      error: error.message,
      category: null,
      channels: [],
    });
  }
});

/**
 * POST /api/marketing/manual-trigger
 * Executa manualmente o processo de marketing (banners + vídeos + canais)
 */
export const manualTriggerMarketing = asyncHandler(async (req: Request, res: Response) => {
  const { xuiServerId, streamServerId, bouquetId } = req.body;

  if (!xuiServerId) {
    throw new AppError(400, 'xuiServerId é obrigatório');
  }

  logger.info('[MarketingManual] Iniciando processo manual de marketing...');
  logger.info(`[MarketingManual] XUI Server ID: ${xuiServerId}, Stream Server ID: ${streamServerId || 'NÃO FORNECIDO'}, Bouquet ID: ${bouquetId || 1}`);

  // Buscar servidor XUI
  const server = await prisma.xuiServer.findUnique({ where: { id: xuiServerId } });
  if (!server) {
    throw new AppError(404, 'Servidor XUI não encontrado');
  }

  const apiClient = new XUIVodApiClient(server);
  const importId = `manual_${Date.now()}`;

  // Buscar últimos VODItems (30 mais recentes)
  const vodMovies = await prisma.vODItem.findMany({
    where: { serverId: xuiServerId, vodType: 'movie' },
    include: { metadata: true },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });

  const vodSeries = await prisma.vODItem.findMany({
    where: { serverId: xuiServerId, vodType: 'series' },
    include: { metadata: true },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });

  logger.info(`[MarketingManual] Encontrados ${vodMovies.length} filmes e ${vodSeries.length} séries`);

  // Construir array de conteúdo importado
  const importedContent: any[] = [];

  for (const item of vodMovies) {
    importedContent.push({
      id: item.xuiStreamId,
      title: item.title || item.streamName || 'Sem título',
      type: 'movie' as const,
      posterUrl: item.posterUrl || '',
      backdropUrl: '',
      synopsis: item.overview || '',
      year: item.year ? item.year.toString() : '',
      rating: item.metadata?.rating || 7.0,
      genres: [],
      tmdbId: item.metadata?.tmdbId || undefined,
    });
  }

  for (const item of vodSeries) {
    importedContent.push({
      id: item.xuiStreamId,
      title: item.title || item.streamName || 'Sem título',
      type: 'series' as const,
      posterUrl: item.posterUrl || '',
      backdropUrl: '',
      synopsis: item.overview || '',
      year: item.year ? item.year.toString() : '',
      rating: item.metadata?.rating || 7.0,
      genres: [],
      tmdbId: item.metadata?.tmdbId || undefined,
    });
  }

  logger.info(`[MarketingManual] Total de itens coletados: ${importedContent.length}`);

  if (importedContent.length === 0) {
    throw new AppError(400, 'Nenhum conteúdo encontrado para gerar marketing. Importe filmes/séries primeiro.');
  }

  // Executar PostImportHook
  const result = await PostImportHookService.processImportedContent(
    importedContent,
    importId,
    xuiServerId,
    streamServerId,
    bouquetId || 1
  );

  logger.info(`[MarketingManual] Resultado: ${JSON.stringify(result)}`);

  res.json({
    success: true,
    data: {
      bannersGenerated: result.bannersGenerated,
      videoPaths: result.videoPaths,
      moviesProcessed: vodMovies.length,
      seriesProcessed: vodSeries.length,
    },
    message: 'Marketing executado com sucesso!'
  });
});
