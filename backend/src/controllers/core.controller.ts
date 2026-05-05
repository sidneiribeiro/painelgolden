import { Request, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import cron from 'node-cron';
import zlib from 'node:zlib';
import axios from 'axios';
import ssh2Pkg from 'ssh2';
import https from 'node:https';
import { prisma } from '../config/database.js';
import env from '../config/env.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { getAsaasService } from '../services/asaas.service.js';
import { whatsappService } from '../services/whatsapp.service.js';
import { M3UParser } from '../services/import/m3u-parser.js';
import { decrypt, encrypt } from '../utils/crypto.js';
import { createLogger } from '../utils/logger.js';
import { processTemplate } from '../utils/templates.js';
import { handleCorePaymentReceived } from '../webhooks/asaas.webhook.js';

const logger = createLogger('CoreM3U');
const { Client: SSHClient } = ssh2Pkg as any;

type CoreEdgeJobStatus = 'processing' | 'completed' | 'failed' | 'canceled';
type CoreEdgeJob = {
  status: CoreEdgeJobStatus;
  serverId: string;
  action: 'ssh_test' | 'install_nginx_health' | 'install_full_edge';
  startedAt: Date;
  finishedAt?: Date;
  logs: string[];
  error?: string;
};

const coreEdgeJobs = new Map<string, CoreEdgeJob>();
const coreEdgeJobConnections = new Map<string, any>();

function addCoreEdgeJobLog(jobId: string, message: string) {
  const job = coreEdgeJobs.get(jobId);
  if (!job) return;
  const ts = new Date().toLocaleTimeString('pt-BR');
  job.logs.push(`[${ts}] ${message}`);
}

function signCoreCheckoutToken(paymentId: string) {
  const sig = crypto.createHmac('sha256', env.JWT_SECRET).update(paymentId).digest('base64url');
  return `${paymentId}.${sig}`;
}

function normalizeBrPhone(raw: string): string {
  const digits = (raw || '').trim().replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function stripApiSuffix(url: string): string {
  return (url || '').replace(/\/api\/?$/, '').replace(/\/$/, '');
}

function coreOwnerWhere(user: { userId: string; role: string }) {
  if (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') return {};
  return { ownerId: user.userId };
}

const toInt = (val: any, defaultVal: number): number => {
  if (typeof val === 'number') return Math.trunc(val);
  if (typeof val === 'string' && val.trim() !== '') {
    const parsed = parseInt(val, 10);
    return Number.isFinite(parsed) ? parsed : defaultVal;
  }
  return defaultVal;
};

const streamSchema = z.object({
  name: z.string().min(1),
  streamUrl: z.string().min(1),
  logoUrl: z.string().optional().nullable(),
  epgChannelId: z.string().optional().nullable(),
  tvArchive: z.union([z.boolean(), z.string()]).transform(v => v === true || v === 'true').optional(),
  tvArchiveDuration: z.union([z.number(), z.string()]).transform(v => toInt(v, 0)).optional(),
  isActive: z.union([z.boolean(), z.string()]).transform(v => v === true || v === 'true' || v === undefined).optional(),
  bouquetIds: z.array(z.string().uuid()).optional(),
  serverIds: z.array(z.string().uuid()).optional(),
});

const edgeServerSchema = z.object({
  name: z.string().min(1).max(100),
  domain: z.string().optional().nullable(),
  ip: z.string().optional().nullable(),
  vpnIp: z.string().optional().nullable(),
  timezoneOffsetSeconds: z.union([z.number(), z.string()]).transform(v => toInt(v, 0)).optional(),
  networkInterface: z.string().optional().nullable(),
  networkSpeed: z.union([z.number(), z.string()]).transform(v => toInt(v, 0)).optional(),
  httpPort: z.union([z.number(), z.string()]).transform(v => toInt(v, 80)).optional(),
  httpsPort: z.union([z.number(), z.string()]).transform(v => toInt(v, 443)).optional(),
  rtmpPort: z.union([z.number(), z.string()]).transform(v => toInt(v, 0)).optional(),
  maxClients: z.union([z.number(), z.string()]).transform(v => toInt(v, 100000)).optional(),
  onlyTimeshift: z.union([z.boolean(), z.string()]).transform(v => v === true || v === 'true').optional(),
  duplex: z.union([z.boolean(), z.string()]).transform(v => v === true || v === 'true').optional(),
  geoipEnabled: z.union([z.boolean(), z.string()]).transform(v => v === true || v === 'true').optional(),
  geoipPriority: z.string().optional().nullable(),
  geoipCountries: z.string().optional().nullable(),
  ispEnabled: z.union([z.boolean(), z.string()]).transform(v => v === true || v === 'true').optional(),
  ispPriority: z.string().optional().nullable(),
  ispNames: z.string().optional().nullable(),
  edgeToken: z.string().optional().nullable(),
  sshHost: z.string().optional().nullable(),
  sshPort: z.union([z.number(), z.string()]).transform(v => toInt(v, 22)).optional(),
  sshUser: z.string().optional().nullable(),
  sshPassword: z.string().optional().nullable(),
  sshKey: z.string().optional().nullable(),
  os: z.string().optional().nullable(),
  isActive: z.union([z.boolean(), z.string()]).transform(v => v === true || v === 'true' || v === undefined).optional(),
});

const bouquetSchema = z.object({
  name: z.string().min(1),
  isActive: z.union([z.boolean(), z.string()]).transform(v => v === true || v === 'true' || v === undefined).optional(),
  streamIds: z.array(z.string().uuid()).optional(),
});

const packageSchema = z.object({
  name: z.string().min(1),
  durationDays: z.union([z.number(), z.string()]).transform(v => toInt(v, 30)).optional(),
  connections: z.union([z.number(), z.string()]).transform(v => toInt(v, 1)).optional(),
  priceCents: z.union([z.number(), z.string()]).transform(v => toInt(v, 0)).optional(),
  isActive: z.union([z.boolean(), z.string()]).transform(v => v === true || v === 'true' || v === undefined).optional(),
  bouquetIds: z.array(z.string().uuid()).optional(),
});

const lineSchema = z.object({
  username: z.string().min(3).max(64),
  password: z.string().min(4).max(128),
  expiresAt: z.union([z.string(), z.date()]).transform(v => (v instanceof Date ? v : new Date(v))),
  connections: z.union([z.number(), z.string()]).transform(v => toInt(v, 1)).optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  packageId: z.string().uuid().optional().nullable(),
});

const vodSchema = z.object({
  name: z.string().min(1),
  streamUrl: z.string().min(1),
  posterUrl: z.string().optional().nullable(),
  isActive: z.union([z.boolean(), z.string()]).transform(v => v === true || v === 'true' || v === undefined).optional(),
  bouquetIds: z.array(z.string().uuid()).optional(),
});

const seriesSchema = z.object({
  name: z.string().min(1),
  coverUrl: z.string().optional().nullable(),
  isActive: z.union([z.boolean(), z.string()]).transform(v => v === true || v === 'true' || v === undefined).optional(),
  bouquetIds: z.array(z.string().uuid()).optional(),
});

const seriesEpisodeSchema = z.object({
  season: z.union([z.number(), z.string()]).transform(v => toInt(v, 1)).optional(),
  episode: z.union([z.number(), z.string()]).transform(v => toInt(v, 1)).optional(),
  title: z.string().min(1),
  streamUrl: z.string().min(1),
  isActive: z.union([z.boolean(), z.string()]).transform(v => v === true || v === 'true' || v === undefined).optional(),
});

const importM3USchema = z.object({
  url: z.string().url(),
  mode: z.enum(['append', 'replace']).optional(),
  type: z.enum(['all', 'live', 'movie', 'series', 'vod']).optional(),
  createPackage: z.union([z.boolean(), z.string()]).transform(v => v === true || v === 'true').optional(),
  packageName: z.string().min(1).optional(),
  createLine: z.union([z.boolean(), z.string()]).transform(v => v === true || v === 'true').optional(),
  lineUsername: z.string().min(3).max(64).optional(),
  linePassword: z.string().min(4).max(128).optional(),
  lineExpiresDays: z.union([z.number(), z.string()]).transform(v => toInt(v, 30)).optional(),
});

const m3uScheduleSchema = z.object({
  name: z.string().min(1),
  m3uUrl: z.string().url(),
  cronExpression: z.string().min(1),
  type: z.enum(['all', 'live', 'movie', 'series', 'vod']).optional(),
  mode: z.enum(['append', 'replace']).optional(),
  createPackage: z.union([z.boolean(), z.string()]).transform(v => v === true || v === 'true' || v === undefined).optional(),
  packageName: z.string().min(1).optional(),
  isActive: z.union([z.boolean(), z.string()]).transform(v => v === true || v === 'true' || v === undefined).optional(),
});

const epgSourceSchema = z.object({
  name: z.string().min(1),
  xmltvUrl: z.string().url(),
  cronExpression: z.string().min(1),
  daysAhead: z.union([z.number(), z.string()]).transform(v => toInt(v, 2)).optional(),
  isActive: z.union([z.boolean(), z.string()]).transform(v => v === true || v === 'true' || v === undefined).optional(),
});

const coreRenewPaymentSchema = z.object({
  lineId: z.string().uuid(),
  packageId: z.string().uuid(),
  customerName: z.string().min(1).max(120).optional(),
  customerPhone: z.string().min(8).max(32).optional(),
});

const coreSalePaymentSchema = z.object({
  packageId: z.string().uuid(),
  customerName: z.string().min(1).max(120).optional(),
  customerPhone: z.string().min(8).max(32).optional(),
});

function toYmd(date: Date) {
  return date.toISOString().slice(0, 10);
}

function ymdToDate(ymd: string | null | undefined) {
  if (!ymd) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return new Date(`${ymd}T00:00:00.000Z`);
  const d = new Date(ymd);
  return isNaN(d.getTime()) ? null : d;
}

function normalizeAsaasStatus(status: any) {
  const st = String(status || '').toUpperCase();
  return st;
}

async function syncBouquetStreams(bouquetId: string, desiredStreamIds: string[]) {
  const existing = await prisma.coreBouquetStream.findMany({
    where: { bouquetId },
    select: { streamId: true },
  });
  const existingIds = new Set(existing.map(e => e.streamId));
  const desiredIds = new Set(desiredStreamIds);

  const toAdd = desiredStreamIds.filter(id => !existingIds.has(id));
  const toRemove = existing.filter(e => !desiredIds.has(e.streamId)).map(e => e.streamId);

  if (toRemove.length) {
    await prisma.coreBouquetStream.deleteMany({
      where: { bouquetId, streamId: { in: toRemove } },
    });
  }
  if (toAdd.length) {
    await prisma.coreBouquetStream.createMany({
      data: toAdd.map(streamId => ({ bouquetId, streamId })),
      skipDuplicates: true,
    });
  }
}

async function syncPackageBouquets(packageId: string, desiredBouquetIds: string[]) {
  const existing = await prisma.corePackageBouquet.findMany({
    where: { packageId },
    select: { bouquetId: true },
  });
  const existingIds = new Set(existing.map(e => e.bouquetId));
  const desiredIds = new Set(desiredBouquetIds);

  const toAdd = desiredBouquetIds.filter(id => !existingIds.has(id));
  const toRemove = existing.filter(e => !desiredIds.has(e.bouquetId)).map(e => e.bouquetId);

  if (toRemove.length) {
    await prisma.corePackageBouquet.deleteMany({
      where: { packageId, bouquetId: { in: toRemove } },
    });
  }
  if (toAdd.length) {
    await prisma.corePackageBouquet.createMany({
      data: toAdd.map(bouquetId => ({ packageId, bouquetId })),
      skipDuplicates: true,
    });
  }
}

async function syncVodItemBouquets(vodItemId: string, allOwnedBouquetIds: string[], desiredBouquetIds: string[]) {
  await prisma.coreBouquetVodItem.deleteMany({
    where: { vodItemId, bouquetId: { in: allOwnedBouquetIds } },
  });
  if (desiredBouquetIds.length) {
    await prisma.coreBouquetVodItem.createMany({
      data: desiredBouquetIds.map(bouquetId => ({ bouquetId, vodItemId })),
      skipDuplicates: true,
    });
  }
}

async function syncSeriesBouquets(seriesId: string, allOwnedBouquetIds: string[], desiredBouquetIds: string[]) {
  await prisma.coreBouquetSeries.deleteMany({
    where: { seriesId, bouquetId: { in: allOwnedBouquetIds } },
  });
  if (desiredBouquetIds.length) {
    await prisma.coreBouquetSeries.createMany({
      data: desiredBouquetIds.map(bouquetId => ({ bouquetId, seriesId })),
      skipDuplicates: true,
    });
  }
}

function parseSeriesEpisodeName(raw: string): { seriesName: string; season: number; episode: number; title: string } | null {
  const name = (raw || '').trim();
  if (!name) return null;

  const patterns: Array<{ re: RegExp; to: (m: RegExpMatchArray) => { season: number; episode: number; seriesName: string } }> = [
    {
      re: /^(.*?)[\s\-_:]*[Ss](\d{1,2})\s*[Ee](\d{1,2})(.*)$/i,
      to: (m) => ({ seriesName: m[1].trim(), season: parseInt(m[2], 10), episode: parseInt(m[3], 10) }),
    },
    {
      re: /^(.*?)[\s\-_:]*(\d{1,2})\s*x\s*(\d{1,2})(.*)$/i,
      to: (m) => ({ seriesName: m[1].trim(), season: parseInt(m[2], 10), episode: parseInt(m[3], 10) }),
    },
    {
      re: /^(.*?)[\s\-_:]*[Tt]emp(?:orada)?\s*(\d+)\s*[Ee]p(?:is[oó]dio)?\s*(\d+)(.*)$/i,
      to: (m) => ({ seriesName: m[1].trim(), season: parseInt(m[2], 10), episode: parseInt(m[3], 10) }),
    },
  ];

  for (const p of patterns) {
    const m = name.match(p.re);
    if (!m) continue;
    const base = p.to(m);
    const tail = (m[4] || '').replace(/^[-\s:]+/, '').trim();
    const seriesName = base.seriesName || name;
    const title = tail ? tail : name;
    if (!Number.isFinite(base.season) || !Number.isFinite(base.episode)) continue;
    return { seriesName, season: base.season, episode: base.episode, title };
  }
  return null;
}

type ImportM3UInput = z.infer<typeof importM3USchema>;

async function runCoreM3UImport(ownerId: string, input: ImportM3UInput) {
  const {
    url,
    mode = 'append',
    type = 'all',
    createPackage = false,
    packageName,
    createLine = false,
    lineUsername,
    linePassword,
    lineExpiresDays = 30,
  } = input;

  const parser = new M3UParser();
  const parsed = await parser.parseFromUrl(url, 120000);

  const wantedTypes = (() => {
    if (type === 'all') return new Set(['live', 'movie', 'series']);
    if (type === 'vod') return new Set(['movie', 'series']);
    return new Set([type]);
  })();

  const items = parsed.items.filter(i => wantedTypes.has(i.type));
  if (!items.length) {
    return {
      ok: true,
      message: 'Nenhum item compatível encontrado no M3U para importar',
      stats: parsed.stats,
      imported: { bouquetsCreated: 0, streamsCreated: 0, vodCreated: 0, seriesCreated: 0, episodesCreated: 0, skipped: 0 },
      createdPackage: null,
      createdLine: null,
    };
  }

  if (mode === 'replace') {
    if (wantedTypes.has('live')) {
      await prisma.coreBouquetStream.deleteMany({ where: { bouquet: { ownerId } } });
      await prisma.coreStream.deleteMany({ where: { ownerId } });
    }
    if (wantedTypes.has('movie')) {
      await prisma.coreBouquetVodItem.deleteMany({ where: { bouquet: { ownerId } } });
      await prisma.coreVodItem.deleteMany({ where: { ownerId } });
    }
    if (wantedTypes.has('series')) {
      await prisma.coreBouquetSeries.deleteMany({ where: { bouquet: { ownerId } } });
      await prisma.coreSeriesEpisode.deleteMany({ where: { series: { ownerId } } });
      await prisma.coreSeries.deleteMany({ where: { ownerId } });
    }
  }

  const groupNames = Array.from(new Set(items.map(i => (i.group || 'Sem categoria').trim() || 'Sem categoria')));
  const existingBouquets = await prisma.coreBouquet.findMany({
    where: { ownerId, name: { in: groupNames } },
    select: { id: true, name: true },
  });
  const bouquetByName = new Map(existingBouquets.map(b => [b.name, b.id] as const));

  let bouquetsCreated = 0;
  for (const name of groupNames) {
    if (bouquetByName.has(name)) continue;
    const b = await prisma.coreBouquet.create({
      data: { ownerId, name, isActive: true },
      select: { id: true },
    });
    bouquetByName.set(name, b.id);
    bouquetsCreated++;
  }

  let streamsCreated = 0;
  let vodCreated = 0;
  let seriesCreated = 0;
  let episodesCreated = 0;
  let skipped = 0;

  const allOwnedBouquets = await prisma.coreBouquet.findMany({
    where: { ownerId },
    select: { id: true, name: true },
  });
  const ownedBouquetNames = new Set(allOwnedBouquets.map(b => b.name));

  for (const item of items) {
    const group = (item.group || 'Sem categoria').trim() || 'Sem categoria';
    if (!ownedBouquetNames.has(group)) {
      skipped++;
      continue;
    }
    const bouquetId = bouquetByName.get(group)!;

    if (item.type === 'live') {
      try {
        const stream = await prisma.coreStream.create({
          data: {
            ownerId,
            name: item.name,
            streamUrl: item.url,
            logoUrl: item.logo || null,
            epgChannelId: (item.tvgId || item.tvgName || null) as any,
            isActive: true,
          },
          select: { id: true },
        });
        streamsCreated++;
        await prisma.coreBouquetStream.create({
          data: { bouquetId, streamId: stream.id },
        }).catch(() => {});
      } catch {
        skipped++;
      }
      continue;
    }

    if (item.type === 'movie') {
      try {
        const vod = await prisma.coreVodItem.create({
          data: {
            ownerId,
            name: item.name,
            streamUrl: item.url,
            posterUrl: item.logo || null,
            isActive: true,
          },
          select: { id: true },
        });
        vodCreated++;
        await prisma.coreBouquetVodItem.create({
          data: { bouquetId, vodItemId: vod.id },
        }).catch(() => {});
      } catch {
        skipped++;
      }
      continue;
    }

    if (item.type === 'series') {
      const parsedEpisode = parseSeriesEpisodeName(item.name);
      const seriesName = parsedEpisode?.seriesName || item.group || item.name;
      const season = parsedEpisode?.season || 1;
      const episode = parsedEpisode?.episode || 1;
      const title = parsedEpisode?.title || item.name;

      let seriesRow = await prisma.coreSeries.findFirst({
        where: { ownerId, name: seriesName },
        select: { id: true },
      });
      if (!seriesRow) {
        try {
          seriesRow = await prisma.coreSeries.create({
            data: { ownerId, name: seriesName, coverUrl: item.logo || null, isActive: true },
            select: { id: true },
          });
          seriesCreated++;
        } catch {
          seriesRow = await prisma.coreSeries.findFirst({
            where: { ownerId, name: seriesName },
            select: { id: true },
          });
        }
      }

      if (!seriesRow) {
        skipped++;
        continue;
      }

      await prisma.coreBouquetSeries.create({
        data: { bouquetId, seriesId: seriesRow.id },
      }).catch(() => {});

      const existsEp = await prisma.coreSeriesEpisode.findFirst({
        where: { seriesId: seriesRow.id, season, episode },
        select: { id: true },
      });
      if (existsEp) {
        skipped++;
        continue;
      }

      await prisma.coreSeriesEpisode.create({
        data: {
          seriesId: seriesRow.id,
          season,
          episode,
          title,
          streamUrl: item.url,
          isActive: true,
        },
      });
      episodesCreated++;
      continue;
    }
  }

  const importedBouquetIds = groupNames.map((n) => bouquetByName.get(n)!).filter(Boolean);

  let createdPackage: { id: string; name: string } | null = null;
  if (createPackage) {
    const desiredName = (packageName || 'PACOTE PADRÃO').trim();
    const existingPkg = await prisma.corePackage.findFirst({
      where: { ownerId, name: desiredName },
      select: { id: true, name: true },
    });
    if (existingPkg) {
      createdPackage = existingPkg;
    } else {
      createdPackage = await prisma.corePackage.create({
        data: {
          ownerId,
          name: desiredName,
          durationDays: 30,
          connections: 1,
          priceCents: 0,
          isActive: true,
        },
        select: { id: true, name: true },
      });
    }
    if (importedBouquetIds.length) {
      await syncPackageBouquets(createdPackage.id, importedBouquetIds);
    }
  }

  let createdLine: { id: string; username: string; password: string; expiresAt: string; packageId: string | null } | null = null;
  if (createLine) {
    const desiredUsername = (lineUsername || '').trim();
    const desiredPassword = (linePassword || '').trim();

    const expiresAt = new Date(Date.now() + Math.max(1, lineExpiresDays) * 24 * 60 * 60 * 1000);
    const password = desiredPassword || crypto.randomBytes(8).toString('hex');

    const tryCreate = async (username: string) => {
      const hash = await bcrypt.hash(password, 10);
      return prisma.coreLine.create({
        data: {
          ownerId,
          username,
          passwordHash: hash,
          status: 'ACTIVE',
          connections: 1,
          expiresAt,
          packageId: createdPackage?.id ?? null,
        },
        select: { id: true, username: true, expiresAt: true, packageId: true },
      });
    };

    let usernameToUse = desiredUsername;
    if (!usernameToUse) {
      usernameToUse = `line_${crypto.randomBytes(5).toString('hex')}`;
    }

    let created = null as any;
    for (let i = 0; i < 5; i++) {
      try {
        created = await tryCreate(usernameToUse);
        break;
      } catch {
        usernameToUse = `line_${crypto.randomBytes(5).toString('hex')}`;
      }
    }

    if (created) {
      createdLine = {
        id: created.id,
        username: created.username,
        password,
        expiresAt: created.expiresAt.toISOString(),
        packageId: created.packageId,
      };
    }
  }

  return {
    ok: true,
    stats: parsed.stats,
    imported: { bouquetsCreated, streamsCreated, vodCreated, seriesCreated, episodesCreated, skipped },
    createdPackage,
    createdLine,
  };
}

async function syncStreamEdgeServers(streamId: string, desiredServerIds: string[]) {
  const existing = await (prisma as any).coreStreamEdgeServer.findMany({
    where: { streamId },
    select: { serverId: true },
  });
  const existingIds = new Set(existing.map((e: any) => e.serverId));
  const desiredIds = new Set(desiredServerIds);

  const toAdd = desiredServerIds.filter((id) => !existingIds.has(id));
  const toRemove = existing.filter((e: any) => !desiredIds.has(e.serverId)).map((e: any) => e.serverId);

  if (toRemove.length) {
    await (prisma as any).coreStreamEdgeServer.deleteMany({
      where: { streamId, serverId: { in: toRemove } },
    });
  }
  if (toAdd.length) {
    await (prisma as any).coreStreamEdgeServer.createMany({
      data: toAdd.map((serverId: string) => ({ streamId, serverId })),
      skipDuplicates: true,
    });
  }
}

export const listStreams = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;

  const streams = await prisma.coreStream.findMany({
    where: coreOwnerWhere(currentUser),
    orderBy: [{ createdAt: 'desc' }],
  });

  const bouquetLinks = await prisma.coreBouquetStream.findMany({
    where: {
      bouquet: coreOwnerWhere(currentUser),
    },
    select: { streamId: true, bouquetId: true },
  });

  const byStream: Record<string, string[]> = {};
  for (const link of bouquetLinks) {
    if (!byStream[link.streamId]) byStream[link.streamId] = [];
    byStream[link.streamId].push(link.bouquetId);
  }

  const serverLinks = await (prisma as any).coreStreamEdgeServer.findMany({
    where: { stream: coreOwnerWhere(currentUser) },
    select: { streamId: true, serverId: true },
  });
  const serversByStream: Record<string, string[]> = {};
  for (const link of serverLinks) {
    if (!serversByStream[link.streamId]) serversByStream[link.streamId] = [];
    serversByStream[link.streamId].push(link.serverId);
  }

  res.json({
    data: streams.map(s => ({
      ...s,
      bouquetIds: byStream[s.id] || [],
      serverIds: serversByStream[s.id] || [],
    })),
  });
});

export const probeStreamUpstreams = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

  const stream = await prisma.coreStream.findFirst({
    where: { id, ...coreOwnerWhere(currentUser) },
    select: { id: true, name: true, streamUrl: true },
  });
  if (!stream) throw new AppError(404, 'Stream não encontrada');

  const rawUrls = String(stream.streamUrl || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const urls = rawUrls.filter(u => {
    if (seen.has(u)) return false;
    seen.add(u);
    return true;
  });

  const maxCheck = 10;
  const toCheck = urls.slice(0, maxCheck);
  const truncated = Math.max(0, urls.length - toCheck.length);

  const results: Array<{ url: string; ok: boolean; status: number | null; ms: number; error: string | null }> = [];

  for (const url of toCheck) {
    const startedAt = Date.now();
    let status: number | null = null;
    let ok = false;
    let error: string | null = null;

    if (!/^https?:\/\//i.test(url)) {
      error = 'URL não suportada';
    } else {
      try {
        const upstream = await axios.request({
          url,
          method: 'GET',
          responseType: 'stream',
          timeout: 8000,
          maxRedirects: 3,
          validateStatus: () => true,
        });
        status = typeof upstream.status === 'number' ? upstream.status : null;
        ok = typeof upstream.status === 'number' ? upstream.status < 400 : false;
        try {
          if (upstream?.data && typeof (upstream.data as any).destroy === 'function') (upstream.data as any).destroy();
        } catch {}
      } catch (e: any) {
        error = e?.message ? String(e.message) : 'Falha ao conectar';
      }
    }

    results.push({ url, ok, status, ms: Math.max(0, Date.now() - startedAt), error });
  }

  res.json({
    data: {
      streamId: stream.id,
      streamName: stream.name,
      totalUrls: urls.length,
      checkedUrls: toCheck.length,
      truncated,
      results,
    },
  });
});

