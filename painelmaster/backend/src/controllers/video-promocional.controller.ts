/**
 * 🎬 VÍDEO PROMOCIONAL CONTROLLER
 * 
 * Controller ISOLADO para geração de vídeos promocionais de filmes/séries.
 * NÃO altera funcionalidades existentes.
 */

import { Request, Response } from 'express';
import { promoVideoService } from '../services/video-promocional/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('VideoPromocionalController');

/**
 * Busca filmes/séries no TMDB
 * GET /api/video-promocional/search?q=nome
 */
export const searchContent = async (req: Request, res: Response) => {
  try {
    const query = req.query.q as string;
    
    if (!query || query.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Query deve ter pelo menos 2 caracteres',
      });
    }

    logger.info(`[VideoPromocional] Buscando: ${query}`);
    
    const results = await promoVideoService.searchContent(query);
    
    return res.json({
      success: true,
      data: results,
    });
  } catch (error: any) {
    logger.error(`[VideoPromocional] Erro na busca: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Obtém detalhes de um filme/série incluindo trailer
 * GET /api/video-promocional/details/:type/:id
 */
export const getContentDetails = async (req: Request, res: Response) => {
  try {
    const { type, id } = req.params;
    
    if (!['movie', 'tv'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Tipo deve ser "movie" ou "tv"',
      });
    }

    const tmdbId = parseInt(id);
    if (isNaN(tmdbId)) {
      return res.status(400).json({
        success: false,
        error: 'ID inválido',
      });
    }

    logger.info(`[VideoPromocional] Obtendo detalhes: ${type}/${tmdbId}`);
    
    const details = await promoVideoService.getContentDetails(tmdbId, type as 'movie' | 'tv');
    
    if (!details) {
      return res.status(404).json({
        success: false,
        error: 'Conteúdo não encontrado',
      });
    }

    return res.json({
      success: true,
      data: details,
    });
  } catch (error: any) {
    logger.error(`[VideoPromocional] Erro ao obter detalhes: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Gera vídeo promocional
 * POST /api/video-promocional/generate
 */
export const generateVideo = async (req: Request, res: Response) => {
  try {
    const { tmdbId, type, ctaText } = req.body;
    
    if (!tmdbId || !type) {
      return res.status(400).json({
        success: false,
        error: 'tmdbId e type são obrigatórios',
      });
    }

    if (!['movie', 'tv'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Tipo deve ser "movie" ou "tv"',
      });
    }

    logger.info(`[VideoPromocional] Gerando vídeo para: ${type}/${tmdbId}`);
    
    // 1. Obter detalhes do conteúdo
    const contentData = await promoVideoService.getContentDetails(tmdbId, type);
    
    if (!contentData) {
      return res.status(404).json({
        success: false,
        error: 'Conteúdo não encontrado no TMDB',
      });
    }

    if (!contentData.trailerKey) {
      return res.status(400).json({
        success: false,
        error: 'Este conteúdo não possui trailer disponível',
      });
    }

    // 2. Gerar vídeo
    const result = await promoVideoService.generatePromoVideo(
      contentData,
      ctaText || '👉 Quer assistir? Chama no WhatsApp'
    );

    return res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    logger.error(`[VideoPromocional] Erro ao gerar vídeo: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Obtém o vídeo atual (se existir)
 * GET /api/video-promocional/current
 */
export const getCurrentVideo = async (req: Request, res: Response) => {
  try {
    const currentVideo = promoVideoService.getCurrentVideo();
    
    return res.json({
      success: true,
      data: currentVideo || null,
    });
  } catch (error: any) {
    logger.error(`[VideoPromocional] Erro ao obter vídeo atual: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Limpa arquivos temporários
 * POST /api/video-promocional/cleanup
 */
export const cleanupTempFiles = async (req: Request, res: Response) => {
  try {
    await promoVideoService.cleanupTempFiles();
    
    return res.json({
      success: true,
      message: 'Arquivos temporários limpos',
    });
  } catch (error: any) {
    logger.error(`[VideoPromocional] Erro ao limpar temp: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};
