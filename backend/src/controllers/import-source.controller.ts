import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { createLogger } from '../utils/logger.js';

const prisma = new PrismaClient();
const logger = createLogger('ImportSourceController');

/**
 * 📥 CRUD para fontes de importação M3U
 */

// GET /api/import-sources - Listar todas as fontes
export async function listImportSources(req: Request, res: Response) {
  try {
    const sources = await prisma.importSource.findMany({
      orderBy: [
        { type: 'asc' }, // Primary primeiro
        { createdAt: 'desc' }
      ]
    });

    res.json({ success: true, sources });
  } catch (error: any) {
    logger.error('[listImportSources] Erro:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
}

// GET /api/import-sources/:id - Buscar fonte por ID
export async function getImportSource(req: Request, res: Response) {
  try {
    const { id } = req.params;

    const source = await prisma.importSource.findUnique({
      where: { id }
    });

    if (!source) {
      return res.status(404).json({ success: false, error: 'Fonte não encontrada' });
    }

    res.json({ success: true, source });
  } catch (error: any) {
    logger.error('[getImportSource] Erro:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
}

// POST /api/import-sources - Criar nova fonte
export async function createImportSource(req: Request, res: Response) {
  try {
    const { name, type, url, isActive } = req.body;

    if (!name || !url) {
      return res.status(400).json({ 
        success: false, 
        error: 'Nome e URL são obrigatórios' 
      });
    }

    // Validar tipo
    if (type && !['primary', 'secondary'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Tipo deve ser "primary" ou "secondary"'
      });
    }

    const source = await prisma.importSource.create({
      data: {
        name,
        type: type || 'secondary',
        url,
        isActive: isActive !== undefined ? isActive : true
      }
    });

    logger.info(`[createImportSource] ✅ Nova fonte criada: ${name} (${type || 'secondary'})`);
    res.json({ success: true, source });
  } catch (error: any) {
    logger.error('[createImportSource] Erro:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
}

// PUT /api/import-sources/:id - Atualizar fonte
export async function updateImportSource(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { name, type, url, isActive } = req.body;

    // Validar tipo se fornecido
    if (type && !['primary', 'secondary'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Tipo deve ser "primary" ou "secondary"'
      });
    }

    const source = await prisma.importSource.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(type && { type }),
        ...(url && { url }),
        ...(isActive !== undefined && { isActive })
      }
    });

    logger.info(`[updateImportSource] ✅ Fonte atualizada: ${source.name}`);
    res.json({ success: true, source });
  } catch (error: any) {
    logger.error('[updateImportSource] Erro:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
}

// DELETE /api/import-sources/:id - Deletar fonte
export async function deleteImportSource(req: Request, res: Response) {
  try {
    const { id } = req.params;

    await prisma.importSource.delete({
      where: { id }
    });

    logger.info(`[deleteImportSource] ✅ Fonte deletada: ${id}`);
    res.json({ success: true, message: 'Fonte deletada com sucesso' });
  } catch (error: any) {
    logger.error('[deleteImportSource] Erro:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
}

// POST /api/import-sources/:id/import - Executar importação de uma fonte
export async function importFromSource(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { serverId: xuiServerId, clearBeforeImport, enrichWithTMDB, categoryId, createYearCategory, selectedYears, userId, vodType, maxMovies, maxSeries, disableMarketing, batchSize } = req.body;

    const source = await prisma.importSource.findUnique({
      where: { id }
    });

    if (!source) {
      return res.status(404).json({ success: false, error: 'Fonte não encontrada' });
    }

    if (!source.isActive) {
      return res.status(400).json({ success: false, error: 'Fonte está inativa' });
    }

    // Resolver servidor XUI (painel) para executar a importação
    const server = await prisma.xuiServer.findFirst({
      where: {
        isActive: true,
        ...(xuiServerId ? { id: xuiServerId } : {}),
      },
      orderBy: [
        { isDefault: 'desc' },
        { createdAt: 'asc' },
      ],
    });

    if (!server) {
      return res.status(400).json({ success: false, error: 'Nenhum servidor XUI ativo encontrado para importar' });
    }

    // Importar usando o M3U Importer Service
    const { M3UImporterService } = await import('../services/vod/m3u-importer.service.js');
    const importer = new M3UImporterService(server);

    logger.info(`[importFromSource] 🚀 Iniciando importação da fonte: ${source.name}`);

    const result = await importer.importFromUrl(source.url, {
      clearBeforeImport: clearBeforeImport || false,
      enrichWithTMDB: enrichWithTMDB || false,
      categoryId: categoryId || undefined,
      createYearCategory: createYearCategory || false,
      selectedYears: selectedYears || [],
      userId: userId || undefined,
      vodType: vodType || 'both',
      maxMovies: maxMovies ? parseInt(String(maxMovies), 10) : undefined,
      maxSeries: maxSeries ? parseInt(String(maxSeries), 10) : undefined,
      disableMarketing: disableMarketing === true,
      batchSize: batchSize ? parseInt(String(batchSize), 10) : undefined,
    });

    // Atualizar estatísticas da fonte
    await prisma.importSource.update({
      where: { id },
      data: {
        lastImportAt: new Date(),
        totalItemsImported: { increment: result.inserted || 0 }
      }
    });

    logger.info(`[importFromSource] ✅ Importação concluída: ${result.inserted} itens inseridos`);
    res.json({ success: true, result });
  } catch (error: any) {
    logger.error('[importFromSource] Erro:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
}

// POST /api/import-sources/cascade/import - Executar importação em cascata (primárias → secundárias)
export async function importCascade(req: Request, res: Response) {
  try {
    const { serverId: xuiServerId, clearBeforeImport, enrichWithTMDB, categoryId, createYearCategory, selectedYears, userId, vodType, maxMovies, maxSeries, disableMarketing, batchSize } = req.body;

    logger.info('[importCascade] 🌊 Iniciando importação em cascata...');

    // Buscar fontes ativas
    const sources = await prisma.importSource.findMany({
      where: { isActive: true },
      orderBy: [
        { type: 'asc' }, // Primary primeiro
        { createdAt: 'asc' }
      ]
    });

    if (sources.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Nenhuma fonte ativa encontrada' 
      });
    }

    const primarySources = sources.filter(s => s.type === 'primary');
    const secondarySources = sources.filter(s => s.type === 'secondary');

    logger.info(`[importCascade] 🎯 ${primarySources.length} fonte(s) primária(s), 📦 ${secondarySources.length} secundária(s)`);

    const server = await prisma.xuiServer.findFirst({
      where: {
        isActive: true,
        ...(xuiServerId ? { id: xuiServerId } : {}),
      },
      orderBy: [
        { isDefault: 'desc' },
        { createdAt: 'asc' },
      ],
    });

    if (!server) {
      return res.status(400).json({ success: false, error: 'Nenhum servidor XUI ativo encontrado para importar' });
    }

    const { M3UImporterService } = await import('../services/vod/m3u-importer.service.js');
    const importer = new M3UImporterService(server);

    const results: any[] = [];
    let totalAdded = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    // ETAPA 1: Importar fontes primárias
    for (const source of primarySources) {
      logger.info(`[importCascade] 🎯 Importando fonte primária: ${source.name}`);
      
      try {
        const result = await importer.importFromUrl(source.url, {
          clearBeforeImport: clearBeforeImport && primarySources.indexOf(source) === 0, // Só limpar na primeira
          enrichWithTMDB: true,
          categoryId: categoryId || undefined,
          createYearCategory: createYearCategory || false,
          selectedYears: selectedYears || [],
          userId: userId || undefined,
          vodType: vodType || 'both',
          maxMovies: maxMovies ? parseInt(String(maxMovies), 10) : undefined,
          maxSeries: maxSeries ? parseInt(String(maxSeries), 10) : undefined,
          disableMarketing: disableMarketing === true,
          batchSize: batchSize ? parseInt(String(batchSize), 10) : undefined,
        });

        totalAdded += result.inserted || 0;
        totalSkipped += result.skipped || 0;
        totalErrors += result.errors || 0;

        results.push({
          sourceName: source.name,
          type: 'primary',
          ...result
        });

        // Atualizar estatísticas
        await prisma.importSource.update({
          where: { id: source.id },
          data: {
            lastImportAt: new Date(),
            totalItemsImported: { increment: result.inserted || 0 }
          }
        });

        logger.info(`[importCascade] ✅ ${source.name}: ${result.inserted} inseridos, ${result.skipped} ignorados`);
      } catch (error: any) {
        logger.error(`[importCascade] ❌ Erro na fonte ${source.name}:`, error.message);
        results.push({
          sourceName: source.name,
          type: 'primary',
          error: error.message
        });
      }
    }

    // ETAPA 2: Importar fontes secundárias (COMPLEMENTO - sem duplicatas)
    for (const source of secondarySources) {
      logger.info(`[importCascade] 📦 Importando fonte secundária: ${source.name}`);
      
      try {
        const result = await importer.importFromUrl(source.url, {
          clearBeforeImport: false, // NUNCA limpar em secundárias
          enrichWithTMDB: enrichWithTMDB || false,
          categoryId: categoryId || undefined,
          createYearCategory: createYearCategory || false,
          selectedYears: selectedYears || [],
          userId: userId || undefined,
          vodType: vodType || 'both',
          maxMovies: maxMovies ? parseInt(String(maxMovies), 10) : undefined,
          maxSeries: maxSeries ? parseInt(String(maxSeries), 10) : undefined,
          disableMarketing: disableMarketing === true,
          batchSize: batchSize ? parseInt(String(batchSize), 10) : undefined,
        });

        totalAdded += result.inserted || 0;
        totalSkipped += result.skipped || 0;
        totalErrors += result.errors || 0;

        results.push({
          sourceName: source.name,
          type: 'secondary',
          ...result
        });

        // Atualizar estatísticas
        await prisma.importSource.update({
          where: { id: source.id },
          data: {
            lastImportAt: new Date(),
            totalItemsImported: { increment: result.inserted || 0 }
          }
        });

        logger.info(`[importCascade] ✅ ${source.name}: ${result.inserted} inseridos, ${result.skipped} ignorados`);
      } catch (error: any) {
        logger.error(`[importCascade] ❌ Erro na fonte ${source.name}:`, error.message);
        results.push({
          sourceName: source.name,
          type: 'secondary',
          error: error.message
        });
      }
    }

    logger.info(`[importCascade] 🎉 COMPLETO: ${totalAdded} inseridos, ${totalSkipped} duplicatas ignoradas, ${totalErrors} erros`);

    res.json({ 
      success: true, 
      summary: {
        totalAdded,
        totalSkipped,
        totalErrors,
        primarySourcesCount: primarySources.length,
        secondarySourcesCount: secondarySources.length
      },
      results 
    });
  } catch (error: any) {
    logger.error('[importCascade] Erro:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
}