export const bulkApplyEdgeServersToStreams = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { streamIds, mode } = z
    .object({
      streamIds: z.array(z.string().uuid()).min(1).max(200),
      mode: z.enum(['append', 'replace']).optional(),
    })
    .parse(req.body);

  const servers = await prisma.coreEdgeServer.findMany({
    where: { ...coreOwnerWhere(currentUser), isActive: true },
    orderBy: [{ createdAt: 'asc' }],
  });
  if (!servers.length) throw new AppError(400, 'Nenhum servidor ativo cadastrado');

  const makeUnique = (items: string[]) => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const x of items) {
      const v = (x || '').trim();
      if (!v) continue;
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out;
  };

  const results: Array<{ streamId: string; updated: boolean; added: number; totalUrls: number; error?: string }> = [];
  let updatedCount = 0;
  let skippedCount = 0;

  for (const streamId of streamIds) {
    const stream = await prisma.coreStream.findFirst({
      where: { id: streamId, ...coreOwnerWhere(currentUser) },
      select: { id: true, streamUrl: true },
    });
    if (!stream) {
      skippedCount++;
      results.push({ streamId, updated: false, added: 0, totalUrls: 0, error: 'Stream não encontrada' });
      continue;
    }

    const existingUrls = makeUnique(String(stream.streamUrl || '').split(/\r?\n/));
    const baseRaw = existingUrls.find(u => /^https?:\/\//i.test(u)) || '';
    if (!baseRaw) {
      skippedCount++;
      results.push({ streamId, updated: false, added: 0, totalUrls: existingUrls.length, error: 'Sem URL base válida' });
      continue;
    }

    let base: URL;
    try {
      base = new URL(baseRaw);
    } catch {
      skippedCount++;
      results.push({ streamId, updated: false, added: 0, totalUrls: existingUrls.length, error: 'URL base inválida' });
      continue;
    }

    const scheme = base.protocol.replace(':', '') === 'https' ? 'https' : 'http';
    const generated: string[] = [];

    for (const s of servers) {
      const hostRaw = (s.domain || s.ip || '').trim();
      if (!hostRaw) continue;

      let host = '';
      let port = scheme === 'https' ? s.httpsPort : s.httpPort;

      try {
        if (/^https?:\/\//i.test(hostRaw)) {
          const parsed = new URL(hostRaw);
          host = parsed.hostname;
          port = parsed.port ? parseInt(parsed.port, 10) || port : port;
        } else {
          const parsed = new URL(`${scheme}://${hostRaw}`);
          host = parsed.hostname;
          port = parsed.port ? parseInt(parsed.port, 10) || port : port;
        }
      } catch {
        continue;
      }

      if (!host) continue;

      const u = new URL(base.toString());
      u.protocol = `${scheme}:`;
      u.hostname = host;
      const shouldOmitPort = (scheme === 'http' && port === 80) || (scheme === 'https' && port === 443);
      u.port = shouldOmitPort ? '' : String(Math.max(1, port));
      generated.push(u.toString());
    }

    const uniqueGenerated = makeUnique(generated);
    const nextUrls = mode === 'replace' ? uniqueGenerated : makeUnique([...existingUrls, ...uniqueGenerated]);
    const nextText = nextUrls.join('\n');
    const updated = nextText !== stream.streamUrl;

    if (updated) {
      await prisma.coreStream.update({
        where: { id: stream.id },
        data: { streamUrl: nextText },
      });
      updatedCount++;
    } else {
      skippedCount++;
    }

    results.push({
      streamId,
      updated,
      added: mode === 'replace' ? uniqueGenerated.length : Math.max(0, nextUrls.length - existingUrls.length),
      totalUrls: nextUrls.length,
    });
  }

  res.json({
    ok: true,
    data: {
      mode: mode || 'append',
      serversUsed: servers.length,
      total: streamIds.length,
      updated: updatedCount,
      skipped: skippedCount,
      results,
    },
  });
});

export const listEdgeServers = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;

  const servers = await prisma.coreEdgeServer.findMany({
    where: coreOwnerWhere(currentUser),
    orderBy: [{ createdAt: 'desc' }],
  });

  res.json({
    data: servers.map(s => ({
      id: s.id,
      name: s.name,
      domain: s.domain,
      ip: s.ip,
      vpnIp: (s as any).vpnIp ?? null,
      timezoneOffsetSeconds: (s as any).timezoneOffsetSeconds ?? 0,
      networkInterface: (s as any).networkInterface ?? null,
      networkSpeed: (s as any).networkSpeed ?? 0,
      httpPort: s.httpPort,
      httpsPort: s.httpsPort,
      rtmpPort: s.rtmpPort,
      maxClients: (s as any).maxClients ?? 0,
      onlyTimeshift: !!(s as any).onlyTimeshift,
      duplex: !!(s as any).duplex,
      geoipEnabled: !!(s as any).geoipEnabled,
      geoipPriority: (s as any).geoipPriority ?? 'low',
      geoipCountries: (s as any).geoipCountries ?? null,
      ispEnabled: !!(s as any).ispEnabled,
      ispPriority: (s as any).ispPriority ?? 'low',
      ispNames: (s as any).ispNames ?? null,
      sshHost: s.sshHost,
      sshPort: s.sshPort,
      sshUser: s.sshUser,
      os: s.os,
      isActive: s.isActive,
      hasEdgeToken: !!(s as any).edgeTokenEnc,
      installedAt: (s as any).installedAt ?? null,
      hasSshPassword: !!s.sshPasswordEnc,
      hasSshKey: !!s.sshKeyEnc,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    })),
  });
});

export const getEdgeServersStatus = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;

  const servers = await prisma.coreEdgeServer.findMany({
    where: { ...coreOwnerWhere(currentUser), isActive: true },
    orderBy: [{ createdAt: 'desc' }],
    select: { id: true, domain: true, ip: true, httpPort: true, httpsPort: true },
  });

  const httpsAgent = new https.Agent({ rejectUnauthorized: false });

  const checkOne = async (server: { id: string; domain: string | null; ip: string | null; httpPort: number; httpsPort: number }) => {
    const host = (server.domain || server.ip || '').trim();
    if (!host) {
      return { serverId: server.id, ok: false, ms: 0, status: null as number | null, url: null as string | null, error: 'Sem domínio/IP' };
    }

    const candidates: Array<{ url: string; https: boolean }> = [];

    const httpPort = typeof server.httpPort === 'number' ? server.httpPort : 80;
    const httpsPort = typeof server.httpsPort === 'number' ? server.httpsPort : 443;

    const httpUrl = `http://${host}${httpPort === 80 ? '' : `:${httpPort}`}/health`;
    candidates.push({ url: httpUrl, https: false });

    if (httpsPort > 0) {
      const httpsUrl = `https://${host}${httpsPort === 443 ? '' : `:${httpsPort}`}/health`;
      candidates.push({ url: httpsUrl, https: true });
    }

    let lastErr: any = null;
    for (const c of candidates) {
      const startedAt = Date.now();
      try {
        const r = await axios.get(c.url, {
          timeout: 5000,
          maxRedirects: 2,
          validateStatus: () => true,
          httpsAgent: c.https ? httpsAgent : undefined,
        });
        const ms = Math.max(0, Date.now() - startedAt);
        const ok = r.status >= 200 && r.status < 400;
        return { serverId: server.id, ok, ms, status: r.status, url: c.url, error: null as string | null };
      } catch (e: any) {
        lastErr = e;
      }
    }

    const msg = lastErr?.response?.data?.error || lastErr?.message || String(lastErr || 'Erro');
    return { serverId: server.id, ok: false, ms: 0, status: null as number | null, url: null as string | null, error: msg };
  };

  const results = await Promise.all(servers.map(checkOne));
  res.json({
    data: {
      checkedAt: new Date().toISOString(),
      total: servers.length,
      results,
    },
  });
});

export const getEdgeServersMetrics = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;

  const servers = await prisma.coreEdgeServer.findMany({
    where: { ...coreOwnerWhere(currentUser), isActive: true },
    orderBy: [{ createdAt: 'desc' }],
    select: { id: true, name: true, domain: true, ip: true, httpPort: true, httpsPort: true, edgeTokenEnc: true },
  });

  const httpsAgent = new https.Agent({ rejectUnauthorized: false });

  const fetchOne = async (server: {
    id: string;
    name: string;
    domain: string | null;
    ip: string | null;
    httpPort: number;
    httpsPort: number;
    edgeTokenEnc: string | null;
  }) => {
    const host = (server.domain || server.ip || '').trim();
    if (!host) {
      return { serverId: server.id, ok: false, ms: 0, status: null as number | null, url: null as string | null, error: 'Sem domínio/IP', metrics: null as any };
    }

    const token = server.edgeTokenEnc ? decrypt(server.edgeTokenEnc) : null;
    const headers: Record<string, string> = {};
    if (token) headers['x-edge-token'] = token;

    const candidates: Array<{ url: string; https: boolean }> = [];
    const httpPort = typeof server.httpPort === 'number' ? server.httpPort : 80;
    const httpsPort = typeof server.httpsPort === 'number' ? server.httpsPort : 443;

    const httpUrl = `http://${host}${httpPort === 80 ? '' : `:${httpPort}`}/api/edge/metrics`;
    candidates.push({ url: httpUrl, https: false });
    if (httpsPort > 0) {
      const httpsUrl = `https://${host}${httpsPort === 443 ? '' : `:${httpsPort}`}/api/edge/metrics`;
      candidates.push({ url: httpsUrl, https: true });
    }

    let lastErr: any = null;
    for (const c of candidates) {
      const startedAt = Date.now();
      try {
        const r = await axios.get(c.url, {
          timeout: 5000,
          maxRedirects: 0,
          validateStatus: () => true,
          headers,
          httpsAgent: c.https ? httpsAgent : undefined,
        });
        const ms = Math.max(0, Date.now() - startedAt);
        const ok = r.status >= 200 && r.status < 300;
        return {
          serverId: server.id,
          serverName: server.name,
          ok,
          ms,
          status: r.status,
          url: c.url,
          error: ok ? null : (r.data?.error ? String(r.data.error) : `HTTP ${r.status}`),
          metrics: ok ? r.data?.data ?? r.data : null,
        };
      } catch (e: any) {
        lastErr = e;
      }
    }

    const msg = lastErr?.response?.data?.error || lastErr?.message || String(lastErr || 'Erro');
    return { serverId: server.id, serverName: server.name, ok: false, ms: 0, status: null as number | null, url: null as string | null, error: msg, metrics: null as any };
  };

  const results = await Promise.all(servers.map(fetchOne));

  res.json({
    data: {
      checkedAt: new Date().toISOString(),
      total: servers.length,
      results,
    },
  });
});

