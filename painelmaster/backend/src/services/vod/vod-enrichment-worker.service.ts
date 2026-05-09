import * as os from 'os';
import { createLogger } from '../../utils/logger.js';
import { prisma } from '../../config/database.js';
import { socketService } from '../socket.service.js';
import { TMDBService } from './tmdb.service.js';
import { XUIVodDBClient } from './xui-vod-db.client.js';

const logger = createLogger('VODEnrichmentWorker');

type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

type JobItemStatus = 'pending' | 'processing' | 'success' | 'failed' | 'review';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanTitleForTmdb(title: string): string {
  return (title || '')
    .replace(/\s*\[.*?\]\s*/g, '')
    .replace(/\s*\([^)]*\)\s*/g, '')
    .replace(/\b\d{4}\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export class VODEnrichmentWorkerService {
  private isStarted = false;
  private isTickRunning = false;
  private interval: NodeJS.Timeout | null = null;

  private readonly tickIntervalMs: number;
  private readonly batchSize: number;
  private readonly concurrency: number;
  private readonly minFreeMemMb: number;
  private readonly maxLoadFactor: number;

  constructor() {
    this.tickIntervalMs = parseInt(process.env.VOD_ENRICH_TICK_MS || '5000', 10);
    this.batchSize = parseInt(process.env.VOD_ENRICH_BATCH_SIZE || '25', 10);
    this.concurrency = Math.max(1, parseInt(process.env.VOD_ENRICH_CONCURRENCY || '2', 10));

    this.minFreeMemMb = parseInt(process.env.VOD_ENRICH_MIN_FREE_MEM_MB || '300', 10);
    this.maxLoadFactor = parseFloat(process.env.VOD_ENRICH_MAX_LOAD_FACTOR || '0.9');
  }

  start(): void {
    if (this.isStarted) return;
    this.isStarted = true;

    logger.info('[VODEnrichmentWorker] Iniciando worker de enriquecimento TMDB', {
      tickIntervalMs: this.tickIntervalMs,
      batchSize: this.batchSize,
      concurrency: this.concurrency,
      minFreeMemMb: this.minFreeMemMb,
      maxLoadFactor: this.maxLoadFactor,
    });

    this.interval = setInterval(() => {
      this.tick().catch(err => {
        logger.error('[VODEnrichmentWorker] Erro no tick:', err?.message || String(err));
      });
    }, this.tickIntervalMs);

    // Rodar um tick inicial rápido
    this.tick().catch(() => {});
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isStarted = false;
  }

  private shouldThrottle(): { throttle: boolean; reason?: string } {
    const cpus = os.cpus()?.length || 1;
    const load1 = os.loadavg()[0] || 0;
    const maxLoad = cpus * this.maxLoadFactor;

    const freeMemMb = os.freemem() / (1024 * 1024);

    if (freeMemMb < this.minFreeMemMb) {
      return { throttle: true, reason: `Memória livre baixa (${Math.round(freeMemMb)}MB < ${this.minFreeMemMb}MB)` };
    }

    if (load1 > maxLoad) {
      return { throttle: true, reason: `Load alto (${load1.toFixed(2)} > ${maxLoad.toFixed(2)})` };
    }

    return { throttle: false };
  }

  private async tick(): Promise<void> {
    if (!this.isStarted) return;
    if (this.isTickRunning) return;

    const throttle = this.shouldThrottle();
    if (throttle.throttle) {
      logger.warn(`[VODEnrichmentWorker] Throttle ativo: ${throttle.reason}`);
      return;
    }

    this.isTickRunning = true;
    try {
      const job = await prisma.vODEnrichmentJob.findFirst({
        where: {
          status: { in: ['pending', 'running'] as JobStatus[] },
        },
        orderBy: { createdAt: 'asc' },
      });

      if (!job) return;

      if (job.status === 'pending') {
        await prisma.vODEnrichmentJob.update({
          where: { id: job.id },
          data: { status: 'running', startedAt: new Date() },
        });
      }

      const server = await prisma.xuiServer.findUnique({ where: { id: job.serverId } });
      if (!server) {
        await prisma.vODEnrichmentJob.update({
          where: { id: job.id },
          data: { status: 'failed', error: `Servidor não encontrado: ${job.serverId}`, completedAt: new Date() },
        });
        return;
      }

      const tmdbService = new TMDBService();
      const xuiDb = new XUIVodDBClient(server);

      const items = await prisma.vODEnrichmentJobItem.findMany({
        where: {
          jobId: job.id,
          status: { in: ['pending'] as JobItemStatus[] },
        },
        take: this.batchSize,
        orderBy: { id: 'asc' },
      });

      if (items.length === 0) {
        const remaining = await prisma.vODEnrichmentJobItem.count({
          where: { jobId: job.id, status: { in: ['pending', 'processing'] as JobItemStatus[] } },
        });

        if (remaining === 0) {
          await prisma.vODEnrichmentJob.update({
            where: { id: job.id },
            data: { status: 'completed', progress: 100, completedAt: new Date() },
          });
        }
        return;
      }

      const userProcessState = socketService.getUserProcess(job.userId);
      const shouldEmitSocket = !userProcessState || !userProcessState.isRunning || userProcessState.isCompleted;

      if (shouldEmitSocket) {
        socketService.updateUserProcess(job.userId, {
          status: 'processing',
          startTime: Date.now(),
          totalItems: job.totalItems,
          processedItems: job.processedItems,
          addedItems: job.successItems,
          skippedItems: job.failedItems + job.reviewNeeded,
          progress: Math.round(job.progress || 0),
          currentItem: `Enriquecendo TMDB (${job.processedItems}/${job.totalItems})`,
        });
      }

      // Marcar itens como processing
      await prisma.vODEnrichmentJobItem.updateMany({
        where: { id: { in: items.map(i => i.id) } },
        data: { status: 'processing' },
      });

      const queue = [...items];
      const results = {
        processed: 0,
        success: 0,
        failed: 0,
        review: 0,
      };

      const runOne = async (): Promise<void> => {
        while (queue.length > 0) {
          const throttleNow = this.shouldThrottle();
          if (throttleNow.throttle) {
            logger.warn(`[VODEnrichmentWorker] Throttle durante lote: ${throttleNow.reason}`);
            await sleep(2000);
            continue;
          }

          const item = queue.shift();
          if (!item) return;

          try {
            const vodItem = await prisma.vODItem.findUnique({
              where: { id: item.vodItemId },
              select: {
                id: true,
                xuiStreamId: true,
                vodType: true,
                title: true,
                year: true,
                streamName: true,
                streamUrl: true,
              },
            });

            if (!vodItem) {
              await prisma.vODEnrichmentJobItem.update({
                where: { id: item.id },
                data: { status: 'failed', error: 'VODItem não encontrado', processedAt: new Date() },
              });
              results.failed++;
              results.processed++;
              continue;
            }

            if (vodItem.vodType !== 'movie' && vodItem.vodType !== 'series') {
              await prisma.vODEnrichmentJobItem.update({
                where: { id: item.id },
                data: { status: 'review', error: `Tipo não suportado: ${vodItem.vodType}`, processedAt: new Date() },
              });
              await prisma.vODItem.update({
                where: { id: vodItem.id },
                data: { needsReview: true },
              });
              results.review++;
              results.processed++;
              continue;
            }

            if (vodItem.vodType === 'movie') {
              const cleanTitle = cleanTitleForTmdb(vodItem.title || vodItem.streamName);
              const tmdbResult = await tmdbService.searchMovie(cleanTitle, vodItem.year || undefined);

              if (!tmdbResult) {
                await prisma.vODEnrichmentJobItem.update({
                  where: { id: item.id },
                  data: { status: 'review', error: 'TMDB não encontrou match', processedAt: new Date() },
                });
                await prisma.vODItem.update({
                  where: { id: vodItem.id },
                  data: { needsReview: true },
                });
                results.review++;
                results.processed++;
                continue;
              }

              const details = await tmdbService.getMovieDetails(tmdbResult.id);
              if (!details) {
                await prisma.vODEnrichmentJobItem.update({
                  where: { id: item.id },
                  data: { status: 'failed', tmdbId: tmdbResult.id, error: 'TMDB sem detalhes', processedAt: new Date() },
                });
                results.failed++;
                results.processed++;
                continue;
              }

              const xuiProps = tmdbService.convertMovieToXUIProperties(details, cleanTitle);
              const posterUrl = xuiProps.movie_image || xuiProps.cover_big || null;
              const rating = details.vote_average && details.vote_average > 0 ? details.vote_average : null;

              await xuiDb.updateMovieMetadata(
                vodItem.xuiStreamId,
                xuiProps,
                posterUrl,
                details.id,
                rating
              );

              const genres = details.genres?.map(g => g.name) || [];
              const metadata = await prisma.vODMetadata.upsert({
                where: { tmdbId: details.id },
                update: {
                  tmdbType: 'movie',
                  title: details.title || cleanTitle,
                  originalTitle: (details as any).original_title || details.title || null,
                  overview: details.overview || null,
                  releaseDate: details.release_date || null,
                  genres: genres.length > 0 ? JSON.stringify(genres) : null,
                  posterUrl: details.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : null,
                  backdropUrl: details.backdrop_path ? `https://image.tmdb.org/t/p/w1280${details.backdrop_path}` : null,
                  runtime: details.runtime || null,
                  rating: rating,
                  lastSynced: new Date(),
                },
                create: {
                  tmdbId: details.id,
                  tmdbType: 'movie',
                  title: details.title || cleanTitle,
                  originalTitle: (details as any).original_title || details.title || null,
                  overview: details.overview || null,
                  releaseDate: details.release_date || null,
                  genres: genres.length > 0 ? JSON.stringify(genres) : null,
                  posterUrl: details.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : null,
                  backdropUrl: details.backdrop_path ? `https://image.tmdb.org/t/p/w1280${details.backdrop_path}` : null,
                  runtime: details.runtime || null,
                  rating: rating,
                  lastSynced: new Date(),
                },
              });

              await prisma.vODItem.update({
                where: { id: vodItem.id },
                data: {
                  metadataId: metadata.id,
                  hasMetadata: true,
                  isEnriched: true,
                  metadataSource: 'tmdb',
                  posterUrl: metadata.posterUrl || posterUrl || undefined,
                  overview: metadata.overview || undefined,
                  title: metadata.title || vodItem.title,
                  year: metadata.releaseDate ? parseInt(metadata.releaseDate.substring(0, 4), 10) : vodItem.year,
                  lastEnrichedAt: new Date(),
                  needsReview: false,
                },
              });

              await prisma.vODEnrichmentJobItem.update({
                where: { id: item.id },
                data: {
                  status: 'success',
                  tmdbId: details.id,
                  matchScore: null,
                  processedAt: new Date(),
                  error: null,
                },
              });

              results.success++;
              results.processed++;
              continue;
            }

            // Séries: neste MVP, marcar para review (evita mexer em streams_series/episódios sem regras bem definidas)
            await prisma.vODEnrichmentJobItem.update({
              where: { id: item.id },
              data: { status: 'review', error: 'Enriquecimento de séries ainda não habilitado no worker', processedAt: new Date() },
            });
            await prisma.vODItem.update({
              where: { id: vodItem.id },
              data: { needsReview: true },
            });
            results.review++;
            results.processed++;
          } catch (err: any) {
            await prisma.vODEnrichmentJobItem.update({
              where: { id: item.id },
              data: {
                status: 'failed',
                error: err?.message || String(err),
                processedAt: new Date(),
              },
            });
            results.failed++;
            results.processed++;
          }
        }
      };

      await Promise.all(Array.from({ length: this.concurrency }, () => runOne()));

      const newProcessed = job.processedItems + results.processed;
      const newSuccess = job.successItems + results.success;
      const newFailed = job.failedItems + results.failed;
      const newReview = job.reviewNeeded + results.review;
      const progress = job.totalItems > 0 ? Math.min(100, (newProcessed / job.totalItems) * 100) : 0;

      await prisma.vODEnrichmentJob.update({
        where: { id: job.id },
        data: {
          processedItems: newProcessed,
          successItems: newSuccess,
          failedItems: newFailed,
          reviewNeeded: newReview,
          progress: progress,
        },
      });

      if (shouldEmitSocket) {
        socketService.updateUserProcess(job.userId, {
          status: 'processing',
          processedItems: newProcessed,
          totalItems: job.totalItems,
          addedItems: newSuccess,
          skippedItems: newFailed + newReview,
          progress: Math.round(progress),
          currentItem: `Enriquecendo TMDB (${newProcessed}/${job.totalItems})`,
        });
      }

      const remainingAfter = await prisma.vODEnrichmentJobItem.count({
        where: { jobId: job.id, status: { in: ['pending', 'processing'] as JobItemStatus[] } },
      });

      if (remainingAfter === 0) {
        await prisma.vODEnrichmentJob.update({
          where: { id: job.id },
          data: { status: 'completed', progress: 100, completedAt: new Date() },
        });

        if (shouldEmitSocket) {
          socketService.updateUserProcess(job.userId, {
            status: 'completed',
            progress: 100,
            processedItems: job.totalItems,
            totalItems: job.totalItems,
            addedItems: newSuccess,
            skippedItems: newFailed + newReview,
            currentItem: `Enriquecimento TMDB concluído (${newSuccess} ok, ${newFailed} erros, ${newReview} revisão)`,
          });
        }
      }
    } finally {
      this.isTickRunning = false;
    }
  }
}

export const vodEnrichmentWorkerService = new VODEnrichmentWorkerService();