export const createEdgeServer = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const data = edgeServerSchema.parse(req.body);

  const domain = (data.domain || '').trim() || null;
  const ip = (data.ip || '').trim() || null;
  if (!domain && !ip) throw new AppError(400, 'Informe domínio ou IP');

  const created = await prisma.coreEdgeServer.create({
    data: {
      ownerId: currentUser.userId,
      name: data.name.trim(),
      domain,
      ip,
      vpnIp: (data.vpnIp || '').trim() || null,
      timezoneOffsetSeconds: data.timezoneOffsetSeconds ?? 0,
      networkInterface: (data.networkInterface || '').trim() || null,
      networkSpeed: Math.max(0, data.networkSpeed ?? 0),
      httpPort: data.httpPort ?? 80,
      httpsPort: data.httpsPort ?? 443,
      rtmpPort: data.rtmpPort ?? 0,
      maxClients: Math.max(0, data.maxClients ?? 100000),
      onlyTimeshift: data.onlyTimeshift ?? false,
      duplex: data.duplex ?? false,
      geoipEnabled: data.geoipEnabled ?? false,
      geoipPriority: (data.geoipPriority || '').trim() || 'low',
      geoipCountries: (data.geoipCountries || '').trim() || null,
      ispEnabled: data.ispEnabled ?? false,
      ispPriority: (data.ispPriority || '').trim() || 'low',
      ispNames: (data.ispNames || '').trim() || null,
      edgeTokenEnc: (data.edgeToken || '').trim() ? encrypt(String(data.edgeToken)) : null,
      sshHost: (data.sshHost || '').trim() || null,
      sshPort: data.sshPort ?? 22,
      sshUser: (data.sshUser || '').trim() || null,
      sshPasswordEnc: (data.sshPassword || '').trim() ? encrypt(String(data.sshPassword)) : null,
      sshKeyEnc: (data.sshKey || '').trim() ? encrypt(String(data.sshKey)) : null,
      os: (data.os || '').trim() || 'ubuntu',
      isActive: data.isActive ?? true,
    } as any,
  });

  res.status(201).json({
    data: {
      id: created.id,
      name: created.name,
      domain: created.domain,
      ip: created.ip,
      vpnIp: (created as any).vpnIp ?? null,
      timezoneOffsetSeconds: (created as any).timezoneOffsetSeconds ?? 0,
      networkInterface: (created as any).networkInterface ?? null,
      networkSpeed: (created as any).networkSpeed ?? 0,
      httpPort: created.httpPort,
      httpsPort: created.httpsPort,
      rtmpPort: created.rtmpPort,
      maxClients: (created as any).maxClients ?? 0,
      onlyTimeshift: !!(created as any).onlyTimeshift,
      duplex: !!(created as any).duplex,
      geoipEnabled: !!(created as any).geoipEnabled,
      geoipPriority: (created as any).geoipPriority ?? 'low',
      geoipCountries: (created as any).geoipCountries ?? null,
      ispEnabled: !!(created as any).ispEnabled,
      ispPriority: (created as any).ispPriority ?? 'low',
      ispNames: (created as any).ispNames ?? null,
      sshHost: created.sshHost,
      sshPort: created.sshPort,
      sshUser: created.sshUser,
      os: created.os,
      isActive: created.isActive,
      hasEdgeToken: !!(created as any).edgeTokenEnc,
      installedAt: (created as any).installedAt ?? null,
      hasSshPassword: !!created.sshPasswordEnc,
      hasSshKey: !!created.sshKeyEnc,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    },
  });
});

export const updateEdgeServer = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const data = edgeServerSchema.partial().parse(req.body);

  const existing = await prisma.coreEdgeServer.findFirst({ where: { id, ...coreOwnerWhere(currentUser) } });
  if (!existing) throw new AppError(404, 'Servidor não encontrado');

  const domain = data.domain !== undefined ? ((data.domain || '').trim() || null) : undefined;
  const ip = data.ip !== undefined ? ((data.ip || '').trim() || null) : undefined;
  const vpnIp = data.vpnIp !== undefined ? ((data.vpnIp || '').trim() || null) : undefined;
  const networkInterface = data.networkInterface !== undefined ? ((data.networkInterface || '').trim() || null) : undefined;
  const geoipPriority = data.geoipPriority !== undefined ? ((data.geoipPriority || '').trim() || 'low') : undefined;
  const geoipCountries = data.geoipCountries !== undefined ? ((data.geoipCountries || '').trim() || null) : undefined;
  const ispPriority = data.ispPriority !== undefined ? ((data.ispPriority || '').trim() || 'low') : undefined;
  const ispNames = data.ispNames !== undefined ? ((data.ispNames || '').trim() || null) : undefined;
  const edgeTokenEnc = data.edgeToken !== undefined ? ((data.edgeToken || '').trim() ? encrypt(String(data.edgeToken)) : null) : undefined;
  const sshHost = data.sshHost !== undefined ? ((data.sshHost || '').trim() || null) : undefined;
  const sshUser = data.sshUser !== undefined ? ((data.sshUser || '').trim() || null) : undefined;
  const os = data.os !== undefined ? ((data.os || '').trim() || 'ubuntu') : undefined;

  const updated = await prisma.coreEdgeServer.update({
    where: { id },
    data: {
      name: data.name !== undefined ? data.name.trim() : undefined,
      domain,
      ip,
      vpnIp,
      timezoneOffsetSeconds: data.timezoneOffsetSeconds ?? undefined,
      networkInterface,
      networkSpeed: data.networkSpeed ?? undefined,
      httpPort: data.httpPort ?? undefined,
      httpsPort: data.httpsPort ?? undefined,
      rtmpPort: data.rtmpPort ?? undefined,
      maxClients: data.maxClients ?? undefined,
      onlyTimeshift: data.onlyTimeshift ?? undefined,
      duplex: data.duplex ?? undefined,
      geoipEnabled: data.geoipEnabled ?? undefined,
      geoipPriority,
      geoipCountries,
      ispEnabled: data.ispEnabled ?? undefined,
      ispPriority,
      ispNames,
      edgeTokenEnc,
      sshHost,
      sshPort: data.sshPort ?? undefined,
      sshUser,
      sshPasswordEnc:
        data.sshPassword !== undefined ? ((data.sshPassword || '').trim() ? encrypt(String(data.sshPassword)) : null) : undefined,
      sshKeyEnc: data.sshKey !== undefined ? ((data.sshKey || '').trim() ? encrypt(String(data.sshKey)) : null) : undefined,
      os,
      isActive: data.isActive ?? undefined,
    } as any,
  });

  res.json({
    data: {
      id: updated.id,
      name: updated.name,
      domain: updated.domain,
      ip: updated.ip,
      vpnIp: (updated as any).vpnIp ?? null,
      timezoneOffsetSeconds: (updated as any).timezoneOffsetSeconds ?? 0,
      networkInterface: (updated as any).networkInterface ?? null,
      networkSpeed: (updated as any).networkSpeed ?? 0,
      httpPort: updated.httpPort,
      httpsPort: updated.httpsPort,
      rtmpPort: updated.rtmpPort,
      maxClients: (updated as any).maxClients ?? 0,
      onlyTimeshift: !!(updated as any).onlyTimeshift,
      duplex: !!(updated as any).duplex,
      geoipEnabled: !!(updated as any).geoipEnabled,
      geoipPriority: (updated as any).geoipPriority ?? 'low',
      geoipCountries: (updated as any).geoipCountries ?? null,
      ispEnabled: !!(updated as any).ispEnabled,
      ispPriority: (updated as any).ispPriority ?? 'low',
      ispNames: (updated as any).ispNames ?? null,
      sshHost: updated.sshHost,
      sshPort: updated.sshPort,
      sshUser: updated.sshUser,
      os: updated.os,
      isActive: updated.isActive,
      hasEdgeToken: !!(updated as any).edgeTokenEnc,
      installedAt: (updated as any).installedAt ?? null,
      hasSshPassword: !!updated.sshPasswordEnc,
      hasSshKey: !!updated.sshKeyEnc,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    },
  });
});

export const deleteEdgeServer = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

  const existing = await prisma.coreEdgeServer.findFirst({ where: { id, ...coreOwnerWhere(currentUser) } });
  if (!existing) throw new AppError(404, 'Servidor não encontrado');

  await prisma.coreEdgeServer.delete({ where: { id } });
  res.json({ ok: true });
});

export const startEdgeServerSshTestJob = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

  const server = await prisma.coreEdgeServer.findFirst({
    where: { id, ...coreOwnerWhere(currentUser) },
  });
  if (!server) throw new AppError(404, 'Servidor não encontrado');

  const sshHost = (server.sshHost || server.ip || server.domain || '').trim();
  if (!sshHost) throw new AppError(400, 'SSH não configurado (sshHost/ip/domínio)');
  if (!server.sshUser) throw new AppError(400, 'SSH não configurado (sshUser)');
  if (!server.sshPasswordEnc && !server.sshKeyEnc) throw new AppError(400, 'SSH não configurado (senha ou key)');

  const jobId = `core-edge-ssh-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  coreEdgeJobs.set(jobId, {
    status: 'processing',
    serverId: server.id,
    action: 'ssh_test',
    startedAt: new Date(),
    logs: [],
  });

  addCoreEdgeJobLog(jobId, `Iniciando teste SSH em ${server.sshUser}@${sshHost}:${server.sshPort || 22}`);
  res.json({ ok: true, jobId });

  const ssh = new SSHClient();
  coreEdgeJobConnections.set(jobId, ssh);

  const sshPassword = server.sshPasswordEnc ? decrypt(server.sshPasswordEnc) : undefined;
  const sshKey = server.sshKeyEnc ? decrypt(server.sshKeyEnc) : undefined;

  const finish = async (status: CoreEdgeJobStatus, error?: string) => {
    const job = coreEdgeJobs.get(jobId);
    if (job) {
      job.status = status;
      job.finishedAt = new Date();
      if (error) job.error = error;
    }
    try { ssh.end(); } catch {}
    coreEdgeJobConnections.delete(jobId);
  };

  try {
    ssh.on('ready', () => {
      addCoreEdgeJobLog(jobId, 'Conectado via SSH');
      ssh.exec('echo OK && uname -a && whoami', { pty: true }, (err: any, stream: any) => {
        if (err) {
          addCoreEdgeJobLog(jobId, `Falha ao executar comando: ${err.message || err}`);
          void finish('failed', err.message || String(err));
          return;
        }

        stream.on('data', (data: Buffer) => {
          const text = data.toString('utf8');
          for (const line of text.split(/\r?\n/)) {
            if (line.trim()) addCoreEdgeJobLog(jobId, line);
          }
        });
        stream.stderr.on('data', (data: Buffer) => {
          const text = data.toString('utf8');
          for (const line of text.split(/\r?\n/)) {
            if (line.trim()) addCoreEdgeJobLog(jobId, line);
          }
        });
        stream.on('close', (code: number) => {
          if (code === 0) {
            addCoreEdgeJobLog(jobId, 'Teste SSH finalizado com sucesso');
            void finish('completed');
          } else {
            addCoreEdgeJobLog(jobId, `Teste SSH finalizado com erro (exit code ${code})`);
            void finish('failed', `Exit code ${code}`);
          }
        });
      });
    });

    ssh.on('error', (err: any) => {
      addCoreEdgeJobLog(jobId, `Erro SSH: ${err?.message || err}`);
      void finish('failed', err?.message || String(err));
    });

    ssh.connect({
      host: sshHost,
      port: server.sshPort || 22,
      username: server.sshUser,
      password: sshPassword,
      privateKey: sshKey,
      readyTimeout: 20000,
      keepaliveInterval: 10000,
    } as any);
  } catch (e: any) {
    addCoreEdgeJobLog(jobId, `Erro: ${e?.message || e}`);
    void finish('failed', e?.message || String(e));
  }
});

export const startEdgeServerInstallNginxHealthJob = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

  const server = await prisma.coreEdgeServer.findFirst({
    where: { id, ...coreOwnerWhere(currentUser) },
  });
  if (!server) throw new AppError(404, 'Servidor não encontrado');

  const sshHost = (server.sshHost || server.ip || server.domain || '').trim();
  if (!sshHost) throw new AppError(400, 'SSH não configurado (sshHost/ip/domínio)');
  if (!server.sshUser) throw new AppError(400, 'SSH não configurado (sshUser)');
  if (!server.sshPasswordEnc && !server.sshKeyEnc) throw new AppError(400, 'SSH não configurado (senha ou key)');
  if (server.sshUser !== 'root') throw new AppError(400, 'Instalação requer SSH como root');

  const jobId = `core-edge-install-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  coreEdgeJobs.set(jobId, {
    status: 'processing',
    serverId: server.id,
    action: 'install_full_edge',
    startedAt: new Date(),
    logs: [],
  });

  addCoreEdgeJobLog(jobId, `Iniciando instalação (nginx + edge backend + /health) em ${server.sshUser}@${sshHost}:${server.sshPort || 22}`);
  res.json({ ok: true, jobId });

  const ssh = new SSHClient();
  coreEdgeJobConnections.set(jobId, ssh);

  const sshPassword = server.sshPasswordEnc ? decrypt(server.sshPasswordEnc) : undefined;
  const sshKey = server.sshKeyEnc ? decrypt(server.sshKeyEnc) : undefined;

  const httpPort = typeof server.httpPort === 'number' ? server.httpPort : 80;
  const conf = [
    'server {',
    `  listen ${httpPort} default_server;`,
    '  server_name _;',
    '  location = /health {',
    '    add_header Content-Type text/plain;',
    "    return 200 'OK';",
    '  }',
    '  location / {',
    '    proxy_http_version 1.1;',
    "    proxy_set_header Connection '';",
    '    proxy_set_header Host $host;',
    '    proxy_set_header X-Real-IP $remote_addr;',
    '    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
    '    proxy_set_header X-Forwarded-Proto $scheme;',
    '    proxy_buffering off;',
    '    proxy_request_buffering off;',
    '    proxy_read_timeout 3600s;',
    '    proxy_send_timeout 3600s;',
    '    proxy_pass http://127.0.0.1:3001;',
    '  }',
    '}',
  ].join('\n');

  const confB64 = Buffer.from(conf, 'utf8').toString('base64');

  const forwardedHostRaw = String(req.headers['x-forwarded-host'] || '').trim();
  const hostHeader = (forwardedHostRaw.split(',')[0]?.trim() || String(req.headers.host || '').trim()).replace(/:\d+$/, '');
  const mainHost = hostHeader || '127.0.0.1';
  const mainDbUrlRaw = String(process.env.DATABASE_URL || env.DATABASE_URL || '').trim();
  if (!mainDbUrlRaw || (!mainDbUrlRaw.startsWith('postgresql://') && !mainDbUrlRaw.startsWith('postgres://'))) {
    throw new AppError(500, 'DATABASE_URL do MAIN inválida (esperado postgres)');
  }

  const u = new URL(mainDbUrlRaw);
  const dbPort = u.port || '5432';
  u.hostname = mainHost;
  u.port = dbPort;
  const edgeDatabaseUrl = u.toString();

  const edgeToken = (server as any).edgeTokenEnc ? decrypt((server as any).edgeTokenEnc) : '';
  const jwtSecret = String(process.env.JWT_SECRET || env.JWT_SECRET || '').trim();
  const jwtRefreshSecret = String(process.env.JWT_REFRESH_SECRET || env.JWT_REFRESH_SECRET || '').trim();
  const encryptionKey = String(process.env.ENCRYPTION_KEY || env.ENCRYPTION_KEY || '').trim();
  const scheme = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0]?.trim() || 'http';
  const mainBase = `${scheme}://${mainHost}`;
  const allowedOrigins = [mainBase, `http://${mainHost}`, `https://${mainHost}`, `http://${sshHost}`, `https://${sshHost}`]
    .filter(Boolean)
    .map((s) => s.trim())
    .filter((s, idx, arr) => !!s && arr.indexOf(s) === idx)
    .join(',');

  const edgeEnv = [
    'NODE_ENV=production',
    'PORT=3001',
    'CORE_EDGE_ONLY=true',
    `DATABASE_URL=${edgeDatabaseUrl}`,
    edgeToken ? `EDGE_TOKEN=${edgeToken}` : '',
    jwtSecret ? `JWT_SECRET=${jwtSecret}` : '',
    jwtRefreshSecret ? `JWT_REFRESH_SECRET=${jwtRefreshSecret}` : '',
    encryptionKey ? `ENCRYPTION_KEY=${encryptionKey}` : '',
    `ALLOWED_ORIGINS=${allowedOrigins}`,
    `API_URL=${mainBase}/api`,
    `FRONTEND_URL=${mainBase}`,
  ]
    .filter(Boolean)
    .join('\n')
    .concat('\n');

  const edgeEnvB64 = Buffer.from(edgeEnv, 'utf8').toString('base64');

  const command =
    `set -eu; ` +
    `export DEBIAN_FRONTEND=noninteractive; ` +
    `apt-get update -y; ` +
    `apt-get install -y nginx git ca-certificates curl docker.io docker-compose-plugin netcat-openbsd; ` +
    `systemctl enable --now docker; ` +
    `echo "${confB64}" | base64 -d > /etc/nginx/sites-available/core-edge.conf; ` +
    `rm -f /etc/nginx/sites-enabled/default || true; ` +
    `ln -sf /etc/nginx/sites-available/core-edge.conf /etc/nginx/sites-enabled/core-edge.conf; ` +
    `nginx -t; ` +
    `systemctl restart nginx; ` +
    `systemctl enable nginx; ` +
    `echo "Verificando acesso ao Postgres do MAIN em ${mainHost}:${dbPort}"; ` +
    `nc -z -w 3 ${mainHost} ${dbPort} || (echo "ERRO: Balance nao consegue acessar o Postgres do MAIN (${mainHost}:${dbPort}). Libere a porta 5432 no MAIN somente para este balance." && exit 20); ` +
    `mkdir -p /opt/painelmaster-edge; ` +
    `(test -d /opt/painelmaster-edge/.git && (cd /opt/painelmaster-edge && git pull)) || git clone https://github.com/sidneiribeiro/painelmaster.git /opt/painelmaster-edge; ` +
    `mkdir -p /opt/painelmaster-edge/backend; ` +
    `echo "${edgeEnvB64}" | base64 -d > /opt/painelmaster-edge/backend/.env.edge; ` +
    `cd /opt/painelmaster-edge/backend; ` +
    `docker build -t painelmaster-edge-backend:latest .; ` +
    `docker rm -f painelmaster-edge-backend >/dev/null 2>&1 || true; ` +
    `docker run -d --name painelmaster-edge-backend --restart unless-stopped --env-file .env.edge -p 127.0.0.1:3001:3001 painelmaster-edge-backend:latest; ` +
    `curl -fsS http://127.0.0.1:3001/api/health >/dev/null; ` +
    `echo DONE`;

  const finish = async (status: CoreEdgeJobStatus, error?: string) => {
    const job = coreEdgeJobs.get(jobId);
    if (job) {
      job.status = status;
      job.finishedAt = new Date();
      if (error) job.error = error;
    }
    try { ssh.end(); } catch {}
    coreEdgeJobConnections.delete(jobId);
  };

  try {
    ssh.on('ready', () => {
      addCoreEdgeJobLog(jobId, 'Conectado via SSH');
      ssh.exec(command, { pty: true }, (err: any, stream: any) => {
        if (err) {
          addCoreEdgeJobLog(jobId, `Falha ao executar comando: ${err.message || err}`);
          void finish('failed', err.message || String(err));
          return;
        }

        stream.on('data', (data: Buffer) => {
          const text = data.toString('utf8');
          for (const line of text.split(/\r?\n/)) {
            if (line.trim()) addCoreEdgeJobLog(jobId, line);
          }
        });
        stream.stderr.on('data', (data: Buffer) => {
          const text = data.toString('utf8');
          for (const line of text.split(/\r?\n/)) {
            if (line.trim()) addCoreEdgeJobLog(jobId, line);
          }
        });
        stream.on('close', (code: number) => {
          if (code === 0) {
            addCoreEdgeJobLog(jobId, 'Instalação finalizada com sucesso');
            prisma.coreEdgeServer
              .updateMany({
                where: { id: server.id },
                data: { installedAt: new Date() } as any,
              })
              .catch(() => {});
            void finish('completed');
          } else {
            addCoreEdgeJobLog(jobId, `Instalação finalizada com erro (exit code ${code})`);
            void finish('failed', `Exit code ${code}`);
          }
        });
      });
    });

    ssh.on('error', (err: any) => {
      addCoreEdgeJobLog(jobId, `Erro SSH: ${err?.message || err}`);
      void finish('failed', err?.message || String(err));
    });

    ssh.connect({
      host: sshHost,
      port: server.sshPort || 22,
      username: server.sshUser,
      password: sshPassword,
      privateKey: sshKey,
      readyTimeout: 20000,
      keepaliveInterval: 10000,
    } as any);
  } catch (e: any) {
    addCoreEdgeJobLog(jobId, `Erro: ${e?.message || e}`);
    void finish('failed', e?.message || String(e));
  }
});

export const getEdgeServerJob = asyncHandler(async (req: Request, res: Response) => {
  const { jobId } = z.object({ jobId: z.string().min(1) }).parse(req.params);
  const job = coreEdgeJobs.get(jobId);
  if (!job) throw new AppError(404, 'Job não encontrado ou expirado');
  res.json({
    jobId,
    status: job.status,
    logs: job.logs || [],
    startedAt: job.startedAt,
    finishedAt: job.finishedAt || null,
    error: job.error || null,
  });
});

export const cancelEdgeServerJob = asyncHandler(async (req: Request, res: Response) => {
  const { jobId } = z.object({ jobId: z.string().min(1) }).parse(req.params);
  const job = coreEdgeJobs.get(jobId);
  if (!job) throw new AppError(404, 'Job não encontrado ou expirado');

  if (job.status !== 'processing') return res.json({ ok: true });

  job.status = 'canceled';
  job.finishedAt = new Date();
  addCoreEdgeJobLog(jobId, 'Cancelado');

  const ssh = coreEdgeJobConnections.get(jobId);
  if (ssh) {
    try { ssh.end(); } catch {}
    coreEdgeJobConnections.delete(jobId);
  }

  res.json({ ok: true });
});

export const createStream = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const data = streamSchema.parse(req.body);

  if (data.bouquetIds?.length) {
    const ownedCount = await prisma.coreBouquet.count({
      where: { id: { in: data.bouquetIds }, ...coreOwnerWhere(currentUser) },
    });
    if (ownedCount !== data.bouquetIds.length) {
      throw new AppError(403, 'Um ou mais bouquets não pertencem ao usuário');
    }
  }

  if (data.serverIds?.length) {
    const ownedCount = await prisma.coreEdgeServer.count({
      where: { id: { in: data.serverIds }, ...coreOwnerWhere(currentUser) },
    });
    if (ownedCount !== data.serverIds.length) {
      throw new AppError(403, 'Um ou mais servidores não pertencem ao usuário');
    }
  }

  const stream = await prisma.coreStream.create({
    data: {
      ownerId: currentUser.userId,
      name: data.name,
      streamUrl: data.streamUrl,
      logoUrl: data.logoUrl ?? null,
      epgChannelId: data.epgChannelId ?? null,
      tvArchive: data.tvArchive ?? false,
      tvArchiveDuration: Math.max(0, data.tvArchiveDuration ?? 0),
      isActive: data.isActive ?? true,
    },
  });

  if (data.bouquetIds?.length) {
    await prisma.coreBouquetStream.createMany({
      data: data.bouquetIds.map(bouquetId => ({ bouquetId, streamId: stream.id })),
      skipDuplicates: true,
    });
  }

  if (data.serverIds?.length) {
    await syncStreamEdgeServers(stream.id, data.serverIds);
  }

  res.status(201).json({ data: { ...stream, bouquetIds: data.bouquetIds || [], serverIds: data.serverIds || [] } });
});

export const updateStream = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { id } = req.params;
  const data = streamSchema.partial().parse(req.body);

  const existing = await prisma.coreStream.findFirst({ where: { id, ...coreOwnerWhere(currentUser) } });
  if (!existing) throw new AppError(404, 'Stream não encontrada');

  if (data.bouquetIds) {
    const ownedCount = await prisma.coreBouquet.count({
      where: { id: { in: data.bouquetIds }, ...coreOwnerWhere(currentUser) },
    });
    if (ownedCount !== data.bouquetIds.length) {
      throw new AppError(403, 'Um ou mais bouquets não pertencem ao usuário');
    }
  }

  if (data.serverIds) {
    const ownedCount = await prisma.coreEdgeServer.count({
      where: { id: { in: data.serverIds }, ...coreOwnerWhere(currentUser) },
    });
    if (ownedCount !== data.serverIds.length) {
      throw new AppError(403, 'Um ou mais servidores não pertencem ao usuário');
    }
  }

  const updated = await prisma.coreStream.update({
    where: { id },
    data: {
      name: data.name ?? undefined,
      streamUrl: data.streamUrl ?? undefined,
      logoUrl: data.logoUrl === undefined ? undefined : (data.logoUrl ?? null),
      epgChannelId: data.epgChannelId === undefined ? undefined : (data.epgChannelId ?? null),
      tvArchive: data.tvArchive === undefined ? undefined : (data.tvArchive ?? false),
      tvArchiveDuration: data.tvArchiveDuration === undefined ? undefined : Math.max(0, data.tvArchiveDuration),
      isActive: data.isActive ?? undefined,
    },
  });

  if (data.bouquetIds) {
    const allOwnedBouquets = await prisma.coreBouquet.findMany({
      where: coreOwnerWhere(currentUser),
      select: { id: true },
    });
    await prisma.coreBouquetStream.deleteMany({
      where: { streamId: id, bouquetId: { in: allOwnedBouquets.map(b => b.id) } },
    });
    if (data.bouquetIds.length) {
      await prisma.coreBouquetStream.createMany({
        data: data.bouquetIds.map(bouquetId => ({ bouquetId, streamId: id })),
        skipDuplicates: true,
      });
    }
  }

  if (data.serverIds) {
    await syncStreamEdgeServers(id, data.serverIds);
  }

  res.json({ data: { ...updated, serverIds: data.serverIds ?? undefined } });
});

export const removeStream = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { id } = req.params;

  const existing = await prisma.coreStream.findFirst({ where: { id, ...coreOwnerWhere(currentUser) } });
  if (!existing) throw new AppError(404, 'Stream não encontrada');

  await prisma.coreBouquetStream.deleteMany({ where: { streamId: id } });
  await (prisma as any).coreStreamEdgeServer.deleteMany({ where: { streamId: id } });
  await prisma.coreStream.delete({ where: { id } });

  res.json({ ok: true });
});

export const listBouquets = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;

  const bouquets = await prisma.coreBouquet.findMany({
    where: coreOwnerWhere(currentUser),
    include: {
      _count: { select: { streams: true } },
    },
    orderBy: [{ createdAt: 'desc' }],
  });

  res.json({ data: bouquets });
});

export const createBouquet = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const data = bouquetSchema.parse(req.body);

  const bouquet = await prisma.coreBouquet.create({
    data: {
      ownerId: currentUser.userId,
      name: data.name,
      isActive: data.isActive ?? true,
    },
  });

  if (data.streamIds?.length) {
    const streamsCount = await prisma.coreStream.count({
      where: { id: { in: data.streamIds }, ...coreOwnerWhere(currentUser) },
    });
    if (streamsCount !== data.streamIds.length) throw new AppError(404, 'Uma ou mais streams não existem');
    await syncBouquetStreams(bouquet.id, data.streamIds);
  }

  res.status(201).json({ data: bouquet });
});

export const updateBouquet = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { id } = req.params;
  const data = bouquetSchema.partial().parse(req.body);

  const bouquet = await prisma.coreBouquet.findFirst({
    where: { id, ...coreOwnerWhere(currentUser) },
  });
  if (!bouquet) throw new AppError(404, 'Bouquet não encontrado');

  const updated = await prisma.coreBouquet.update({
    where: { id },
    data: {
      name: data.name ?? undefined,
      isActive: data.isActive ?? undefined,
    },
  });

  if (data.streamIds) {
    const streamsCount = await prisma.coreStream.count({
      where: { id: { in: data.streamIds }, ...coreOwnerWhere(currentUser) },
    });
    if (streamsCount !== data.streamIds.length) throw new AppError(404, 'Uma ou mais streams não existem');
    await syncBouquetStreams(id, data.streamIds);
  }

  res.json({ data: updated });
});

export const removeBouquet = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { id } = req.params;

  const bouquet = await prisma.coreBouquet.findFirst({
    where: { id, ...coreOwnerWhere(currentUser) },
  });
  if (!bouquet) throw new AppError(404, 'Bouquet não encontrado');

  const packagesUsing = await prisma.corePackageBouquet.count({ where: { bouquetId: id } });
  if (packagesUsing > 0) throw new AppError(400, 'Bouquet está vinculado a um ou mais pacotes');

  await prisma.coreBouquetStream.deleteMany({ where: { bouquetId: id } });
  await prisma.coreBouquet.delete({ where: { id } });

  res.json({ ok: true });
});

export const listPackages = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;

  const packages = await prisma.corePackage.findMany({
    where: coreOwnerWhere(currentUser),
    include: {
      bouquets: { include: { bouquet: { select: { id: true, name: true } } } },
      _count: { select: { lines: true } },
    },
    orderBy: [{ createdAt: 'desc' }],
  });

  res.json({
    data: packages.map(p => ({
      ...p,
      bouquetIds: p.bouquets.map(b => b.bouquetId),
      bouquets: p.bouquets.map(b => b.bouquet),
    })),
  });
});

export const createPackage = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const data = packageSchema.parse(req.body);

  if (data.bouquetIds?.length) {
    const ownedCount = await prisma.coreBouquet.count({
      where: { id: { in: data.bouquetIds }, ...coreOwnerWhere(currentUser) },
    });
    if (ownedCount !== data.bouquetIds.length) throw new AppError(403, 'Um ou mais bouquets não pertencem ao usuário');
  }

  const pkg = await prisma.corePackage.create({
    data: {
      ownerId: currentUser.userId,
      name: data.name,
      durationDays: data.durationDays ?? 30,
      connections: data.connections ?? 1,
      priceCents: data.priceCents ?? 0,
      isActive: data.isActive ?? true,
    },
  });

  if (data.bouquetIds?.length) {
    await syncPackageBouquets(pkg.id, data.bouquetIds);
  }

  res.status(201).json({ data: pkg });
});

export const updatePackage = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { id } = req.params;
  const data = packageSchema.partial().parse(req.body);

  const pkg = await prisma.corePackage.findFirst({
    where: { id, ...coreOwnerWhere(currentUser) },
  });
  if (!pkg) throw new AppError(404, 'Pacote não encontrado');

  if (data.bouquetIds) {
    const ownedCount = await prisma.coreBouquet.count({
      where: { id: { in: data.bouquetIds }, ...coreOwnerWhere(currentUser) },
    });
    if (ownedCount !== data.bouquetIds.length) throw new AppError(403, 'Um ou mais bouquets não pertencem ao usuário');
  }

  const updated = await prisma.corePackage.update({
    where: { id },
    data: {
      name: data.name ?? undefined,
      durationDays: data.durationDays ?? undefined,
      connections: data.connections ?? undefined,
      priceCents: data.priceCents ?? undefined,
      isActive: data.isActive ?? undefined,
    },
  });

  if (data.bouquetIds) {
    await syncPackageBouquets(id, data.bouquetIds);
  }

  res.json({ data: updated });
});

export const removePackage = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { id } = req.params;

  const pkg = await prisma.corePackage.findFirst({
    where: { id, ...coreOwnerWhere(currentUser) },
  });
  if (!pkg) throw new AppError(404, 'Pacote não encontrado');

  const linesUsing = await prisma.coreLine.count({ where: { packageId: id } });
  if (linesUsing > 0) throw new AppError(400, 'Pacote está vinculado a uma ou mais linhas');

  await prisma.corePackageBouquet.deleteMany({ where: { packageId: id } });
  await prisma.corePackage.delete({ where: { id } });

  res.json({ ok: true });
});

export const listLines = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;

  const lines = await prisma.coreLine.findMany({
    where: coreOwnerWhere(currentUser),
    include: {
      package: { select: { id: true, name: true, connections: true, durationDays: true } },
    },
    orderBy: [{ createdAt: 'desc' }],
  });

  res.json({
    data: lines.map(l => ({
      ...l,
      passwordHash: undefined,
    })),
  });
});

export const createLine = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const data = lineSchema.parse(req.body);

  if (isNaN(data.expiresAt.getTime())) throw new AppError(400, 'expiresAt inválido');

  if (data.packageId) {
    const pkg = await prisma.corePackage.findFirst({
      where: { id: data.packageId, ...coreOwnerWhere(currentUser) },
      select: { id: true },
    });
    if (!pkg) throw new AppError(404, 'Pacote não encontrado');
  }

  const passwordHash = await bcrypt.hash(data.password, 10);

  const line = await prisma.coreLine.create({
    data: {
      ownerId: currentUser.userId,
      username: data.username,
      passwordHash,
      status: data.status ?? 'ACTIVE',
      connections: data.connections ?? 1,
      expiresAt: data.expiresAt,
      packageId: data.packageId ?? null,
    },
  });

  res.status(201).json({
    data: {
      ...line,
      passwordHash: undefined,
    },
  });
});

export const updateLine = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { id } = req.params;
  const data = lineSchema.partial().extend({ password: z.string().min(4).max(128).optional() }).parse(req.body);

  const line = await prisma.coreLine.findFirst({
    where: { id, ...coreOwnerWhere(currentUser) },
  });
  if (!line) throw new AppError(404, 'Linha não encontrada');

  if (data.expiresAt && isNaN(data.expiresAt.getTime())) throw new AppError(400, 'expiresAt inválido');

  if (data.packageId !== undefined && data.packageId !== null) {
    const pkg = await prisma.corePackage.findFirst({
      where: { id: data.packageId, ...coreOwnerWhere(currentUser) },
      select: { id: true },
    });
    if (!pkg) throw new AppError(404, 'Pacote não encontrado');
  }

  const updated = await prisma.coreLine.update({
    where: { id },
    data: {
      username: data.username ?? undefined,
      status: data.status ?? undefined,
      connections: data.connections ?? undefined,
      expiresAt: data.expiresAt ?? undefined,
      packageId: data.packageId === undefined ? undefined : (data.packageId ?? null),
      passwordHash: data.password ? await bcrypt.hash(data.password, 10) : undefined,
    },
  });

  res.json({
    data: {
      ...updated,
      passwordHash: undefined,
    },
  });
});

export const resetLinePassword = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

  const line = await prisma.coreLine.findFirst({
    where: { id, ...coreOwnerWhere(currentUser) },
    select: { id: true, username: true },
  });
  if (!line) throw new AppError(404, 'Linha não encontrada');

  const newPassword = crypto.randomBytes(8).toString('hex');
  const passwordHash = await bcrypt.hash(newPassword, 10);

  await prisma.coreLine.update({
    where: { id: line.id },
    data: { passwordHash },
    select: { id: true },
  });

  await prisma.actionLog
    .create({
      data: {
        userId: currentUser.userId,
        action: 'CORE_LINE_RESET_PASSWORD',
        entity: 'coreLine',
        entityId: line.id,
        details: JSON.stringify({ username: line.username }),
      },
    })
    .catch(() => {});

  res.json({
    data: {
      id: line.id,
      username: line.username,
      password: newPassword,
    },
  });
});

export const removeLine = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { id } = req.params;

  const line = await prisma.coreLine.findFirst({
    where: { id, ...coreOwnerWhere(currentUser) },
  });
  if (!line) throw new AppError(404, 'Linha não encontrada');

  await prisma.coreLine.delete({ where: { id } });
  res.json({ ok: true });
});

export const listCorePayments = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const id = typeof req.query.id === 'string' ? req.query.id : undefined;
  const lineId = typeof req.query.lineId === 'string' ? req.query.lineId : undefined;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  const cursorId = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
  const takeRaw = typeof req.query.take === 'string' ? parseInt(req.query.take, 10) : undefined;
  const take = Number.isFinite(takeRaw as any) ? Math.max(1, Math.min(500, takeRaw as number)) : 200;

  if (id) {
    const payment = await prisma.corePayment.findFirst({
      where: { id, ...coreOwnerWhere(currentUser) },
      select: { id: true },
    });
    if (!payment) throw new AppError(404, 'Pagamento não encontrado');
  }

  if (lineId) {
    const line = await prisma.coreLine.findFirst({
      where: { id: lineId, ...coreOwnerWhere(currentUser) },
      select: { id: true },
    });
    if (!line) throw new AppError(404, 'Linha não encontrada');
  }

  const createdAt: { gte?: Date; lte?: Date } = {};
  if (from) {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(from) ? new Date(`${from}T00:00:00.000Z`) : new Date(from);
    if (!isNaN(d.getTime())) createdAt.gte = d;
  }
  if (to) {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(to) ? new Date(`${to}T23:59:59.999Z`) : new Date(to);
    if (!isNaN(d.getTime())) createdAt.lte = d;
  }

  const safeCursorId = cursorId && /^[0-9a-fA-F-]{36}$/.test(cursorId) ? cursorId : undefined;

  const rows = await prisma.corePayment.findMany({
    where: {
      ...coreOwnerWhere(currentUser),
      ...(id ? { id } : {}),
      ...(lineId ? { lineId } : {}),
      ...(status ? { status } : {}),
      ...(kind ? { kind } : {}),
      ...(Object.keys(createdAt).length ? { createdAt } : {}),
      ...(q
        ? {
            OR: [
              { id: { contains: q, mode: 'insensitive' } },
              { asaasPaymentId: { contains: q, mode: 'insensitive' } },
              { customerName: { contains: q, mode: 'insensitive' } },
              { customerPhone: { contains: q, mode: 'insensitive' } },
              { newUsername: { contains: q, mode: 'insensitive' } },
              { line: { is: { username: { contains: q, mode: 'insensitive' } } } },
              { package: { is: { name: { contains: q, mode: 'insensitive' } } } },
              { owner: { is: { username: { contains: q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...(safeCursorId ? { cursor: { id: safeCursorId }, skip: 1 } : {}),
    take,
    select: {
      id: true,
      ownerId: true,
      lineId: true,
      packageId: true,
      daysToAdd: true,
      amountCents: true,
      kind: true,
      status: true,
      asaasPaymentId: true,
      invoiceUrl: true,
      pixQrCode: true,
      pixCopyPaste: true,
      dueDate: true,
      customerName: true,
      customerPhone: true,
      remindersEnabled: true,
      reminderCount: true,
      lastReminderAt: true,
      createdLineId: true,
      newUsername: true,
      paidAt: true,
      createdAt: true,
      updatedAt: true,
      owner: { select: { username: true, panelSettings: { select: { publicBaseUrl: true } } } },
      line: { select: { username: true } },
      package: { select: { name: true } },
    },
  });

  const mapped = rows.map((r) => ({
      ...r,
      checkoutToken: signCoreCheckoutToken(r.id),
    }));

  res.json({
    data: mapped,
    nextCursor: mapped.length === take ? mapped[mapped.length - 1].id : null,
  });
});

export const exportCorePayments = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  const takeRaw = typeof req.query.take === 'string' ? parseInt(req.query.take, 10) : undefined;
  const take = Number.isFinite(takeRaw as any) ? Math.max(1, Math.min(10000, takeRaw as number)) : 5000;

  const createdAt: { gte?: Date; lte?: Date } = {};
  if (from) {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(from) ? new Date(`${from}T00:00:00.000Z`) : new Date(from);
    if (!isNaN(d.getTime())) createdAt.gte = d;
  }
  if (to) {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(to) ? new Date(`${to}T23:59:59.999Z`) : new Date(to);
    if (!isNaN(d.getTime())) createdAt.lte = d;
  }

  const rows = await prisma.corePayment.findMany({
    where: {
      ...coreOwnerWhere(currentUser),
      ...(status ? { status } : {}),
      ...(kind ? { kind } : {}),
      ...(Object.keys(createdAt).length ? { createdAt } : {}),
      ...(q
        ? {
            OR: [
              { id: { contains: q, mode: 'insensitive' } },
              { asaasPaymentId: { contains: q, mode: 'insensitive' } },
              { customerName: { contains: q, mode: 'insensitive' } },
              { customerPhone: { contains: q, mode: 'insensitive' } },
              { newUsername: { contains: q, mode: 'insensitive' } },
              { line: { is: { username: { contains: q, mode: 'insensitive' } } } },
              { package: { is: { name: { contains: q, mode: 'insensitive' } } } },
              { owner: { is: { username: { contains: q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take,
    select: {
      id: true,
      kind: true,
      status: true,
      amountCents: true,
      asaasPaymentId: true,
      invoiceUrl: true,
      pixCopyPaste: true,
      dueDate: true,
      customerName: true,
      customerPhone: true,
      remindersEnabled: true,
      reminderCount: true,
      lastReminderAt: true,
      newUsername: true,
      createdAt: true,
      paidAt: true,
      owner: { select: { username: true, panelSettings: { select: { publicBaseUrl: true } } } },
      line: { select: { username: true } },
      package: { select: { name: true } },
    },
  });

  const escape = (val: any) => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const today = new Date().toISOString().split('T')[0];
  const filename = `core_pagamentos_${today}.csv`;

  const header = [
    'id',
    'revenda',
    'tipo',
    'status',
    'valor',
    'pacote',
    'linha',
    'cliente_nome',
    'cliente_whatsapp',
    'vence_em',
    'criado_em',
    'pago_em',
    'invoice_url',
    'pix_copia_cola',
    'checkout_url',
    'lembretes_ativo',
    'lembretes_qtd',
    'lembretes_ultimo',
  ];

  const csvRows: string[] = [];
  csvRows.push(header.join(','));

  for (const r of rows) {
    const token = signCoreCheckoutToken(r.id);
    const base = stripApiSuffix(r.owner?.panelSettings?.publicBaseUrl || '') || stripApiSuffix(env.API_URL || '');
    const checkoutUrl = base && r.owner?.username ? `${base}/core/checkout/${encodeURIComponent(r.owner.username)}?t=${encodeURIComponent(token)}` : '';
    const lineUser = r.line?.username || r.newUsername || '';
    const value = (r.amountCents / 100).toFixed(2).replace('.', ',');

    csvRows.push(
      [
        escape(r.id),
        escape(r.owner?.username || ''),
        escape(r.kind || ''),
        escape(r.status || ''),
        escape(value),
        escape(r.package?.name || ''),
        escape(lineUser),
        escape(r.customerName || ''),
        escape(r.customerPhone || ''),
        escape(r.dueDate ? r.dueDate.toISOString().slice(0, 10) : ''),
        escape(r.createdAt ? r.createdAt.toISOString() : ''),
        escape(r.paidAt ? r.paidAt.toISOString() : ''),
        escape(r.invoiceUrl || ''),
        escape(r.pixCopyPaste || ''),
        escape(checkoutUrl),
        escape(r.remindersEnabled ? 'true' : 'false'),
        escape(r.reminderCount ?? 0),
        escape(r.lastReminderAt ? r.lastReminderAt.toISOString() : ''),
      ].join(',')
    );
  }

  const csvContent = csvRows.join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\ufeff' + csvContent);
});

export const setCorePaymentReminders = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);

  const payment = await prisma.corePayment.findFirst({
    where: { id, ...coreOwnerWhere(currentUser) },
    select: { id: true },
  });
  if (!payment) throw new AppError(404, 'Pagamento não encontrado');

  const updated = await prisma.corePayment.update({
    where: { id },
    data: { remindersEnabled: enabled },
    select: { id: true, remindersEnabled: true, reminderCount: true, lastReminderAt: true },
  });

  await prisma.actionLog.create({
    data: {
      userId: currentUser.userId,
      action: 'CORE_PAYMENT_REMINDERS',
      entity: 'corePayment',
      entityId: id,
      details: JSON.stringify({ enabled }),
    },
  }).catch(() => {});

  res.json({ data: updated });
});

export const updateCorePaymentCustomer = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const { customerName, customerPhone } = z
    .object({
      customerName: z.string().trim().min(1).max(120).optional().or(z.literal('')),
      customerPhone: z.string().trim().min(8).max(32).optional().or(z.literal('')),
    })
    .parse(req.body);

  const payment = await prisma.corePayment.findFirst({
    where: { id, ...coreOwnerWhere(currentUser) },
    select: { id: true },
  });
  if (!payment) throw new AppError(404, 'Pagamento não encontrado');

  const updated = await prisma.corePayment.update({
    where: { id },
    data: {
      ...(customerName !== undefined ? { customerName: customerName ? customerName : null } : {}),
      ...(customerPhone !== undefined ? { customerPhone: customerPhone ? customerPhone : null } : {}),
    },
    select: { id: true, customerName: true, customerPhone: true, updatedAt: true },
  });

  await prisma.actionLog.create({
    data: {
      userId: currentUser.userId,
      action: 'CORE_PAYMENT_UPDATE_CUSTOMER',
      entity: 'corePayment',
      entityId: id,
      details: JSON.stringify({ customerName: updated.customerName, customerPhone: updated.customerPhone }),
    },
  }).catch(() => {});

  res.json({ data: updated });
});

export const getCorePaymentHistory = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

  const payment = await prisma.corePayment.findFirst({
    where: { id, ...coreOwnerWhere(currentUser) },
    select: { id: true },
  });
  if (!payment) throw new AppError(404, 'Pagamento não encontrado');

  const [actions, notifications] = await Promise.all([
    prisma.actionLog.findMany({
      where: {
        entity: 'corePayment',
        entityId: id,
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 50,
      select: {
        id: true,
        action: true,
        details: true,
        createdAt: true,
        user: { select: { username: true } },
      },
    }),
    prisma.notificationLog.findMany({
      where: {
        relatedType: 'corePayment',
        relatedId: id,
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 50,
      select: {
        id: true,
        type: true,
        channel: true,
        status: true,
        error: true,
        createdAt: true,
        user: { select: { username: true } },
      },
    }),
  ]);

  const mappedActions = actions.map((a) => ({
    id: a.id,
    kind: 'ACTION',
    label: a.action,
    details: a.details,
    createdAt: a.createdAt,
    user: a.user,
  }));

  const mappedNotifications = notifications.map((n) => ({
    id: n.id,
    kind: 'NOTIFICATION',
    label: `${n.type} • ${n.channel}/${n.status}`,
    details: n.error ? JSON.stringify({ error: n.error }) : null,
    createdAt: n.createdAt,
    user: n.user,
  }));

  const merged = [...mappedActions, ...mappedNotifications]
    .sort((a, b) => new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime())
    .slice(0, 50);

  res.json({ data: merged });
});

export const syncCorePaymentNow = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

  const payment = await prisma.corePayment.findFirst({
    where: { id, ...coreOwnerWhere(currentUser) },
    select: {
      id: true,
      ownerId: true,
      status: true,
      asaasPaymentId: true,
      dueDate: true,
      invoiceUrl: true,
    },
  });
  if (!payment) throw new AppError(404, 'Pagamento não encontrado');
  if (!payment.asaasPaymentId) throw new AppError(400, 'Pagamento sem Asaas ID');

  const service = await getAsaasService(payment.ownerId);
  if (!service) throw new AppError(400, 'Asaas não configurado para este usuário');

  const remote = await service.getPayment(payment.asaasPaymentId);
  const remoteStatus = normalizeAsaasStatus(remote.status);
  const remoteDue = ymdToDate((remote as any).dueDate) || null;

  const computedStatus = (() => {
    if (!remoteStatus) return payment.status;
    if (remoteStatus !== 'PENDING') return remoteStatus;
    const due = remoteDue || payment.dueDate;
    if (!due) return remoteStatus;
    const endDue = new Date(due);
    endDue.setUTCHours(23, 59, 59, 999);
    return Date.now() > endDue.getTime() ? 'OVERDUE' : remoteStatus;
  })();

  const updated = await prisma.corePayment.update({
    where: { id: payment.id },
    data: {
      status: computedStatus,
      dueDate: remoteDue || payment.dueDate,
      invoiceUrl: remote.invoiceUrl || payment.invoiceUrl,
    },
    select: {
      id: true,
      status: true,
      asaasPaymentId: true,
      invoiceUrl: true,
      dueDate: true,
      paidAt: true,
      updatedAt: true,
    },
  });

  if (computedStatus === 'RECEIVED' || computedStatus === 'CONFIRMED') {
    await handleCorePaymentReceived({ id: payment.id }, remote).catch(() => {});
  }

  await prisma.actionLog.create({
    data: {
      userId: currentUser.userId,
      action: 'CORE_PAYMENT_SYNC_ASAAS',
      entity: 'corePayment',
      entityId: id,
      details: JSON.stringify({
        remoteStatus,
        computedStatus,
        remoteDue: (remote as any).dueDate || null,
        invoiceUrl: remote.invoiceUrl || null,
      }),
    },
  }).catch(() => {});

  res.json({
    data: {
      payment: updated,
      asaas: {
        id: remote.id,
        status: remoteStatus,
        dueDate: (remote as any).dueDate || null,
        invoiceUrl: remote.invoiceUrl || null,
      },
    },
  });
});

export const cancelCorePayment = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

  const payment = await prisma.corePayment.findFirst({
    where: { id, ...coreOwnerWhere(currentUser) },
    select: {
      id: true,
      ownerId: true,
      status: true,
      asaasPaymentId: true,
    },
  });
  if (!payment) throw new AppError(404, 'Pagamento não encontrado');

  const st = (payment.status || '').toUpperCase();
  if (st === 'CONFIRMED' || st === 'RECEIVED') throw new AppError(400, 'Pagamento já confirmado');
  if (st === 'CANCELLED' || st === 'REFUNDED' || st === 'CHARGEBACK') throw new AppError(400, 'Pagamento já está em status final');

  if (payment.asaasPaymentId) {
    const service = await getAsaasService(payment.ownerId);
    if (!service) throw new AppError(400, 'Asaas não configurado para este usuário');
    await service.cancelPayment(payment.asaasPaymentId);
  }

  const updated = await prisma.corePayment.update({
    where: { id: payment.id },
    data: { status: 'CANCELLED' },
    select: {
      id: true,
      status: true,
      asaasPaymentId: true,
      invoiceUrl: true,
      dueDate: true,
      paidAt: true,
      updatedAt: true,
    },
  });

  await prisma.actionLog.create({
    data: {
      userId: currentUser.userId,
      action: 'CORE_PAYMENT_CANCEL',
      entity: 'corePayment',
      entityId: id,
      details: JSON.stringify({ asaasPaymentId: payment.asaasPaymentId || null }),
    },
  }).catch(() => {});

  res.json({ data: updated });
});

export const getCorePaymentStats = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;

  const now = new Date();
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const start7d = new Date(startToday);
  start7d.setDate(start7d.getDate() - 6);
  const start30d = new Date(startToday);
  start30d.setDate(start30d.getDate() - 29);

  const parseFrom = (val: string | undefined, isEnd: boolean) => {
    if (!val) return undefined;
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      return new Date(`${val}T${isEnd ? '23:59:59.999' : '00:00:00.000'}Z`);
    }
    const d = new Date(val);
    return isNaN(d.getTime()) ? undefined : d;
  };

  const rangeFrom = parseFrom(from, false);
  const rangeTo = parseFrom(to, true);

  const baseWhere: any = {
    ...coreOwnerWhere(currentUser),
    ...(status ? { status } : {}),
    ...(kind ? { kind } : {}),
  };

  const confirmedStatuses = ['CONFIRMED', 'RECEIVED'];

  const sumPaidBetween = async (start: Date, end: Date) => {
    const agg = await prisma.corePayment.aggregate({
      where: {
        ...baseWhere,
        status: { in: confirmedStatuses },
        paidAt: { gte: start, lte: end },
      },
      _sum: { amountCents: true },
    });
    return agg._sum.amountCents || 0;
  };

  const todayCents = await sumPaidBetween(startToday, now);
  const last7dCents = await sumPaidBetween(start7d, now);
  const last30dCents = await sumPaidBetween(start30d, now);

  const [pendingCount, overdueCount, confirmedCount] = await Promise.all([
    prisma.corePayment.count({ where: { ...baseWhere, status: 'PENDING' } }),
    prisma.corePayment.count({ where: { ...baseWhere, status: 'OVERDUE' } }),
    prisma.corePayment.count({ where: { ...baseWhere, status: { in: confirmedStatuses } } }),
  ]);

  const topWhere: any = {
    ...baseWhere,
    status: { in: confirmedStatuses },
    ...(rangeFrom || rangeTo ? { paidAt: { ...(rangeFrom ? { gte: rangeFrom } : {}), ...(rangeTo ? { lte: rangeTo } : {}) } } : {}),
  };

  const grouped = await prisma.corePayment.groupBy({
    by: ['packageId'],
    where: topWhere,
    _sum: { amountCents: true },
    _count: { _all: true },
    orderBy: [{ _sum: { amountCents: 'desc' } }],
    take: 5,
  });

  const packageIds = grouped.map((g) => g.packageId);
  const packages = packageIds.length
    ? await prisma.corePackage.findMany({ where: { id: { in: packageIds } }, select: { id: true, name: true } })
    : [];
  const pkgById = new Map(packages.map((p) => [p.id, p.name]));

  const topPackages = grouped.map((g) => ({
    packageId: g.packageId,
    name: pkgById.get(g.packageId) || g.packageId,
    totalCents: g._sum.amountCents || 0,
    count: g._count._all,
  }));

  const customRangeCents =
    rangeFrom || rangeTo
      ? await (async () => {
          const agg = await prisma.corePayment.aggregate({
            where: {
              ...baseWhere,
              status: { in: confirmedStatuses },
              paidAt: { ...(rangeFrom ? { gte: rangeFrom } : {}), ...(rangeTo ? { lte: rangeTo } : {}) },
            },
            _sum: { amountCents: true },
          });
          return agg._sum.amountCents || 0;
        })()
      : null;

  res.json({
    data: {
      totals: {
        todayCents,
        last7dCents,
        last30dCents,
        customRangeCents,
      },
      counts: {
        pending: pendingCount,
        overdue: overdueCount,
        confirmed: confirmedCount,
      },
      topPackages,
      updatedAt: now.toISOString(),
    },
  });
});

export const createCoreRenewPayment = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const input = coreRenewPaymentSchema.parse(req.body);

  const line = await prisma.coreLine.findFirst({
    where: { id: input.lineId, ...coreOwnerWhere(currentUser) },
    select: { id: true, ownerId: true, username: true, expiresAt: true, connections: true },
  });
  if (!line) throw new AppError(404, 'Linha não encontrada');

  const pkg = await prisma.corePackage.findFirst({
    where: { id: input.packageId, ownerId: line.ownerId, isActive: true },
    select: { id: true, name: true, durationDays: true, priceCents: true, connections: true },
  });
  if (!pkg) throw new AppError(404, 'Pacote não encontrado');

  const service = await getAsaasService(line.ownerId);
  if (!service) throw new AppError(400, 'Asaas não configurado para este usuário');

  const dueDate = toYmd(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000));
  const value = Math.max(0, pkg.priceCents) / 100;

  const corePayment = await prisma.corePayment.create({
    data: {
      ownerId: line.ownerId,
      lineId: line.id,
      packageId: pkg.id,
      daysToAdd: Math.max(1, pkg.durationDays),
      amountCents: Math.max(0, pkg.priceCents),
      kind: 'RENEW',
      status: 'PENDING',
      dueDate: ymdToDate(dueDate),
      customerName: input.customerName ?? null,
      customerPhone: input.customerPhone ?? null,
    },
  });

  const payment = await service.createPixPayment({
    value,
    dueDate,
    description: `Core - Renovação: ${line.username} (${pkg.name})`,
    externalReference: corePayment.id,
  });

  const qr = await service.getPixQrCode(payment.id);

  const updated = await prisma.corePayment.update({
    where: { id: corePayment.id },
    data: {
      asaasPaymentId: payment.id,
      invoiceUrl: payment.invoiceUrl || null,
      pixQrCode: qr.encodedImage || null,
      pixCopyPaste: qr.payload || null,
      status: payment.status || 'PENDING',
      dueDate: ymdToDate(payment.dueDate) ?? ymdToDate(dueDate),
    },
    select: {
      id: true,
      status: true,
      asaasPaymentId: true,
      invoiceUrl: true,
      pixQrCode: true,
      pixCopyPaste: true,
      amountCents: true,
      daysToAdd: true,
      createdAt: true,
      lineId: true,
      packageId: true,
    },
  });

  res.status(201).json({ data: updated, line: { id: line.id, username: line.username }, package: pkg });
});

export const createCoreSalePayment = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const input = coreSalePaymentSchema.parse(req.body);

  const pkg = await prisma.corePackage.findFirst({
    where: { id: input.packageId, ...coreOwnerWhere(currentUser), isActive: true },
    select: { id: true, name: true, durationDays: true, priceCents: true, connections: true },
  });
  if (!pkg) throw new AppError(404, 'Pacote não encontrado');

  const service = await getAsaasService(currentUser.userId);
  if (!service) throw new AppError(400, 'Asaas não configurado para este usuário');

  const username = `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toLowerCase();
  const password = Math.random().toString(36).slice(2, 12);

  const dueDate = toYmd(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000));
  const value = Math.max(0, pkg.priceCents) / 100;

  const corePayment = await prisma.corePayment.create({
    data: {
      ownerId: currentUser.userId,
      packageId: pkg.id,
      daysToAdd: Math.max(1, pkg.durationDays),
      amountCents: Math.max(0, pkg.priceCents),
      kind: 'NEW',
      status: 'PENDING',
      dueDate: ymdToDate(dueDate),
      customerName: input.customerName ?? null,
      customerPhone: input.customerPhone ?? null,
      newUsername: username,
      newPasswordEnc: encrypt(password),
    },
  });

  const payment = await service.createPixPayment({
    value,
    dueDate,
    description: `Core - Venda: ${pkg.name}`,
    externalReference: corePayment.id,
  });

  const qr = await service.getPixQrCode(payment.id);

  const updated = await prisma.corePayment.update({
    where: { id: corePayment.id },
    data: {
      asaasPaymentId: payment.id,
      invoiceUrl: payment.invoiceUrl || null,
      pixQrCode: qr.encodedImage || null,
      pixCopyPaste: qr.payload || null,
      status: payment.status || 'PENDING',
      dueDate: ymdToDate(payment.dueDate) ?? ymdToDate(dueDate),
    },
    select: {
      id: true,
      status: true,
      asaasPaymentId: true,
      invoiceUrl: true,
      pixQrCode: true,
      pixCopyPaste: true,
      amountCents: true,
      daysToAdd: true,
      createdAt: true,
      packageId: true,
      kind: true,
      newUsername: true,
    },
  });

  res.status(201).json({
    data: updated,
    checkoutToken: signCoreCheckoutToken(corePayment.id),
    credentials: { username, password },
    package: pkg,
  });
});

export const sendCorePaymentWhatsApp = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

  const payment = await prisma.corePayment.findFirst({
    where: { id, ...coreOwnerWhere(currentUser) },
    select: {
      id: true,
      ownerId: true,
      status: true,
      kind: true,
      amountCents: true,
      invoiceUrl: true,
      pixCopyPaste: true,
      dueDate: true,
      customerName: true,
      customerPhone: true,
      newUsername: true,
      package: { select: { name: true } },
      line: { select: { username: true } },
    },
  });
  if (!payment) throw new AppError(404, 'Pagamento não encontrado');
  if (!payment.customerPhone) throw new AppError(400, 'Informe o WhatsApp do cliente antes de enviar');

  const settings = await prisma.notificationSettings.findUnique({ where: { userId: payment.ownerId } });
  if (!settings?.whatsappEnabled || !settings.botbotAppKey || !settings.botbotAuthKey) {
    throw new AppError(400, 'WhatsApp (BotBot) não configurado');
  }

  const phone = normalizeBrPhone(payment.customerPhone);
  if (phone.length < 12) throw new AppError(400, 'WhatsApp do cliente inválido');

  const panel = await prisma.panelSettings.findUnique({
    where: { userId: payment.ownerId },
    select: { publicBaseUrl: true },
  });
  const ownerUser = await prisma.user.findUnique({ where: { id: payment.ownerId }, select: { username: true } });

  const base = stripApiSuffix(panel?.publicBaseUrl || '') || stripApiSuffix(env.API_URL || '');
  const checkoutUrl =
    base && ownerUser?.username
      ? `${base}/core/checkout/${encodeURIComponent(ownerUser.username)}?t=${encodeURIComponent(signCoreCheckoutToken(payment.id))}`
      : '';

  const isOverdue = (payment.status || '').toUpperCase() === 'OVERDUE';
  const msgTemplate = (isOverdue ? (settings as any)?.corePaymentOverdueTemplate : (settings as any)?.corePaymentReminderTemplate) as string | undefined;
  const username = payment.line?.username || payment.newUsername || '';
  const msg = msgTemplate
    ? processTemplate(msgTemplate, {
        username,
        password: '',
        name: payment.customerName || undefined,
        package: payment.package?.name || 'Core',
        plan_price: Math.max(0, payment.amountCents) / 100,
        expires_at: (payment.dueDate || new Date()).toISOString(),
        invoice_url: payment.invoiceUrl || '',
        checkout_url: checkoutUrl,
        pix_copy_paste: payment.pixCopyPaste || '',
        due_date: payment.dueDate ? payment.dueDate.toISOString() : '',
      })
    :
      `Olá${payment.customerName ? `, ${payment.customerName}` : ''}!\n\n` +
      `Segue o PIX para pagamento do seu acesso (${payment.package?.name || 'Core'}).\n` +
      `Valor: R$ ${(payment.amountCents / 100).toFixed(2).replace('.', ',')}\n\n` +
      (payment.pixCopyPaste ? `PIX copia e cola:\n${payment.pixCopyPaste}\n\n` : '') +
      (payment.invoiceUrl ? `Link do pagamento:\n${payment.invoiceUrl}\n\n` : '') +
      (checkoutUrl ? `Acompanhar status:\n${checkoutUrl}\n` : '');

  const result = await whatsappService.sendMessage(phone, msg, settings.botbotAppKey, settings.botbotAuthKey);

  await prisma.notificationLog.create({
    data: {
      userId: payment.ownerId,
      customerId: null,
      customerName: payment.customerName || null,
      phone: payment.customerPhone || null,
      email: null,
      telegramId: null,
      type: 'CORE_PAYMENT_LINK',
      channel: 'WHATSAPP',
      status: result.success ? 'SENT' : 'FAILED',
      message: msg,
      sentAt: result.success ? new Date() : null,
      error: result.success ? null : result.error || 'Falha ao enviar WhatsApp',
      relatedType: 'corePayment',
      relatedId: payment.id,
    },
  });

  if (!result.success) throw new AppError(400, result.error || 'Falha ao enviar WhatsApp');

  await prisma.actionLog.create({
    data: {
      userId: currentUser.userId,
      action: 'CORE_PAYMENT_SEND_WHATSAPP',
      entity: 'corePayment',
      entityId: id,
      details: JSON.stringify({ kind: payment.kind, status: payment.status }),
    },
  }).catch(() => {});

  res.json({ ok: true });
});

export const sendCorePaymentConfirmedWhatsApp = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

  const payment = await prisma.corePayment.findFirst({
    where: { id, ...coreOwnerWhere(currentUser) },
    select: {
      id: true,
      ownerId: true,
      status: true,
      kind: true,
      customerName: true,
      customerPhone: true,
      newUsername: true,
      newPasswordEnc: true,
      lineId: true,
      createdLineId: true,
      package: { select: { id: true, name: true, connections: true } },
    },
  });
  if (!payment) throw new AppError(404, 'Pagamento não encontrado');
  if (!payment.customerPhone) throw new AppError(400, 'Informe o WhatsApp do cliente antes de enviar');

  const st = (payment.status || '').toUpperCase();
  if (st !== 'CONFIRMED' && st !== 'RECEIVED') throw new AppError(400, 'Pagamento ainda não confirmado');

  const settings = await prisma.notificationSettings.findUnique({ where: { userId: payment.ownerId } });
  if (!settings?.whatsappEnabled || !settings.botbotAppKey || !settings.botbotAuthKey) {
    throw new AppError(400, 'WhatsApp (BotBot) não configurado');
  }

  const phone = normalizeBrPhone(payment.customerPhone);
  if (phone.length < 12) throw new AppError(400, 'WhatsApp do cliente inválido');

  const panel = await prisma.panelSettings.findUnique({
    where: { userId: payment.ownerId },
    select: { publicBaseUrl: true },
  });
  const base = stripApiSuffix(panel?.publicBaseUrl || '') || stripApiSuffix(env.API_URL || '');

  const kind = (payment.kind || '').toUpperCase();
  if (kind === 'NEW') {
    if (!payment.newUsername || !payment.newPasswordEnc) throw new AppError(400, 'Pagamento sem credenciais');

    const passwordPlain = decrypt(payment.newPasswordEnc);
    const line = await prisma.coreLine.findUnique({
      where: { id: payment.createdLineId || payment.lineId || '' },
      select: { expiresAt: true },
    });
    if (!line) throw new AppError(400, 'Linha ainda não foi criada');

    const m3u = base
      ? `${base}/get.php?username=${encodeURIComponent(payment.newUsername)}&password=${encodeURIComponent(passwordPlain)}&type=m3u_plus&output=ts`
      : '';
    const xmltv = base
      ? `${base}/xmltv.php?username=${encodeURIComponent(payment.newUsername)}&password=${encodeURIComponent(passwordPlain)}`
      : '';
    const xc = base
      ? `${base}/player_api.php?username=${encodeURIComponent(payment.newUsername)}&password=${encodeURIComponent(passwordPlain)}`
      : '';

    const defaultCoreWelcomeTemplate =
      `Olá {name}!\n\n` +
      `Seu acesso foi liberado:\n` +
      `Usuário: {username}\n` +
      `Senha: {password}\n` +
      `Vence em: {expires_at}\n\n` +
      `Links:\n` +
      `M3U: {m3u_url}\n` +
      `XMLTV: {xmltv_url}\n` +
      `XC API: {xc_api_url}`;

    const msg = processTemplate(settings.coreWelcomeTemplate || defaultCoreWelcomeTemplate, {
      username: payment.newUsername,
      password: passwordPlain,
      name: payment.customerName || undefined,
      package: payment.package?.name || 'Core',
      plan_price: 0,
      expires_at: line.expiresAt.toISOString(),
      m3u_url: m3u,
      xmltv_url: xmltv,
      xc_api_url: xc,
      connections: payment.package?.connections ?? 1,
    });

    const result = await whatsappService.sendMessage(phone, msg, settings.botbotAppKey, settings.botbotAuthKey);

    await prisma.notificationLog.create({
      data: {
        userId: payment.ownerId,
        customerId: null,
        customerName: payment.customerName || null,
        phone: payment.customerPhone || null,
        email: null,
        telegramId: null,
        type: 'CORE_WELCOME',
        channel: 'WHATSAPP',
        status: result.success ? 'SENT' : 'FAILED',
        message: msg,
        sentAt: result.success ? new Date() : null,
        error: result.success ? null : result.error || 'Falha ao enviar WhatsApp',
        relatedType: 'corePayment',
        relatedId: payment.id,
      },
    });

    if (!result.success) throw new AppError(400, result.error || 'Falha ao enviar WhatsApp');
    await prisma.actionLog.create({
      data: {
        userId: currentUser.userId,
        action: 'CORE_PAYMENT_SEND_CONFIRMED_WHATSAPP',
        entity: 'corePayment',
        entityId: id,
        details: JSON.stringify({ kind: payment.kind, status: payment.status }),
      },
    }).catch(() => {});
    res.json({ ok: true });
    return;
  }

  const line = await prisma.coreLine.findUnique({
    where: { id: payment.lineId || '' },
    select: { username: true, expiresAt: true },
  });
  if (!line) throw new AppError(400, 'Linha não encontrada para renovação');

  const defaultCoreRenewalTemplate =
    `✅ Renovação confirmada!\n\n` +
    `Usuário: {username}\n` +
    `Novo vencimento: {expires_at}`;
  const msg = processTemplate(settings.coreRenewalTemplate || defaultCoreRenewalTemplate, {
    username: line.username,
    password: '',
    name: payment.customerName || undefined,
    package: payment.package?.name || 'Core',
    plan_price: 0,
    expires_at: line.expiresAt.toISOString(),
    m3u_url: '',
    xmltv_url: '',
    xc_api_url: '',
    connections: payment.package?.connections ?? 1,
  });

  const result = await whatsappService.sendMessage(phone, msg, settings.botbotAppKey, settings.botbotAuthKey);

  await prisma.notificationLog.create({
    data: {
      userId: payment.ownerId,
      customerId: null,
      customerName: payment.customerName || null,
      phone: payment.customerPhone || null,
      email: null,
      telegramId: null,
      type: 'CORE_RENEWAL_CONFIRMED',
      channel: 'WHATSAPP',
      status: result.success ? 'SENT' : 'FAILED',
      message: msg,
      sentAt: result.success ? new Date() : null,
      error: result.success ? null : result.error || 'Falha ao enviar WhatsApp',
      relatedType: 'corePayment',
      relatedId: payment.id,
    },
  });

  if (!result.success) throw new AppError(400, result.error || 'Falha ao enviar WhatsApp');
  await prisma.actionLog.create({
    data: {
      userId: currentUser.userId,
      action: 'CORE_PAYMENT_SEND_CONFIRMED_WHATSAPP',
      entity: 'corePayment',
      entityId: id,
      details: JSON.stringify({ kind: payment.kind, status: payment.status }),
    },
  }).catch(() => {});
  res.json({ ok: true });
});

export const recreateCorePaymentPix = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

  const payment = await prisma.corePayment.findFirst({
    where: { id, ...coreOwnerWhere(currentUser) },
    select: {
      id: true,
      ownerId: true,
      lineId: true,
      packageId: true,
      kind: true,
      status: true,
      amountCents: true,
      daysToAdd: true,
      customerName: true,
      customerPhone: true,
      asaasPaymentId: true,
      package: { select: { name: true } },
      line: { select: { username: true } },
    },
  });
  if (!payment) throw new AppError(404, 'Pagamento não encontrado');
  if (payment.status === 'CONFIRMED') throw new AppError(400, 'Pagamento já confirmado');

  const service = await getAsaasService(payment.ownerId);
  if (!service) throw new AppError(400, 'Asaas não configurado para este usuário');

  const oldAsaasId = payment.asaasPaymentId;
  const dueDate = toYmd(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000));
  const value = Math.max(0, payment.amountCents) / 100;

  const descBase = payment.kind === 'NEW' ? 'Core - Venda' : 'Core - Renovação';
  const descLine = payment.line?.username ? `: ${payment.line.username}` : '';
  const descPkg = payment.package?.name ? ` (${payment.package.name})` : '';
  const description = `${descBase}${descLine}${descPkg}`;

  const remote = await service.createPixPayment({
    value,
    dueDate,
    description,
    externalReference: payment.id,
  });
  const qr = await service.getPixQrCode(remote.id);

  await prisma.corePayment.update({
    where: { id: payment.id },
    data: {
      asaasPaymentId: remote.id,
      invoiceUrl: remote.invoiceUrl || null,
      pixQrCode: qr.encodedImage || null,
      pixCopyPaste: qr.payload || null,
      status: remote.status || 'PENDING',
      dueDate: ymdToDate(remote.dueDate) ?? ymdToDate(dueDate),
      reminderCount: 0,
      lastReminderAt: null,
      overdueNotifiedAt: null,
    },
  });

  if (oldAsaasId && oldAsaasId !== remote.id) {
    try {
      await service.cancelPayment(oldAsaasId);
    } catch {
    }
  }

  const updated = await prisma.corePayment.findUnique({
    where: { id: payment.id },
    select: {
      id: true,
      ownerId: true,
      lineId: true,
      packageId: true,
      daysToAdd: true,
      amountCents: true,
      kind: true,
      status: true,
      asaasPaymentId: true,
      invoiceUrl: true,
      pixQrCode: true,
      pixCopyPaste: true,
      dueDate: true,
      customerName: true,
      customerPhone: true,
      createdLineId: true,
      newUsername: true,
      paidAt: true,
      createdAt: true,
      updatedAt: true,
      owner: { select: { username: true, panelSettings: { select: { publicBaseUrl: true } } } },
      line: { select: { username: true } },
      package: { select: { name: true } },
    },
  });
  if (!updated) throw new AppError(404, 'Pagamento não encontrado');

  await prisma.actionLog.create({
    data: {
      userId: currentUser.userId,
      action: 'CORE_PAYMENT_RECREATE_PIX',
      entity: 'corePayment',
      entityId: id,
      details: JSON.stringify({ oldAsaasId, newAsaasId: updated.asaasPaymentId }),
    },
  }).catch(() => {});

  res.json({
    data: {
      ...updated,
      checkoutToken: signCoreCheckoutToken(updated.id),
    },
  });
});

export const listVod = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;

  const vodItems = await prisma.coreVodItem.findMany({
    where: coreOwnerWhere(currentUser),
    orderBy: [{ createdAt: 'desc' }],
  });

  const links = await prisma.coreBouquetVodItem.findMany({
    where: { bouquet: coreOwnerWhere(currentUser) },
    select: { vodItemId: true, bouquetId: true },
  });

  const byVod: Record<string, string[]> = {};
  for (const l of links) {
    if (!byVod[l.vodItemId]) byVod[l.vodItemId] = [];
    byVod[l.vodItemId].push(l.bouquetId);
  }

  res.json({
    data: vodItems.map(v => ({
      ...v,
      bouquetIds: byVod[v.id] || [],
    })),
  });
});

export const createVod = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const data = vodSchema.parse(req.body);

  if (data.bouquetIds?.length) {
    const ownedCount = await prisma.coreBouquet.count({
      where: { id: { in: data.bouquetIds }, ...coreOwnerWhere(currentUser) },
    });
    if (ownedCount !== data.bouquetIds.length) throw new AppError(403, 'Um ou mais bouquets não pertencem ao usuário');
  }

  const vod = await prisma.coreVodItem.create({
    data: {
      ownerId: currentUser.userId,
      name: data.name,
      streamUrl: data.streamUrl,
      posterUrl: data.posterUrl ?? null,
      isActive: data.isActive ?? true,
    },
  });

  if (data.bouquetIds?.length) {
    await prisma.coreBouquetVodItem.createMany({
      data: data.bouquetIds.map(bouquetId => ({ bouquetId, vodItemId: vod.id })),
      skipDuplicates: true,
    });
  }

  res.status(201).json({ data: vod });
});

export const updateVod = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { id } = req.params;
  const data = vodSchema.partial().parse(req.body);

  const existing = await prisma.coreVodItem.findFirst({ where: { id, ...coreOwnerWhere(currentUser) } });
  if (!existing) throw new AppError(404, 'VOD não encontrado');

  if (data.bouquetIds) {
    const ownedCount = await prisma.coreBouquet.count({
      where: { id: { in: data.bouquetIds }, ...coreOwnerWhere(currentUser) },
    });
    if (ownedCount !== data.bouquetIds.length) throw new AppError(403, 'Um ou mais bouquets não pertencem ao usuário');
  }

  const updated = await prisma.coreVodItem.update({
    where: { id },
    data: {
      name: data.name ?? undefined,
      streamUrl: data.streamUrl ?? undefined,
      posterUrl: data.posterUrl === undefined ? undefined : (data.posterUrl ?? null),
      isActive: data.isActive ?? undefined,
    },
  });

  if (data.bouquetIds) {
    const allOwnedBouquets = await prisma.coreBouquet.findMany({
      where: coreOwnerWhere(currentUser),
      select: { id: true },
    });
    await syncVodItemBouquets(id, allOwnedBouquets.map(b => b.id), data.bouquetIds);
  }

  res.json({ data: updated });
});

export const removeVod = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { id } = req.params;

  const existing = await prisma.coreVodItem.findFirst({ where: { id, ...coreOwnerWhere(currentUser) } });
  if (!existing) throw new AppError(404, 'VOD não encontrado');

  await prisma.coreBouquetVodItem.deleteMany({ where: { vodItemId: id } });
  await prisma.coreVodItem.delete({ where: { id } });

  res.json({ ok: true });
});

export const listSeries = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;

  const series = await prisma.coreSeries.findMany({
    where: coreOwnerWhere(currentUser),
    include: { _count: { select: { episodes: true } } },
    orderBy: [{ createdAt: 'desc' }],
  });

  const links = await prisma.coreBouquetSeries.findMany({
    where: { bouquet: coreOwnerWhere(currentUser) },
    select: { seriesId: true, bouquetId: true },
  });

  const bySeries: Record<string, string[]> = {};
  for (const l of links) {
    if (!bySeries[l.seriesId]) bySeries[l.seriesId] = [];
    bySeries[l.seriesId].push(l.bouquetId);
  }

  res.json({
    data: series.map(s => ({
      ...s,
      bouquetIds: bySeries[s.id] || [],
    })),
  });
});

export const createSeries = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const data = seriesSchema.parse(req.body);

  if (data.bouquetIds?.length) {
    const ownedCount = await prisma.coreBouquet.count({
      where: { id: { in: data.bouquetIds }, ...coreOwnerWhere(currentUser) },
    });
    if (ownedCount !== data.bouquetIds.length) throw new AppError(403, 'Um ou mais bouquets não pertencem ao usuário');
  }

  const s = await prisma.coreSeries.create({
    data: {
      ownerId: currentUser.userId,
      name: data.name,
      coverUrl: data.coverUrl ?? null,
      isActive: data.isActive ?? true,
    },
  });

  if (data.bouquetIds?.length) {
    await prisma.coreBouquetSeries.createMany({
      data: data.bouquetIds.map(bouquetId => ({ bouquetId, seriesId: s.id })),
      skipDuplicates: true,
    });
  }

  res.status(201).json({ data: s });
});

export const updateSeries = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { id } = req.params;
  const data = seriesSchema.partial().parse(req.body);

  const existing = await prisma.coreSeries.findFirst({ where: { id, ...coreOwnerWhere(currentUser) } });
  if (!existing) throw new AppError(404, 'Série não encontrada');

  if (data.bouquetIds) {
    const ownedCount = await prisma.coreBouquet.count({
      where: { id: { in: data.bouquetIds }, ...coreOwnerWhere(currentUser) },
    });
    if (ownedCount !== data.bouquetIds.length) throw new AppError(403, 'Um ou mais bouquets não pertencem ao usuário');
  }

  const updated = await prisma.coreSeries.update({
    where: { id },
    data: {
      name: data.name ?? undefined,
      coverUrl: data.coverUrl === undefined ? undefined : (data.coverUrl ?? null),
      isActive: data.isActive ?? undefined,
    },
  });

  if (data.bouquetIds) {
    const allOwnedBouquets = await prisma.coreBouquet.findMany({
      where: coreOwnerWhere(currentUser),
      select: { id: true },
    });
    await syncSeriesBouquets(id, allOwnedBouquets.map(b => b.id), data.bouquetIds);
  }

  res.json({ data: updated });
});

export const removeSeries = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { id } = req.params;

  const existing = await prisma.coreSeries.findFirst({ where: { id, ...coreOwnerWhere(currentUser) } });
  if (!existing) throw new AppError(404, 'Série não encontrada');

  await prisma.coreBouquetSeries.deleteMany({ where: { seriesId: id } });
  await prisma.coreSeries.delete({ where: { id } });
  res.json({ ok: true });
});

export const listSeriesEpisodes = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { seriesId } = req.params;

  const series = await prisma.coreSeries.findFirst({ where: { id: seriesId, ...coreOwnerWhere(currentUser) } });
  if (!series) throw new AppError(404, 'Série não encontrada');

  const episodes = await prisma.coreSeriesEpisode.findMany({
    where: { seriesId },
    orderBy: [{ season: 'asc' }, { episode: 'asc' }],
  });

  res.json({ data: episodes });
});

export const createSeriesEpisode = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { seriesId } = req.params;
  const data = seriesEpisodeSchema.parse(req.body);

  const series = await prisma.coreSeries.findFirst({ where: { id: seriesId, ...coreOwnerWhere(currentUser) } });
  if (!series) throw new AppError(404, 'Série não encontrada');

  const ep = await prisma.coreSeriesEpisode.create({
    data: {
      seriesId,
      season: data.season ?? 1,
      episode: data.episode ?? 1,
      title: data.title,
      streamUrl: data.streamUrl,
      isActive: data.isActive ?? true,
    },
  });

  res.status(201).json({ data: ep });
});

export const updateSeriesEpisode = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { seriesId, episodeId } = req.params;
  const data = seriesEpisodeSchema.partial().parse(req.body);

  const series = await prisma.coreSeries.findFirst({ where: { id: seriesId, ...coreOwnerWhere(currentUser) } });
  if (!series) throw new AppError(404, 'Série não encontrada');

  const existing = await prisma.coreSeriesEpisode.findFirst({ where: { id: episodeId, seriesId } });
  if (!existing) throw new AppError(404, 'Episódio não encontrado');

  const updated = await prisma.coreSeriesEpisode.update({
    where: { id: episodeId },
    data: {
      season: data.season ?? undefined,
      episode: data.episode ?? undefined,
      title: data.title ?? undefined,
      streamUrl: data.streamUrl ?? undefined,
      isActive: data.isActive ?? undefined,
    },
  });

  res.json({ data: updated });
});

export const removeSeriesEpisode = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { seriesId, episodeId } = req.params;

  const series = await prisma.coreSeries.findFirst({ where: { id: seriesId, ...coreOwnerWhere(currentUser) } });
  if (!series) throw new AppError(404, 'Série não encontrada');

  const existing = await prisma.coreSeriesEpisode.findFirst({ where: { id: episodeId, seriesId } });
  if (!existing) throw new AppError(404, 'Episódio não encontrado');

  await prisma.coreSeriesEpisode.delete({ where: { id: episodeId } });
  res.json({ ok: true });
});

export const importM3U = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const input = importM3USchema.parse(req.body);
  const result = await runCoreM3UImport(currentUser.userId, input);
  res.json(result);
});

const coreM3UScheduleTasks = new Map<string, cron.ScheduledTask>();
const coreM3UScheduleRunning = new Map<string, boolean>();

export async function initializeCoreM3USchedules(): Promise<void> {
  try {
    const activeSchedules = await prisma.coreM3USchedule.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    for (const s of activeSchedules) {
      try {
        await scheduleCoreM3U(s.id);
      } catch (error: any) {
        logger.error(`[CoreM3U] Erro ao agendar ${s.id}: ${error?.message || error}`);
      }
    }
  } catch (error: any) {
    logger.error(`[CoreM3U] Erro ao inicializar agendamentos: ${error?.message || error}`);
  }
}

export function stopAllCoreM3USchedules(): void {
  for (const [, task] of coreM3UScheduleTasks) {
    task.stop();
  }
  coreM3UScheduleTasks.clear();
  coreM3UScheduleRunning.clear();
}

export async function scheduleCoreM3U(scheduleId: string): Promise<void> {
  const schedule = await prisma.coreM3USchedule.findUnique({ where: { id: scheduleId } });
  if (!schedule) throw new Error('Agendamento não encontrado');
  if (!schedule.isActive) return;

  if (!cron.validate(schedule.cronExpression)) {
    throw new Error(`Expressão cron inválida: ${schedule.cronExpression}`);
  }

  unscheduleCoreM3U(scheduleId);

  const task = cron.schedule(
    schedule.cronExpression,
    async () => {
      await executeCoreM3USchedule(scheduleId, 'cron');
    },
    { scheduled: true, timezone: 'America/Sao_Paulo' }
  );

  coreM3UScheduleTasks.set(scheduleId, task);
}

export function unscheduleCoreM3U(scheduleId: string): void {
  const existing = coreM3UScheduleTasks.get(scheduleId);
  if (!existing) return;
  existing.stop();
  coreM3UScheduleTasks.delete(scheduleId);
}

async function executeCoreM3USchedule(scheduleId: string, trigger: 'cron' | 'manual') {
  if (coreM3UScheduleRunning.get(scheduleId)) return null;
  coreM3UScheduleRunning.set(scheduleId, true);

  const startedAt = new Date();
  try {
    const schedule = await prisma.coreM3USchedule.findUnique({ where: { id: scheduleId } });
    if (!schedule || !schedule.isActive) return null;

    await prisma.coreM3USchedule.update({
      where: { id: scheduleId },
      data: { lastRunAt: startedAt, lastStatus: 'running', lastMessage: `Executando (${trigger})` },
    });

    const result = await runCoreM3UImport(schedule.ownerId, {
      url: schedule.m3uUrl,
      mode: (schedule.mode as any) || 'replace',
      type: (schedule.type as any) || 'all',
      createPackage: schedule.createPackage,
      packageName: schedule.packageName,
      createLine: false,
      lineExpiresDays: 30,
    });

    const imported = (result as any)?.imported;
    const summary = imported
      ? `OK: bouquets ${imported.bouquetsCreated}, live ${imported.streamsCreated}, vod ${imported.vodCreated}, séries ${imported.seriesCreated}, eps ${imported.episodesCreated}, skip ${imported.skipped}`
      : 'OK';

    await prisma.coreM3USchedule.update({
      where: { id: scheduleId },
      data: { lastStatus: 'success', lastMessage: summary },
    });

    return result;
  } catch (error: any) {
    await prisma.coreM3USchedule
      .update({
        where: { id: scheduleId },
        data: { lastRunAt: startedAt, lastStatus: 'error', lastMessage: error?.message || String(error) },
      })
      .catch(() => {});
    logger.error(`[CoreM3U] Erro execução schedule ${scheduleId}: ${error?.message || error}`);
    return null;
  } finally {
    coreM3UScheduleRunning.set(scheduleId, false);
  }
}

export const listM3USchedules = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const data = await prisma.coreM3USchedule.findMany({
    where: coreOwnerWhere(currentUser),
    orderBy: [{ createdAt: 'desc' }],
  });
  res.json({ data });
});

export const createM3USchedule = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const input = m3uScheduleSchema.parse(req.body);

  if (!cron.validate(input.cronExpression)) {
    throw new AppError(400, `Expressão cron inválida: ${input.cronExpression}`);
  }

  const schedule = await prisma.coreM3USchedule.create({
    data: {
      ownerId: currentUser.userId,
      name: input.name,
      m3uUrl: input.m3uUrl,
      cronExpression: input.cronExpression,
      type: input.type || 'all',
      mode: input.mode || 'replace',
      createPackage: input.createPackage ?? true,
      packageName: (input.packageName || 'PACOTE PADRÃO').trim(),
      isActive: input.isActive ?? true,
    },
  });

  if (schedule.isActive) {
    await scheduleCoreM3U(schedule.id).catch(() => {});
  }

  res.status(201).json({ data: schedule });
});

export const updateM3USchedule = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { id } = req.params;
  const input = m3uScheduleSchema.partial().parse(req.body);

  const existing = await prisma.coreM3USchedule.findFirst({
    where: { id, ...coreOwnerWhere(currentUser) },
  });
  if (!existing) throw new AppError(404, 'Agendamento não encontrado');

  if (input.cronExpression && !cron.validate(input.cronExpression)) {
    throw new AppError(400, `Expressão cron inválida: ${input.cronExpression}`);
  }

  const updated = await prisma.coreM3USchedule.update({
    where: { id },
    data: {
      name: input.name ?? undefined,
      m3uUrl: input.m3uUrl ?? undefined,
      cronExpression: input.cronExpression ?? undefined,
      type: input.type ?? undefined,
      mode: input.mode ?? undefined,
      createPackage: input.createPackage ?? undefined,
      packageName: input.packageName === undefined ? undefined : (input.packageName || 'PACOTE PADRÃO').trim(),
      isActive: input.isActive ?? undefined,
    },
  });

  if (updated.isActive) {
    await scheduleCoreM3U(updated.id).catch(() => {});
  } else {
    unscheduleCoreM3U(updated.id);
  }

  res.json({ data: updated });
});

export const deleteM3USchedule = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { id } = req.params;

  const existing = await prisma.coreM3USchedule.findFirst({
    where: { id, ...coreOwnerWhere(currentUser) },
  });
  if (!existing) throw new AppError(404, 'Agendamento não encontrado');

  unscheduleCoreM3U(id);
  await prisma.coreM3USchedule.delete({ where: { id } });
  res.json({ ok: true });
});

export const runM3USchedule = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { id } = req.params;

  const existing = await prisma.coreM3USchedule.findFirst({
    where: { id, ...coreOwnerWhere(currentUser) },
  });
  if (!existing) throw new AppError(404, 'Agendamento não encontrado');

  const result = await executeCoreM3USchedule(id, 'manual');
  res.json({ ok: true, result });
});

export const listPlaybackSessions = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const lineId = typeof req.query.lineId === 'string' ? req.query.lineId : undefined;
  const activeOnly = req.query.activeOnly === 'true' || req.query.activeOnly === true;
  const contentType = typeof req.query.contentType === 'string' ? req.query.contentType : undefined;

  if (lineId) {
    const line = await prisma.coreLine.findFirst({
      where: { id: lineId, ...coreOwnerWhere(currentUser) },
      select: { id: true },
    });
    if (!line) throw new AppError(404, 'Linha não encontrada');
  }

  const sessions = await prisma.corePlaybackSession.findMany({
    where: {
      ...(activeOnly ? { endedAt: null, status: 'active' } : {}),
      ...(lineId ? { lineId } : {}),
      ...(contentType ? { contentType } : {}),
      line: coreOwnerWhere(currentUser),
    },
    select: {
      id: true,
      lineId: true,
      contentType: true,
      contentPublicId: true,
      serverHost: true,
      ipAddress: true,
      userAgent: true,
      startedAt: true,
      lastSeenAt: true,
      endedAt: true,
      status: true,
      bytesSent: true,
      line: { select: { username: true } },
    },
    orderBy: [{ startedAt: 'desc' }],
    take: 500,
  });

  const livePublicIds = sessions
    .filter((s) => s.contentType === 'live' && typeof s.contentPublicId === 'number')
    .map((s) => s.contentPublicId as number);
  const uniqueLivePublicIds = Array.from(new Set(livePublicIds));

  const liveStreams = uniqueLivePublicIds.length
    ? await prisma.coreStream.findMany({
        where: { publicId: { in: uniqueLivePublicIds } },
        select: { publicId: true, name: true },
      })
    : [];
  const liveNameByPublicId = new Map(liveStreams.map((s) => [s.publicId, s.name] as const));

  res.json({
    data: sessions.map((s) => ({
      ...s,
      bytesSent: s.bytesSent.toString(),
      contentName: s.contentType === 'live' && typeof s.contentPublicId === 'number' ? liveNameByPublicId.get(s.contentPublicId) || null : null,
    })),
  });
});

export const terminatePlaybackSession = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { id } = req.params;

  const session = await prisma.corePlaybackSession.findFirst({
    where: { id, line: coreOwnerWhere(currentUser) },
    select: { id: true, endedAt: true, status: true },
  });
  if (!session) throw new AppError(404, 'Sessão não encontrada');

  const updated = await prisma.corePlaybackSession.update({
    where: { id },
    data: {
      endedAt: new Date(),
      status: 'killed',
      lastSeenAt: new Date(),
    },
    select: { id: true, status: true, endedAt: true },
  });

  res.json({ ok: true, data: updated });
});

export const terminateLinePlaybackSessions = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { lineId } = z.object({ lineId: z.string().uuid() }).parse(req.params);

  const line = await prisma.coreLine.findFirst({
    where: { id: lineId, ...coreOwnerWhere(currentUser) },
    select: { id: true, username: true },
  });
  if (!line) throw new AppError(404, 'Linha não encontrada');

  const now = new Date();
  const result = await prisma.corePlaybackSession.updateMany({
    where: { lineId: line.id, endedAt: null, status: 'active' },
    data: { endedAt: now, status: 'killed', lastSeenAt: now },
  });

  await prisma.actionLog
    .create({
      data: {
        userId: currentUser.userId,
        action: 'CORE_LINE_TERMINATE_SESSIONS',
        entity: 'coreLine',
        entityId: line.id,
        details: JSON.stringify({ username: line.username, count: result.count }),
      },
    })
    .catch(() => {});

  res.json({ ok: true, data: { lineId: line.id, count: result.count } });
});

const coreEpgTasks = new Map<string, cron.ScheduledTask>();
const coreEpgRunning = new Map<string, boolean>();

function decodeXmlEntities(input: string) {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = parseInt(n, 10);
      if (!Number.isFinite(code)) return '';
      return String.fromCharCode(code);
    });
}

function stripXmlTags(input: string) {
  return decodeXmlEntities(input.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
}

function parseXmltvDate(raw: string): Date | null {
  const s = (raw || '').trim();
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const mon = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  const hour = parseInt(m[4], 10);
  const min = parseInt(m[5], 10);
  const sec = parseInt(m[6], 10);
  const msUtc = Date.UTC(year, mon - 1, day, hour, min, sec);
  if (!Number.isFinite(msUtc)) return null;
  if (!m[7]) return new Date(msUtc);
  const sign = m[7] === '-' ? -1 : 1;
  const offH = parseInt(m[8], 10);
  const offM = parseInt(m[9], 10);
  const offsetMin = sign * (offH * 60 + offM);
  return new Date(msUtc - offsetMin * 60_000);
}

function formatXmltvDate(date: Date) {
  const d = new Date(date.getTime());
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}${hh}${mi}${ss} +0000`;
}

function escapeXml(input: string) {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parseXmltv(xml: string) {
  const channels: Array<{ channelId: string; displayName: string }> = [];
  const programmes: Array<{ channelId: string; startAt: Date; endAt: Date; title: string; description: string | null }> = [];

  const channelRe = /<channel\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/channel>/gi;
  for (let m; (m = channelRe.exec(xml)); ) {
    const channelId = (m[1] || '').trim();
    const body = m[2] || '';
    const dnMatch = body.match(/<display-name\b[^>]*>([\s\S]*?)<\/display-name>/i);
    const displayName = stripXmlTags(dnMatch?.[1] || channelId);
    if (channelId) channels.push({ channelId, displayName: displayName || channelId });
  }

  const progRe = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi;
  for (let m; (m = progRe.exec(xml)); ) {
    const attrs = m[1] || '';
    const body = m[2] || '';
    const startMatch = attrs.match(/\bstart="([^"]+)"/i);
    const stopMatch = attrs.match(/\bstop="([^"]+)"/i);
    const chMatch = attrs.match(/\bchannel="([^"]+)"/i);
    const channelId = (chMatch?.[1] || '').trim();
    const startAt = parseXmltvDate(startMatch?.[1] || '');
    const endAt = parseXmltvDate(stopMatch?.[1] || '');
    if (!channelId || !startAt || !endAt) continue;

    const titleMatch = body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const descMatch = body.match(/<desc\b[^>]*>([\s\S]*?)<\/desc>/i);
    const title = stripXmlTags(titleMatch?.[1] || '');
    const description = descMatch ? stripXmlTags(descMatch[1]) : null;
    if (!title) continue;
    programmes.push({ channelId, startAt, endAt, title, description });
  }

  return { channels, programmes };
}

async function fetchXmltv(url: string, timeoutMs: number) {
  const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: timeoutMs, validateStatus: () => true });
  if (resp.status >= 400) {
    throw new AppError(502, `Falha ao baixar XMLTV (${resp.status})`);
  }
  let buf = Buffer.from(resp.data);
  const enc = String(resp.headers?.['content-encoding'] || '').toLowerCase();
  const isGz = enc.includes('gzip') || url.toLowerCase().endsWith('.gz') || (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b);
  if (isGz) buf = zlib.gunzipSync(buf);
  return buf.toString('utf8');
}

async function runCoreEpgImport(sourceId: string) {
  const source = await prisma.coreEpgSource.findUnique({ where: { id: sourceId } });
  if (!source) throw new AppError(404, 'Fonte EPG não encontrada');

  const startedAt = new Date();
  await prisma.coreEpgSource.update({
    where: { id: sourceId },
    data: { lastRunAt: startedAt, lastStatus: 'running', lastMessage: 'Baixando XMLTV...' },
  });

  const xml = await fetchXmltv(source.xmltvUrl, 180000);
  const parsed = parseXmltv(xml);

  const now = new Date();
  const windowStart = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + Math.max(1, source.daysAhead) * 24 * 60 * 60 * 1000);

  const programmes = parsed.programmes.filter(p => p.startAt < windowEnd && p.endAt > windowStart);

  const uniqueChannels = new Map<string, string>();
  for (const c of parsed.channels) {
    if (!uniqueChannels.has(c.channelId)) uniqueChannels.set(c.channelId, c.displayName);
  }
  for (const p of programmes) {
    if (!uniqueChannels.has(p.channelId)) uniqueChannels.set(p.channelId, p.channelId);
  }

  await prisma.$transaction(async (tx) => {
    const channelEntries = Array.from(uniqueChannels.entries());
    for (const [channelId, displayName] of channelEntries) {
      await tx.coreEpgChannel.upsert({
        where: { ownerId_channelId: { ownerId: source.ownerId, channelId } },
        update: { displayName },
        create: { ownerId: source.ownerId, channelId, displayName },
      });
    }

    await tx.coreEpgProgram.deleteMany({
      where: { sourceId, startAt: { gte: windowStart, lt: windowEnd } },
    });

    const rows = programmes.map((p) => ({
      ownerId: source.ownerId,
      sourceId,
      channelId: p.channelId,
      startAt: p.startAt,
      endAt: p.endAt,
      title: p.title,
      description: p.description,
    }));

    const batchSize = 1000;
    for (let i = 0; i < rows.length; i += batchSize) {
      await tx.coreEpgProgram.createMany({ data: rows.slice(i, i + batchSize) });
    }
  });

  const msg = `OK: canais ${uniqueChannels.size}, programas ${programmes.length}`;
  await prisma.coreEpgSource.update({
    where: { id: sourceId },
    data: { lastStatus: 'success', lastMessage: msg },
  });

  return { ok: true, channels: uniqueChannels.size, programmes: programmes.length, windowStart, windowEnd };
}

export async function initializeCoreEpgSchedules(): Promise<void> {
  try {
    const actives = await prisma.coreEpgSource.findMany({ where: { isActive: true }, select: { id: true } });
    for (const s of actives) {
      try {
        await scheduleCoreEpgSource(s.id);
      } catch (error: any) {
        logger.error(`[CoreEPG] Erro ao agendar ${s.id}: ${error?.message || error}`);
      }
    }
  } catch (error: any) {
    logger.error(`[CoreEPG] Erro ao inicializar: ${error?.message || error}`);
  }
}

export function stopAllCoreEpgSchedules(): void {
  for (const [, t] of coreEpgTasks) t.stop();
  coreEpgTasks.clear();
  coreEpgRunning.clear();
}

export async function scheduleCoreEpgSource(sourceId: string): Promise<void> {
  const src = await prisma.coreEpgSource.findUnique({ where: { id: sourceId } });
  if (!src) throw new Error('Fonte EPG não encontrada');
  if (!src.isActive) return;
  if (!cron.validate(src.cronExpression)) throw new Error(`Expressão cron inválida: ${src.cronExpression}`);

  unscheduleCoreEpgSource(sourceId);
  const task = cron.schedule(
    src.cronExpression,
    async () => {
      await executeCoreEpgSource(sourceId, 'cron');
    },
    { scheduled: true, timezone: 'America/Sao_Paulo' }
  );
  coreEpgTasks.set(sourceId, task);
}

export function unscheduleCoreEpgSource(sourceId: string): void {
  const existing = coreEpgTasks.get(sourceId);
  if (!existing) return;
  existing.stop();
  coreEpgTasks.delete(sourceId);
}

async function executeCoreEpgSource(sourceId: string, trigger: 'cron' | 'manual') {
  if (coreEpgRunning.get(sourceId)) return null;
  coreEpgRunning.set(sourceId, true);
  try {
    await prisma.coreEpgSource.update({
      where: { id: sourceId },
      data: { lastStatus: 'running', lastMessage: `Executando (${trigger})` },
    }).catch(() => {});
    return await runCoreEpgImport(sourceId);
  } catch (error: any) {
    await prisma.coreEpgSource.update({
      where: { id: sourceId },
      data: { lastStatus: 'error', lastMessage: error?.message || String(error), lastRunAt: new Date() },
    }).catch(() => {});
    return null;
  } finally {
    coreEpgRunning.set(sourceId, false);
  }
}

export const listEpgSources = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const data = await prisma.coreEpgSource.findMany({
    where: coreOwnerWhere(currentUser),
    orderBy: [{ createdAt: 'desc' }],
  });
  res.json({ data });
});

export const listEpgChannels = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  const data = await prisma.coreEpgChannel.findMany({
    where: {
      ...coreOwnerWhere(currentUser),
      ...(q
        ? {
            OR: [
              { channelId: { contains: q, mode: 'insensitive' } },
              { displayName: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: [{ displayName: 'asc' }],
    take: 2000,
    select: { id: true, channelId: true, displayName: true, createdAt: true, updatedAt: true },
  });

  res.json({ data });
});

const epgAutoMapSchema = z.object({
  mode: z.enum(['only-empty', 'overwrite']).optional(),
  dryRun: z.union([z.boolean(), z.string()]).transform(v => v === true || v === 'true').optional(),
  minScore: z.union([z.number(), z.string()]).transform(v => (typeof v === 'number' ? v : parseFloat(v))).optional(),
});

function normalizeEpgName(raw: string) {
  const s = (raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\b(hd|fhd|uhd|4k|sd|tv|channel)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

function tokenSet(s: string) {
  return new Set(normalizeEpgName(s).split(' ').filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

export const autoMapEpgToStreams = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const input = epgAutoMapSchema.parse(req.body || {});
  const mode = input.mode || 'only-empty';
  const dryRun = input.dryRun ?? false;
  const minScore = Number.isFinite(input.minScore as any) ? Math.min(1, Math.max(0, input.minScore as number)) : 0.72;

  const [streams, channels] = await Promise.all([
    prisma.coreStream.findMany({
      where: {
        ...coreOwnerWhere(currentUser),
        ...(mode === 'only-empty' ? { OR: [{ epgChannelId: null }, { epgChannelId: '' }] } : {}),
      },
      select: { id: true, name: true, epgChannelId: true },
      orderBy: [{ createdAt: 'desc' }],
      take: 5000,
    }),
    prisma.coreEpgChannel.findMany({
      where: coreOwnerWhere(currentUser),
      select: { channelId: true, displayName: true },
      orderBy: [{ displayName: 'asc' }],
      take: 20000,
    }),
  ]);

  const channelIndex = channels.map((c) => ({
    channelId: c.channelId,
    displayName: c.displayName,
    normDisplay: normalizeEpgName(c.displayName),
    normId: normalizeEpgName(c.channelId),
    tokens: tokenSet(c.displayName),
  }));

  const results: Array<{
    streamId: string;
    streamName: string;
    previousEpgChannelId: string | null;
    epgChannelId: string;
    epgDisplayName: string;
    score: number;
  }> = [];

  for (const s of streams) {
    const streamNorm = normalizeEpgName(s.name);
    if (!streamNorm) continue;
    const streamTokens = tokenSet(s.name);

    let best: { score: number; channelId: string; displayName: string } | null = null;
    let secondBestScore = 0;

    for (const c of channelIndex) {
      let score = 0;
      if (streamNorm === c.normDisplay) score = 1;
      else if (streamNorm === c.normId) score = 0.98;
      else if (c.normDisplay && (streamNorm.includes(c.normDisplay) || c.normDisplay.includes(streamNorm))) score = 0.9;
      else {
        score = jaccard(streamTokens, c.tokens);
      }

      if (score > (best?.score ?? 0)) {
        secondBestScore = best?.score ?? 0;
        best = { score, channelId: c.channelId, displayName: c.displayName };
      } else if (score > secondBestScore) {
        secondBestScore = score;
      }
    }

    if (!best || best.score < minScore) continue;
    if (secondBestScore >= best.score - 0.03) continue;

    results.push({
      streamId: s.id,
      streamName: s.name,
      previousEpgChannelId: s.epgChannelId || null,
      epgChannelId: best.channelId,
      epgDisplayName: best.displayName,
      score: Math.round(best.score * 1000) / 1000,
    });
  }

  if (!dryRun && results.length) {
    await prisma.$transaction(
      results.map((r) =>
        prisma.coreStream.update({
          where: { id: r.streamId },
          data: { epgChannelId: r.epgChannelId },
          select: { id: true },
        })
      )
    );
  }

  res.json({
    ok: true,
    dryRun,
    mode,
    minScore,
    totalStreamsConsidered: streams.length,
    totalChannels: channels.length,
    matched: results.length,
    results: results.slice(0, 500),
  });
});

export const createEpgSource = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const input = epgSourceSchema.parse(req.body);
  if (!cron.validate(input.cronExpression)) throw new AppError(400, `Expressão cron inválida: ${input.cronExpression}`);

  const src = await prisma.coreEpgSource.create({
    data: {
      ownerId: currentUser.userId,
      name: input.name,
      xmltvUrl: input.xmltvUrl,
      cronExpression: input.cronExpression,
      daysAhead: Math.max(1, input.daysAhead ?? 2),
      isActive: input.isActive ?? true,
    },
  });
  if (src.isActive) await scheduleCoreEpgSource(src.id).catch(() => {});
  res.status(201).json({ data: src });
});

export const updateEpgSource = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { id } = req.params;
  const input = epgSourceSchema.partial().parse(req.body);

  const existing = await prisma.coreEpgSource.findFirst({ where: { id, ...coreOwnerWhere(currentUser) } });
  if (!existing) throw new AppError(404, 'Fonte EPG não encontrada');
  if (input.cronExpression && !cron.validate(input.cronExpression)) throw new AppError(400, `Expressão cron inválida: ${input.cronExpression}`);

  const updated = await prisma.coreEpgSource.update({
    where: { id },
    data: {
      name: input.name ?? undefined,
      xmltvUrl: input.xmltvUrl ?? undefined,
      cronExpression: input.cronExpression ?? undefined,
      daysAhead: input.daysAhead === undefined ? undefined : Math.max(1, input.daysAhead),
      isActive: input.isActive ?? undefined,
    },
  });

  if (updated.isActive) await scheduleCoreEpgSource(updated.id).catch(() => {});
  else unscheduleCoreEpgSource(updated.id);

  res.json({ data: updated });
});

export const deleteEpgSource = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { id } = req.params;
  const existing = await prisma.coreEpgSource.findFirst({ where: { id, ...coreOwnerWhere(currentUser) } });
  if (!existing) throw new AppError(404, 'Fonte EPG não encontrada');
  unscheduleCoreEpgSource(id);
  await prisma.coreEpgProgram.deleteMany({ where: { sourceId: id } }).catch(() => {});
  await prisma.coreEpgSource.delete({ where: { id } });
  res.json({ ok: true });
});

export const runEpgSource = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { id } = req.params;
  const existing = await prisma.coreEpgSource.findFirst({ where: { id, ...coreOwnerWhere(currentUser) } });
  if (!existing) throw new AppError(404, 'Fonte EPG não encontrada');
  const result = await executeCoreEpgSource(id, 'manual');
  res.json({ ok: true, result });
});
