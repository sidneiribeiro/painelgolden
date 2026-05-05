import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import axios from 'axios';
import { pipeline } from 'node:stream/promises';
import { PassThrough } from 'node:stream';
import crypto from 'crypto';
import { prisma } from '../config/database.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';

const safe = (val: string) => val.replace(/[\r\n]+/g, ' ').replace(/"/g, "'").trim();

const escapeXml = (val: string) =>
  val
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const formatXmltvDate = (date: Date) => {
  const d = new Date(date.getTime());
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}${hh}${mi}${ss} +0000`;
};

const formatYmdHms = (date: Date) => date.toISOString().replace('T', ' ').slice(0, 19);

const activeConnectionsByLine = new Map<string, Set<string>>();
const ownerPublicBaseUrlCache = new Map<string, { publicBaseUrl: string; expiresAt: number }>();
const isCoreEdgeOnly = process.env.CORE_EDGE_ONLY === 'true';
const ownerEdgeServersCache = new Map<string, { expiresAt: number; servers: Array<{ serverId: string; host: string; httpPort: number; httpsPort: number }> }>();
const streamEdgeServersCache = new Map<string, { expiresAt: number; servers: Array<{ serverId: string; host: string; httpPort: number; httpsPort: number }> }>();

function stripApiSuffix(url: string) {
  return (url || '').replace(/\/api\/?$/, '').replace(/\/$/, '');
}

function getRequestBaseUrl(req: Request) {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) || req.protocol || 'http';
  const host = (req.headers['x-forwarded-host'] as string | undefined) || req.get('host') || '';
  return stripApiSuffix(`${proto}://${host}`);
}

async function getOwnerEdgeServers(ownerId: string) {
  const now = Date.now();
  const cached = ownerEdgeServersCache.get(ownerId);
  if (cached && cached.expiresAt > now) return cached.servers;

  const rows = await prisma.coreEdgeServer.findMany({
    where: { ownerId, isActive: true },
    select: { id: true, domain: true, ip: true, httpPort: true, httpsPort: true },
    orderBy: [{ createdAt: 'asc' }],
  });

  const servers = rows
    .map((s) => ({
      serverId: s.id,
      host: (s.domain || s.ip || '').trim(),
      httpPort: typeof s.httpPort === 'number' ? s.httpPort : 80,
      httpsPort: typeof s.httpsPort === 'number' ? s.httpsPort : 443,
    }))
    .filter((s) => !!s.host);

  ownerEdgeServersCache.set(ownerId, { servers, expiresAt: now + 10_000 });
  return servers;
}

async function getStreamEdgeServers(ownerId: string, streamId: string) {
  const now = Date.now();
  const key = `${ownerId}:${streamId}`;
  const cached = streamEdgeServersCache.get(key);
  if (cached && cached.expiresAt > now) return cached.servers;

  const rows = await (prisma as any).coreStreamEdgeServer.findMany({
    where: { streamId, stream: { ownerId } },
    select: { serverId: true, server: { select: { id: true, domain: true, ip: true, httpPort: true, httpsPort: true, isActive: true } } },
  });

  const servers = (rows || [])
    .map((r: any) => {
      const s = r.server;
      if (!s || !s.isActive) return null;
      return {
        serverId: s.id,
        host: (s.domain || s.ip || '').trim(),
        httpPort: typeof s.httpPort === 'number' ? s.httpPort : 80,
        httpsPort: typeof s.httpsPort === 'number' ? s.httpsPort : 443,
      };
    })
    .filter(Boolean);

  const effective = servers.length ? servers : await getOwnerEdgeServers(ownerId);
  streamEdgeServersCache.set(key, { servers: effective, expiresAt: now + 10_000 });
  return effective;
}

async function maybeRedirectToEdge(req: Request, res: Response, ownerId: string, streamId: string, seed: string) {
  if (isCoreEdgeOnly) return false;

  const servers = await getStreamEdgeServers(ownerId, streamId);
  if (!servers.length) return false;

  const proto = (req.headers['x-forwarded-proto'] as string | undefined) || req.protocol || 'http';
  const scheme = proto === 'https' ? 'https' : 'http';
  const idx = pickCandidateStartIndex(seed, servers.length);
  const chosen = servers[idx];
  const port = scheme === 'https' ? chosen.httpsPort : chosen.httpPort;
  const omitPort = (scheme === 'http' && port === 80) || (scheme === 'https' && port === 443);
  const hostWithPort = omitPort ? chosen.host : `${chosen.host}:${Math.max(1, port)}`;

  const currentHost = ((req.headers['x-forwarded-host'] as string | undefined) || req.get('host') || '').trim();
  if (currentHost && currentHost === hostWithPort) return false;

  const target = `${scheme}://${hostWithPort}${req.originalUrl}`;
  res.redirect(302, target);
  return true;
}

async function getOwnerPublicBaseUrl(ownerId: string) {
  const cached = ownerPublicBaseUrlCache.get(ownerId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.publicBaseUrl;

  const settings = await prisma.panelSettings.findUnique({
    where: { userId: ownerId },
    select: { publicBaseUrl: true },
  });

  const publicBaseUrl = stripApiSuffix(settings?.publicBaseUrl || '');
  ownerPublicBaseUrlCache.set(ownerId, { publicBaseUrl, expiresAt: now + 5 * 60 * 1000 });
  return publicBaseUrl;
}

async function getOwnerBaseUrl(req: Request, ownerId: string) {
  const requestBase = getRequestBaseUrl(req);
  if (requestBase) return requestBase;
  const publicBaseUrl = await getOwnerPublicBaseUrl(ownerId);
  return publicBaseUrl || requestBase;
}

function getClientIp(req: Request) {
  return (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.ip || null;
}

function getXcPrefix(req: Request) {
  return req.baseUrl && req.baseUrl.startsWith('/api/xc') ? '/api/xc' : '';
}

function rewriteM3u8(body: string, playlistUrl: string, proxyBase: string, sessionId: string) {
  const lines = String(body || '').split(/\r?\n/);
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw || '';
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      out.push(line);
      continue;
    }
    let resolved = '';
    try {
      resolved = new URL(trimmed, playlistUrl).toString();
    } catch {
      resolved = trimmed;
    }
    out.push(`${proxyBase}/hls/${encodeURIComponent(sessionId)}?u=${encodeURIComponent(resolved)}`);
  }
  return out.join('\n');
}

function parseUpstreamCandidates(raw: string) {
  const lines = String(raw || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const uniq: string[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    if (seen.has(l)) continue;
    seen.add(l);
    uniq.push(l);
  }
  return uniq;
}

function pickCandidateStartIndex(seed: string, count: number) {
  if (count <= 1) return 0;
  const h = crypto.createHash('sha1').update(seed).digest();
  const n = h.readUInt32BE(0);
  return n % count;
}

async function probeUpstreamUrl(req: Request, url: string) {
  const ac = new AbortController();
  const headers: Record<string, string> = {};
  const passHeaders = ['range', 'user-agent', 'accept', 'accept-language', 'accept-encoding', 'referer', 'origin', 'connection'];
  for (const h of passHeaders) {
    const v = req.headers[h];
    if (typeof v === 'string' && v) headers[h] = v;
  }

  try {
    const upstream = await axios.request({
      url,
      method: 'GET',
      responseType: 'stream',
      headers,
      signal: ac.signal,
      timeout: 8000,
      maxRedirects: 3,
      validateStatus: () => true,
    });
    try {
      if (upstream?.data && typeof (upstream.data as any).destroy === 'function') (upstream.data as any).destroy();
    } catch {}
    return upstream.status < 400;
  } catch {
    return false;
  } finally {
    try { ac.abort(); } catch {}
  }
}

function acquireConnectionSlot(lineId: string, maxConnections: number) {
  const set = activeConnectionsByLine.get(lineId) || new Set<string>();
  if (set.size >= Math.max(1, maxConnections)) return null;
  const token = crypto.randomBytes(12).toString('hex');
  set.add(token);
  activeConnectionsByLine.set(lineId, set);
  return () => {
    const current = activeConnectionsByLine.get(lineId);
    if (!current) return;
    current.delete(token);
    if (current.size === 0) activeConnectionsByLine.delete(lineId);
  };
}

async function proxyUpstream(req: Request, res: Response, targetUrl: string, release: () => void, sessionId: string) {
  const ac = new AbortController();
  let bytesSent = 0n;
  let pingTimer: NodeJS.Timeout | null = null;
  let pingBusy = false;

  const cleanup = () => {
    try { ac.abort(); } catch {}
    if (pingTimer) {
      try { clearInterval(pingTimer); } catch {}
      pingTimer = null;
    }
    const now = new Date();
    prisma.corePlaybackSession
      .updateMany({
        where: { id: sessionId, endedAt: null },
        data: { endedAt: now, lastSeenAt: now, bytesSent },
      })
      .catch(() => {});
    prisma.corePlaybackSession
      .updateMany({
        where: { id: sessionId, status: 'active' },
        data: { status: 'ended' },
      })
      .catch(() => {});
    try { release(); } catch {}
  };

  res.on('close', cleanup);
  res.on('finish', cleanup);

  pingTimer = setInterval(() => {
    if (pingBusy) return;
    pingBusy = true;
    void (async () => {
      try {
        const current = await prisma.corePlaybackSession.findUnique({
          where: { id: sessionId },
          select: { status: true, endedAt: true },
        });
        if (!current || current.endedAt || current.status !== 'active') {
          try { ac.abort(); } catch {}
          return;
        }
        await prisma.corePlaybackSession.update({ where: { id: sessionId }, data: { lastSeenAt: new Date() } });
      } catch {
      } finally {
        pingBusy = false;
      }
    })();
  }, 10000);

  const headers: Record<string, string> = {};
  const passHeaders = ['range', 'user-agent', 'accept', 'accept-language', 'accept-encoding', 'referer', 'origin', 'connection'];
  for (const h of passHeaders) {
    const v = req.headers[h];
    if (typeof v === 'string' && v) headers[h] = v;
  }

  const upstream = await axios.request({
    url: targetUrl,
    method: 'GET',
    responseType: 'stream',
    headers,
    signal: ac.signal,
    timeout: 30000,
    maxRedirects: 5,
    validateStatus: () => true,
  });

  if (upstream.status >= 400) {
    cleanup();
    throw new AppError(502, `Upstream retornou ${upstream.status}`);
  }

  res.status(upstream.status);
  res.setHeader('Cache-Control', 'no-store');

  const allowlisted = new Set([
    'content-type',
    'content-length',
    'accept-ranges',
    'content-range',
    'etag',
    'last-modified',
  ]);
  for (const [k, v] of Object.entries(upstream.headers || {})) {
    const key = k.toLowerCase();
    if (!allowlisted.has(key)) continue;
    if (typeof v === 'string') res.setHeader(k, v);
  }

  const counter = new PassThrough();
  counter.on('data', (chunk: any) => {
    if (chunk?.length) bytesSent += BigInt(chunk.length);
  });

  await pipeline(upstream.data, counter, res);
}

async function createPlaybackSession(params: {
  lineId: string;
  maxConnections: number;
  contentType: 'live' | 'timeshift' | 'movie' | 'series';
  contentPublicId: number;
  ipAddress: string | null;
  userAgent: string | null;
  serverHost?: string | null;
}) {
  const now = new Date();
  const freshAfter = new Date(now.getTime() - 90_000);

  const result = await prisma.$transaction(async (tx) => {
    const activeCount = await tx.corePlaybackSession.count({
      where: { lineId: params.lineId, endedAt: null, lastSeenAt: { gt: freshAfter }, status: 'active' },
    });
    if (activeCount >= Math.max(1, params.maxConnections)) {
      throw new AppError(429, 'Limite de conexões atingido');
    }

    if (params.ipAddress) {
      const ips = await tx.corePlaybackSession.findMany({
        where: {
          lineId: params.lineId,
          endedAt: null,
          lastSeenAt: { gt: freshAfter },
          status: 'active',
          ipAddress: { not: null },
        },
        distinct: ['ipAddress'],
        select: { ipAddress: true },
      });

      const distinctIps = ips.map((x) => x.ipAddress).filter(Boolean) as string[];
      const maxIps = Math.max(1, params.maxConnections);
      if (distinctIps.length >= maxIps && !distinctIps.includes(params.ipAddress)) {
        throw new AppError(429, 'Limite de IPs simultâneos atingido');
      }
    }

    const session = await tx.corePlaybackSession.create({
      data: {
        lineId: params.lineId,
        contentType: params.contentType,
        contentPublicId: params.contentPublicId,
        serverHost: params.serverHost || null,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        lastSeenAt: now,
        status: 'active',
      },
      select: { id: true },
    });
    return session;
  });

  return result.id;
}

const buildStreamUrl = (baseUrl: string, xcPrefix: string, username: string, password: string, streamPublicId: number, ext: string) => {
  const base = stripApiSuffix(baseUrl);
  return `${base}${xcPrefix}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamPublicId}.${ext}`;
};

const buildTimeshiftUrl = (baseUrl: string, xcPrefix: string, username: string, password: string, duration: string, start: string, streamPublicId: number, ext: string) => {
  const base = stripApiSuffix(baseUrl);
  return `${base}${xcPrefix}/timeshift/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${encodeURIComponent(
    duration
  )}/${encodeURIComponent(start)}/${streamPublicId}.${ext}`;
};

const buildMovieUrl = (baseUrl: string, xcPrefix: string, username: string, password: string, vodPublicId: number, ext: string) => {
  const base = stripApiSuffix(baseUrl);
  return `${base}${xcPrefix}/movie/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${vodPublicId}.${ext}`;
};

const buildSeriesUrl = (baseUrl: string, xcPrefix: string, username: string, password: string, episodePublicId: number, ext: string) => {
  const base = stripApiSuffix(baseUrl);
  return `${base}${xcPrefix}/series/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${episodePublicId}.${ext}`;
};

async function authenticateLineFromQuery(req: Request) {
  const username = typeof req.query.username === 'string' ? req.query.username : '';
  const password = typeof req.query.password === 'string' ? req.query.password : '';
  if (!username || !password) throw new AppError(400, 'username e password são obrigatórios');

  const line = await prisma.coreLine.findUnique({
    where: { username },
    select: {
      id: true,
      ownerId: true,
      username: true,
      passwordHash: true,
      status: true,
      expiresAt: true,
      connections: true,
      packageId: true,
      createdAt: true,
    },
  });

  if (!line) throw new AppError(401, 'Credenciais inválidas');
  if (line.status !== 'ACTIVE') throw new AppError(403, 'Linha desativada');

  const now = new Date();
  if (line.expiresAt.getTime() <= now.getTime()) throw new AppError(403, 'Linha expirada');

  const ok = await bcrypt.compare(password, line.passwordHash);
  if (!ok) throw new AppError(401, 'Credenciais inválidas');

  return { line, password };
}

async function authenticateLineFromParams(username: string, password: string) {
  if (!username || !password) throw new AppError(400, 'username e password são obrigatórios');

  const line = await prisma.coreLine.findUnique({
    where: { username },
    select: {
      id: true,
      ownerId: true,
      username: true,
      passwordHash: true,
      status: true,
      expiresAt: true,
      connections: true,
      packageId: true,
      createdAt: true,
    },
  });

  if (!line) throw new AppError(401, 'Credenciais inválidas');
  if (line.status !== 'ACTIVE') throw new AppError(403, 'Linha desativada');

  const now = new Date();
  if (line.expiresAt.getTime() <= now.getTime()) throw new AppError(403, 'Linha expirada');

  const ok = await bcrypt.compare(password, line.passwordHash);
  if (!ok) throw new AppError(401, 'Credenciais inválidas');

  return { line, password };
}

function getServerInfo(baseUrl: string) {
  let protocol = 'http';
  let host = '';
  try {
    const u = new URL(baseUrl);
    protocol = u.protocol.replace(':', '') || 'http';
    host = u.host || '';
  } catch {
    host = baseUrl.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  }
  const now = new Date();
  const timestamp = Math.floor(now.getTime() / 1000);

  const isHttps = protocol === 'https';
  const port = (() => {
    const parts = host.split(':');
    if (parts.length === 2) return parts[1];
    return isHttps ? '443' : '80';
  })();

  return {
    url: host.split(':')[0],
    port,
    https_port: '443',
    server_protocol: protocol,
    rtmp_port: '0',
    timezone: 'America/Sao_Paulo',
    timestamp_now: timestamp,
    time_now: now.toISOString().replace('T', ' ').slice(0, 19),
    base_url: stripApiSuffix(`${protocol}://${host}`),
    server_ip: host.split(':')[0],
  };
}

export const getM3U = asyncHandler(async (req: Request, res: Response) => {
  const { line, password } = await authenticateLineFromQuery(req);
  const username = line.username;
  const baseUrl = await getOwnerBaseUrl(req, line.ownerId);
  const xcPrefix = req.baseUrl && req.baseUrl.startsWith('/api/xc') ? '/api/xc' : '';
  const typeRaw = typeof req.query.type === 'string' ? req.query.type.trim().toLowerCase() : '';
  const includePlus = typeRaw !== 'm3u';
  const outputRaw = typeof req.query.output === 'string' ? req.query.output.trim().toLowerCase() : '';
  const liveExt = outputRaw === 'm3u8' || outputRaw === 'hls' ? 'm3u8' : 'ts';

  if (!line.packageId) {
    res.setHeader('Content-Type', 'application/x-mpegURL; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safe(username)}.m3u"`);
    return res.status(200).send('#EXTM3U\n');
  }

  const pkgBouquets = await prisma.corePackageBouquet.findMany({
    where: { packageId: line.packageId },
    select: { bouquetId: true },
  });
  const bouquetIds = pkgBouquets.map(b => b.bouquetId);

  if (!bouquetIds.length) {
    res.setHeader('Content-Type', 'application/x-mpegURL; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safe(username)}.m3u"`);
    return res.status(200).send('#EXTM3U\n');
  }

  const liveItems = await prisma.coreBouquetStream.findMany({
    where: {
      bouquetId: { in: bouquetIds },
      bouquet: { isActive: true },
      stream: { isActive: true },
    },
    include: {
      bouquet: { select: { name: true } },
      stream: { select: { name: true, logoUrl: true, publicId: true, epgChannelId: true, tvArchive: true, tvArchiveDuration: true } },
    },
    orderBy: [{ bouquet: { name: 'asc' } }, { sortOrder: 'asc' }],
  });

  const vodItems = includePlus
    ? await prisma.coreBouquetVodItem.findMany({
        where: {
          bouquetId: { in: bouquetIds },
          bouquet: { isActive: true },
          vodItem: { isActive: true },
        },
        include: {
          bouquet: { select: { name: true } },
          vodItem: { select: { name: true, posterUrl: true, publicId: true } },
        },
        orderBy: [{ bouquet: { name: 'asc' } }, { sortOrder: 'asc' }],
      })
    : [];

  const seriesLinks = includePlus
    ? await prisma.coreBouquetSeries.findMany({
        where: {
          bouquetId: { in: bouquetIds },
          bouquet: { isActive: true },
          series: { isActive: true },
        },
        include: {
          bouquet: { select: { name: true } },
          series: { select: { id: true, name: true, coverUrl: true } },
        },
        orderBy: [{ bouquet: { name: 'asc' } }, { sortOrder: 'asc' }],
      })
    : [];

  const seriesIds = Array.from(new Set(seriesLinks.map(s => s.series.id)));
  const episodesBySeriesId = new Map<string, Array<{ publicId: number; season: number; episode: number; title: string }>>();
  if (seriesIds.length && includePlus) {
    const eps = await prisma.coreSeriesEpisode.findMany({
      where: { seriesId: { in: seriesIds }, isActive: true, series: { isActive: true } },
      select: { seriesId: true, publicId: true, season: true, episode: true, title: true },
      orderBy: [{ season: 'asc' }, { episode: 'asc' }],
    });
    for (const e of eps) {
      const arr = episodesBySeriesId.get(e.seriesId) || [];
      arr.push({ publicId: e.publicId, season: e.season, episode: e.episode, title: e.title });
      episodesBySeriesId.set(e.seriesId, arr);
    }
  }

  let out = '#EXTM3U\n';
  for (const it of liveItems) {
    const title = safe(it.stream.name);
    const group = safe(it.bouquet.name);
    const logo = it.stream.logoUrl ? safe(it.stream.logoUrl) : '';
    const tvgId = it.stream.epgChannelId ? safe(it.stream.epgChannelId) : '';
    const catchup = it.stream.tvArchive
      ? ` catchup="default" catchup-days="${Math.max(0, it.stream.tvArchiveDuration || 0)}" catchup-source="${buildTimeshiftUrl(
          baseUrl,
          xcPrefix,
          username,
          password,
          '{duration}',
          '{start}',
          it.stream.publicId,
          'ts'
        )}"`
      : '';
    const url = buildStreamUrl(baseUrl, xcPrefix, username, password, it.stream.publicId, liveExt);
    if (!url) continue;
    out += `#EXTINF:-1 tvg-id="${tvgId}" tvg-name="${title}" tvg-logo="${logo}" group-title="${group}"${catchup},${title}\n${url}\n`;
  }

  for (const it of vodItems) {
    const title = safe(it.vodItem.name);
    const group = safe(it.bouquet.name);
    const logo = it.vodItem.posterUrl ? safe(it.vodItem.posterUrl) : '';
    const url = buildMovieUrl(baseUrl, xcPrefix, username, password, it.vodItem.publicId, 'mp4');
    if (!url) continue;
    out += `#EXTINF:-1 tvg-name="${title}" tvg-logo="${logo}" group-title="${group}",${title}\n${url}\n`;
  }

  for (const link of seriesLinks) {
    const group = safe(link.bouquet.name);
    const seriesName = safe(link.series.name);
    const logo = link.series.coverUrl ? safe(link.series.coverUrl) : '';
    const eps = episodesBySeriesId.get(link.series.id) || [];
    for (const e of eps) {
      const se = `S${String(e.season).padStart(2, '0')}E${String(e.episode).padStart(2, '0')}`;
      const title = safe(`${seriesName} ${se} - ${e.title}`);
      const url = buildSeriesUrl(baseUrl, xcPrefix, username, password, e.publicId, 'mp4');
      if (!url) continue;
      out += `#EXTINF:-1 tvg-name="${title}" tvg-logo="${logo}" group-title="${group}",${title}\n${url}\n`;
    }
  }

  res.setHeader('Content-Type', 'application/x-mpegURL; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safe(username)}.m3u"`);
  res.status(200).send(out);
});

export const getPlayerApi = asyncHandler(async (req: Request, res: Response) => {
  const { line, password } = await authenticateLineFromQuery(req);
  let action = typeof req.query.action === 'string' ? req.query.action : '';
  action = action.trim();
  if (action === 'get_account_info' || action === 'get_user_info') action = '';
  if (action === 'get_itv_categories') action = 'get_live_categories';
  if (action === 'get_itv_streams') action = 'get_live_streams';
  if (action === 'get_itv_info') action = 'get_live_info';
  const baseUrl = await getOwnerBaseUrl(req, line.ownerId);
  const xcPrefix = req.baseUrl && req.baseUrl.startsWith('/api/xc') ? '/api/xc' : '';
  const outputRaw = typeof req.query.output === 'string' ? req.query.output.trim().toLowerCase() : '';
  const liveExt = outputRaw === 'm3u8' || outputRaw === 'hls' ? 'm3u8' : 'ts';

  const expDate = Math.floor(line.expiresAt.getTime() / 1000);
  const createdAt = Math.floor(line.createdAt.getTime() / 1000);
  const now = new Date();
  const freshAfter = new Date(now.getTime() - 90_000);
  const activeCons = await prisma.corePlaybackSession.count({
    where: { lineId: line.id, endedAt: null, lastSeenAt: { gt: freshAfter }, status: 'active' },
  });

  if (!line.packageId) {
    if (action) {
      return res.json([]);
    }

    return res.json({
      user_info: {
        username: line.username,
        status: 'Active',
        exp_date: String(expDate),
        is_trial: '0',
        active_cons: activeCons,
        created_at: String(createdAt),
        max_connections: line.connections,
        allowed_output_formats: ['m3u8', 'ts', 'rtmp'],
        auth: 1,
        message: '',
      },
      server_info: getServerInfo(baseUrl),
    });
  }

  const allowedBouquets = await prisma.corePackageBouquet.findMany({
    where: { packageId: line.packageId },
    include: {
      bouquet: { select: { id: true, publicId: true, name: true, isActive: true } },
    },
  });

  const activeBouquets = allowedBouquets
    .filter(b => b.bouquet.isActive)
    .map(b => b.bouquet);

  const bouquetIdFromCategoryParam = (categoryParam: string | undefined | null): string | null => {
    if (!categoryParam) return null;
    const asNum = parseInt(categoryParam, 10);
    if (Number.isFinite(asNum)) {
      const matchInt = activeBouquets.find(b => b.publicId === asNum);
      return matchInt ? matchInt.id : null;
    }
    return null;
  };

  if (action === 'get_live_categories') {
    return res.json(
      activeBouquets.map((b) => ({
        category_id: String(b.publicId),
        category_name: b.name,
        parent_id: 0,
      }))
    );
  }

  if (action === 'get_vod_categories') {
    return res.json(
      activeBouquets.map((b) => ({
        category_id: String(b.publicId),
        category_name: b.name,
        parent_id: 0,
      }))
    );
  }

  if (action === 'get_series_categories') {
    return res.json(
      activeBouquets.map((b) => ({
        category_id: String(b.publicId),
        category_name: b.name,
        parent_id: 0,
      }))
    );
  }

  if (action === 'get_live_streams') {
    const categoryIdParam = typeof req.query.category_id === 'string' ? req.query.category_id : undefined;
    const filteredBouquetId = bouquetIdFromCategoryParam(categoryIdParam);

    const bouquetIds = filteredBouquetId ? [filteredBouquetId] : activeBouquets.map(b => b.id);
    if (!bouquetIds.length) return res.json([]);

    const items = await prisma.coreBouquetStream.findMany({
      where: {
        bouquetId: { in: bouquetIds },
        bouquet: { isActive: true },
        stream: { isActive: true },
      },
      include: {
        bouquet: { select: { publicId: true } },
        stream: { select: { publicId: true, name: true, logoUrl: true, epgChannelId: true, tvArchive: true, tvArchiveDuration: true } },
      },
      orderBy: [{ sortOrder: 'asc' }],
    });

    return res.json(
      items.map((it) => ({
        num: 0,
        name: it.stream.name,
        stream_type: 'live',
        stream_id: it.stream.publicId,
        stream_icon: it.stream.logoUrl || '',
        stream_url: buildStreamUrl(baseUrl, xcPrefix, line.username, password, it.stream.publicId, liveExt),
        epg_channel_id: it.stream.epgChannelId || '',
        added: '',
        category_id: String(it.bouquet.publicId),
        custom_sid: '',
        tv_archive: it.stream.tvArchive ? 1 : 0,
        direct_source: buildStreamUrl(baseUrl, xcPrefix, line.username, password, it.stream.publicId, liveExt),
        tv_archive_duration: it.stream.tvArchive ? Math.max(0, it.stream.tvArchiveDuration || 0) : 0,
      }))
    );
  }

  if (action === 'get_live_info') {
    const streamIdParam = typeof req.query.stream_id === 'string' ? req.query.stream_id : '';
    const streamPublicId = parseInt(streamIdParam, 10);
    if (!Number.isFinite(streamPublicId)) return res.json({ info: {} });

    const stream = await prisma.coreStream.findFirst({
      where: { publicId: streamPublicId, isActive: true },
      select: { id: true, publicId: true, name: true, logoUrl: true, epgChannelId: true, tvArchive: true, tvArchiveDuration: true },
    });
    if (!stream) return res.json({ info: {} });

    const allowedBouquetIds = activeBouquets.map(b => b.id);
    const link = await prisma.coreBouquetStream.findFirst({
      where: { streamId: stream.id, bouquetId: { in: allowedBouquetIds }, bouquet: { isActive: true } },
      select: { bouquet: { select: { publicId: true } } },
    });
    if (!link) return res.json({ info: {} });

    return res.json({
      info: {
        name: stream.name,
        stream_type: 'live',
        stream_id: stream.publicId,
        stream_icon: stream.logoUrl || '',
        stream_url: buildStreamUrl(baseUrl, xcPrefix, line.username, password, stream.publicId, liveExt),
        epg_channel_id: stream.epgChannelId || '',
        category_id: String(link.bouquet.publicId),
        tv_archive: stream.tvArchive ? 1 : 0,
        tv_archive_duration: stream.tvArchive ? Math.max(0, stream.tvArchiveDuration || 0) : 0,
        direct_source: buildStreamUrl(baseUrl, xcPrefix, line.username, password, stream.publicId, liveExt),
      },
      epg_listings: [],
    });
  }

  if (action === 'get_vod_streams') {
    const categoryIdParam = typeof req.query.category_id === 'string' ? req.query.category_id : undefined;
    const filteredBouquetId = bouquetIdFromCategoryParam(categoryIdParam);

    const bouquetIds = filteredBouquetId ? [filteredBouquetId] : activeBouquets.map(b => b.id);
    if (!bouquetIds.length) return res.json([]);

    const items = await prisma.coreBouquetVodItem.findMany({
      where: {
        bouquetId: { in: bouquetIds },
        bouquet: { isActive: true },
        vodItem: { isActive: true },
      },
      include: {
        bouquet: { select: { publicId: true } },
        vodItem: { select: { publicId: true, name: true, posterUrl: true } },
      },
      orderBy: [{ sortOrder: 'asc' }],
    });

    return res.json(
      items.map((it) => ({
        num: 0,
        name: it.vodItem.name,
        stream_type: 'movie',
        stream_id: it.vodItem.publicId,
        stream_icon: it.vodItem.posterUrl || '',
        stream_url: buildMovieUrl(baseUrl, xcPrefix, line.username, password, it.vodItem.publicId, 'mp4'),
        rating: '',
        rating_5based: 0,
        added: '',
        category_id: String(it.bouquet.publicId),
        container_extension: 'mp4',
        custom_sid: '',
        direct_source: buildMovieUrl(baseUrl, xcPrefix, line.username, password, it.vodItem.publicId, 'mp4'),
      }))
    );
  }

  if (action === 'get_vod_info') {
    const vodIdParam = typeof req.query.vod_id === 'string' ? req.query.vod_id : '';
    const vodPublicId = parseInt(vodIdParam, 10);
    if (!Number.isFinite(vodPublicId)) return res.json({ info: {}, movie_data: {} });

    const vod = await prisma.coreVodItem.findFirst({
      where: { publicId: vodPublicId, isActive: true },
      select: { id: true, publicId: true, name: true, posterUrl: true },
    });
    if (!vod) return res.json({ info: {}, movie_data: {} });

    const allowedBouquetIds = activeBouquets.map(b => b.id);
    const link = await prisma.coreBouquetVodItem.findFirst({
      where: { vodItemId: vod.id, bouquetId: { in: allowedBouquetIds }, bouquet: { isActive: true } },
      select: { bouquet: { select: { publicId: true } } },
    });
    if (!link) return res.json({ info: {}, movie_data: {} });

    return res.json({
      info: {
        name: vod.name,
        o_name: vod.name,
        movie_image: vod.posterUrl || '',
        plot: '',
        cast: '',
        director: '',
        genre: '',
        releaseDate: '',
        rating: '',
        duration: '',
      },
      movie_data: {
        stream_id: vod.publicId,
        name: vod.name,
        category_id: String(link.bouquet.publicId),
        container_extension: 'mp4',
        stream_url: buildMovieUrl(baseUrl, xcPrefix, line.username, password, vod.publicId, 'mp4'),
        direct_source: buildMovieUrl(baseUrl, xcPrefix, line.username, password, vod.publicId, 'mp4'),
      },
    });
  }

  if (action === 'get_series') {
    const categoryIdParam = typeof req.query.category_id === 'string' ? req.query.category_id : undefined;
    const filteredBouquetId = bouquetIdFromCategoryParam(categoryIdParam);

    const bouquetIds = filteredBouquetId ? [filteredBouquetId] : activeBouquets.map(b => b.id);
    if (!bouquetIds.length) return res.json([]);

    const items = await prisma.coreBouquetSeries.findMany({
      where: {
        bouquetId: { in: bouquetIds },
        bouquet: { isActive: true },
        series: { isActive: true },
      },
      include: {
        bouquet: { select: { publicId: true } },
        series: { select: { publicId: true, name: true, coverUrl: true } },
      },
      orderBy: [{ sortOrder: 'asc' }],
    });

    return res.json(
      items.map((it) => ({
        num: 0,
        name: it.series.name,
        series_id: it.series.publicId,
        cover: it.series.coverUrl || '',
        cover_big: it.series.coverUrl || '',
        plot: '',
        cast: '',
        director: '',
        genre: '',
        releaseDate: '',
        last_modified: '',
        rating: '',
        rating_5based: 0,
        backdrop_path: [],
        youtube_trailer: '',
        episode_run_time: '',
        category_id: String(it.bouquet.publicId),
      }))
    );
  }

  if (action === 'get_series_info') {
    const seriesIdParam = typeof req.query.series_id === 'string' ? req.query.series_id : '';
    const seriesPublicId = parseInt(seriesIdParam, 10);
    if (!Number.isFinite(seriesPublicId)) return res.json({ info: {}, episodes: {} });

    const series = await prisma.coreSeries.findFirst({
      where: { publicId: seriesPublicId, isActive: true },
      select: { id: true, publicId: true, name: true, coverUrl: true },
    });
    if (!series) return res.json({ info: {}, episodes: {} });

    const allowedBouquetIds = activeBouquets.map(b => b.id);
    const linked = await prisma.coreBouquetSeries.findFirst({
      where: { seriesId: series.id, bouquetId: { in: allowedBouquetIds }, bouquet: { isActive: true } },
      select: { bouquetId: true },
    });
    if (!linked) return res.json({ info: {}, episodes: {} });

    const eps = await prisma.coreSeriesEpisode.findMany({
      where: { seriesId: series.id, isActive: true },
      orderBy: [{ season: 'asc' }, { episode: 'asc' }],
      select: { publicId: true, season: true, episode: true, title: true },
    });

    const episodes: Record<string, any[]> = {};
    const seasonsAgg = new Map<number, number>();
    for (const e of eps) {
      const seasonKey = String(e.season);
      if (!episodes[seasonKey]) episodes[seasonKey] = [];
      episodes[seasonKey].push({
        id: e.publicId,
        episode_num: e.episode,
        title: e.title,
        container_extension: 'mp4',
        custom_sid: '',
        added: '',
        stream_url: buildSeriesUrl(baseUrl, xcPrefix, line.username, password, e.publicId, 'mp4'),
        direct_source: buildSeriesUrl(baseUrl, xcPrefix, line.username, password, e.publicId, 'mp4'),
      });
      seasonsAgg.set(e.season, (seasonsAgg.get(e.season) || 0) + 1);
    }

    const seasons = Array.from(seasonsAgg.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([seasonNumber, episodeCount]) => ({
        id: seasonNumber,
        season_number: seasonNumber,
        name: `Season ${seasonNumber}`,
        episode_count: episodeCount,
        overview: '',
        cover: series.coverUrl || '',
        cover_big: series.coverUrl || '',
      }));

    return res.json({
      info: {
        series_id: series.publicId,
        name: series.name,
        cover: series.coverUrl || '',
        cover_big: series.coverUrl || '',
        plot: '',
        cast: '',
        director: '',
        genre: '',
        releaseDate: '',
        last_modified: '',
        rating: '',
        rating_5based: 0,
        backdrop_path: [],
        youtube_trailer: '',
        episode_run_time: '',
      },
      episodes,
      seasons,
    });
  }

  if (action === 'get_short_epg' || action === 'get_simple_data_table' || action === 'get_epg') {
    const streamIdParam =
      (typeof req.query.stream_id === 'string' ? req.query.stream_id : '') ||
      (typeof req.query.epg_id === 'string' ? req.query.epg_id : '') ||
      (typeof req.query.live_id === 'string' ? req.query.live_id : '') ||
      (typeof req.query.id === 'string' ? req.query.id : '');
    const streamPublicId = parseInt(streamIdParam || '', 10);
    if (!Number.isFinite(streamPublicId)) return res.json({ epg_listings: [] });

    const allowedBouquetIds = activeBouquets.map(b => b.id);
    const stream = await prisma.coreStream.findFirst({
      where: { publicId: streamPublicId, isActive: true },
      select: { id: true, epgChannelId: true },
    });
    if (!stream || !stream.epgChannelId) return res.json({ epg_listings: [] });

    const allowed = await prisma.coreBouquetStream.findFirst({
      where: {
        streamId: stream.id,
        bouquetId: { in: allowedBouquetIds },
        bouquet: { isActive: true },
        stream: { isActive: true },
      },
      select: { streamId: true },
    });
    if (!allowed) return res.json({ epg_listings: [] });

    const now = new Date();
    const parseDate = (raw: unknown) => {
      if (typeof raw !== 'string') return null;
      const s = raw.trim();
      if (!s) return null;
      if (/^\d{10,13}$/.test(s)) {
        const n = parseInt(s, 10);
        if (Number.isFinite(n)) return new Date((s.length >= 13 ? n : n * 1000));
      }
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    };

    const fromRaw = (req.query.from as any) ?? (req.query.start as any) ?? (req.query.start_timestamp as any);
    const toRaw = (req.query.to as any) ?? (req.query.end as any) ?? (req.query.end_timestamp as any);
    const from = parseDate(fromRaw) || new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const to = parseDate(toRaw) || new Date(now.getTime() + 12 * 60 * 60 * 1000);

    const limitRaw = typeof req.query.limit === 'string' ? req.query.limit : '';
    const take = (() => {
      const n = parseInt(limitRaw || '', 10);
      if (!Number.isFinite(n)) return 200;
      return Math.min(1000, Math.max(1, n));
    })();

    const rows = await prisma.coreEpgProgram.findMany({
      where: {
        ownerId: line.ownerId,
        channelId: stream.epgChannelId,
        startAt: { lt: to },
        endAt: { gt: from },
      },
      orderBy: [{ startAt: 'asc' }],
      take,
      select: { id: true, startAt: true, endAt: true, title: true, description: true },
    });

    const epg_listings = rows.map((p) => ({
      id: p.id,
      epg_id: p.id,
      title: p.title,
      description: p.description || '',
      start: formatYmdHms(p.startAt),
      end: formatYmdHms(p.endAt),
      start_timestamp: Math.floor(p.startAt.getTime() / 1000),
      stop_timestamp: Math.floor(p.endAt.getTime() / 1000),
    }));

    if (action === 'get_simple_data_table') {
      return res.json({ epg_listings, data: epg_listings, recordsTotal: epg_listings.length, recordsFiltered: epg_listings.length });
    }

    return res.json({ epg_listings });
  }

  if (action) {
    return res.json([]);
  }

  return res.json({
    user_info: {
      username: line.username,
      status: 'Active',
      exp_date: String(expDate),
      is_trial: '0',
      active_cons: activeCons,
      created_at: String(createdAt),
      max_connections: line.connections,
      allowed_output_formats: ['m3u8', 'ts', 'rtmp'],
      auth: 1,
      message: '',
    },
    server_info: getServerInfo(baseUrl),
  });
});

export const getXmltv = asyncHandler(async (req: Request, res: Response) => {
  const { line } = await authenticateLineFromQuery(req);
  if (!line.packageId) {
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><tv></tv>`);
  }

  const pkgBouquets = await prisma.corePackageBouquet.findMany({
    where: { packageId: line.packageId },
    select: { bouquetId: true },
  });
  const bouquetIds = pkgBouquets.map(b => b.bouquetId);
  if (!bouquetIds.length) {
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><tv></tv>`);
  }

  const liveStreams = await prisma.coreBouquetStream.findMany({
    where: {
      bouquetId: { in: bouquetIds },
      bouquet: { isActive: true },
      stream: { isActive: true },
    },
    include: {
      stream: { select: { name: true, epgChannelId: true } },
    },
  });

  const channelIds = Array.from(new Set(liveStreams.map(s => s.stream.epgChannelId).filter(Boolean) as string[]));
  const channelNameFallback = new Map<string, string>();
  for (const s of liveStreams) {
    if (s.stream.epgChannelId) channelNameFallback.set(s.stream.epgChannelId, s.stream.name);
  }

  const channels = channelIds.length
    ? await prisma.coreEpgChannel.findMany({
        where: { ownerId: line.ownerId, channelId: { in: channelIds } },
        select: { channelId: true, displayName: true },
      })
    : [];
  const channelName = new Map(channels.map(c => [c.channelId, c.displayName] as const));

  const now = new Date();
  const from = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const to = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

  const programmes = channelIds.length
    ? await prisma.coreEpgProgram.findMany({
        where: {
          ownerId: line.ownerId,
          channelId: { in: channelIds },
          startAt: { lt: to },
          endAt: { gt: from },
        },
        orderBy: [{ startAt: 'asc' }],
        take: 20000,
        select: { channelId: true, startAt: true, endAt: true, title: true, description: true },
      })
    : [];

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<tv generator-info-name="PainelMaster Core">\n`;
  for (const chId of channelIds) {
    const name = channelName.get(chId) || channelNameFallback.get(chId) || chId;
    xml += `  <channel id="${escapeXml(chId)}"><display-name>${escapeXml(name)}</display-name></channel>\n`;
  }
  for (const p of programmes) {
    xml += `  <programme start="${formatXmltvDate(p.startAt)}" stop="${formatXmltvDate(p.endAt)}" channel="${escapeXml(p.channelId)}">`;
    xml += `<title>${escapeXml(p.title)}</title>`;
    if (p.description) xml += `<desc>${escapeXml(p.description)}</desc>`;
    xml += `</programme>\n`;
  }
  xml += `</tv>`;

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.status(200).send(xml);
});

export const redirectLiveStream = asyncHandler(async (req: Request, res: Response) => {
  const username = typeof req.params.username === 'string' ? req.params.username : '';
  const password = typeof req.params.password === 'string' ? req.params.password : '';
  const streamIdRaw = typeof req.params.streamId === 'string' ? req.params.streamId : '';
  const ext = typeof req.params.ext === 'string' ? req.params.ext : 'ts';
  const extLower = ext.trim().toLowerCase() || 'ts';

  const { line } = await authenticateLineFromParams(username, password);

  if (!line.packageId) throw new AppError(403, 'Linha sem pacote');

  const streamPublicId = parseInt(streamIdRaw, 10);
  if (!Number.isFinite(streamPublicId)) throw new AppError(400, 'streamId inválido');

  const stream = await prisma.coreStream.findFirst({
    where: { publicId: streamPublicId, isActive: true },
    select: { id: true, streamUrl: true },
  });
  if (!stream) throw new AppError(404, 'Stream não encontrada');

  const allowedBouquets = await prisma.corePackageBouquet.findMany({
    where: { packageId: line.packageId },
    include: { bouquet: { select: { id: true, isActive: true } } },
  });
  const allowedBouquetIds = allowedBouquets.filter(b => b.bouquet.isActive).map(b => b.bouquet.id);
  if (!allowedBouquetIds.length) throw new AppError(404, 'Sem acesso a bouquets');

  const allowed = await prisma.coreBouquetStream.findFirst({
    where: {
      streamId: stream.id,
      bouquetId: { in: allowedBouquetIds },
      bouquet: { isActive: true },
      stream: { isActive: true },
    },
    select: { streamId: true },
  });

  if (!allowed) throw new AppError(404, 'Sem acesso a esta stream');

  const redirected = await maybeRedirectToEdge(req, res, line.ownerId, stream.id, `${line.id}|live|${streamPublicId}`);
  if (redirected) return;

  const ipAddress = getClientIp(req);
  const userAgent = (req.headers['user-agent'] as string | undefined) || null;
  const serverHost = ((req.headers['x-forwarded-host'] as string | undefined) || req.get('host') || '') || null;

  if (extLower === 'm3u8') {
    const sessionId = await createPlaybackSession({
      lineId: line.id,
      maxConnections: line.connections,
      contentType: 'live',
      contentPublicId: streamPublicId,
      ipAddress,
      userAgent,
      serverHost,
    });

    const headers: Record<string, string> = {};
    const passHeaders = ['user-agent', 'accept', 'accept-language', 'accept-encoding', 'referer', 'origin', 'connection'];
    for (const h of passHeaders) {
      const v = req.headers[h];
      if (typeof v === 'string' && v) headers[h] = v;
    }

    const candidates = parseUpstreamCandidates(stream.streamUrl);
    const effective = candidates.length ? candidates : [stream.streamUrl.trim()];
    const minute = Math.floor(Date.now() / 60_000);
    const start = pickCandidateStartIndex(`${line.id}|${streamPublicId}|${minute}|m3u8`, effective.length);

    const baseUrl = await getOwnerBaseUrl(req, line.ownerId);
    const proxyBase = `${stripApiSuffix(baseUrl)}${getXcPrefix(req)}`;

    let lastErr: any = null;
    for (let i = 0; i < effective.length; i++) {
      const src = effective[(start + i) % effective.length];
      const m = src.match(/^(.*?)(\/live\/([^/]+)\/([^/]+)\/(\d+))(?:\.[a-z0-9]+)?/i);
      const urlToFetch = m
        ? `${m[1]}/live/${encodeURIComponent(m[3])}/${encodeURIComponent(m[4])}/${encodeURIComponent(m[5])}.m3u8`
        : src;

      try {
        const upstream = await axios.request({
          url: urlToFetch,
          method: 'GET',
          responseType: 'text',
          headers,
          timeout: 30000,
          maxRedirects: 5,
          validateStatus: () => true,
        });
        if (upstream.status >= 400) throw new AppError(502, `Upstream retornou ${upstream.status}`);

        const body = rewriteM3u8(String(upstream.data || ''), urlToFetch, proxyBase, sessionId);
        await prisma.corePlaybackSession.updateMany({
          where: { id: sessionId, endedAt: null, status: 'active' },
          data: { lastSeenAt: new Date() },
        });

        res.status(200);
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader(
          'Content-Type',
          typeof upstream.headers?.['content-type'] === 'string' && upstream.headers['content-type']
            ? upstream.headers['content-type']
            : 'application/vnd.apple.mpegurl; charset=utf-8'
        );
        res.send(body);
        return;
      } catch (e: any) {
        lastErr = e;
      }
    }

    throw lastErr || new AppError(502, 'Upstream indisponível');
  }

  const release = acquireConnectionSlot(line.id, line.connections);
  if (!release) throw new AppError(429, 'Limite de conexões atingido');

  let sessionId = '';
  try {
    sessionId = await createPlaybackSession({
      lineId: line.id,
      maxConnections: line.connections,
      contentType: 'live',
      contentPublicId: streamPublicId,
      ipAddress,
      userAgent,
      serverHost,
    });
  } catch (e) {
    try { release(); } catch {}
    throw e;
  }

  const candidates = parseUpstreamCandidates(stream.streamUrl);
  const effective = candidates.length ? candidates : [stream.streamUrl.trim()];
  const minute = Math.floor(Date.now() / 60_000);
  const start = pickCandidateStartIndex(`${line.id}|${streamPublicId}|${minute}|${extLower}`, effective.length);

  let chosenUrl = '';
  for (let i = 0; i < effective.length; i++) {
    const src = effective[(start + i) % effective.length];
    const m = src.match(/^(.*?)(\/live\/([^/]+)\/([^/]+)\/(\d+))(?:\.[a-z0-9]+)?/i);
    const urlToUse = m
      ? `${m[1]}/live/${encodeURIComponent(m[3])}/${encodeURIComponent(m[4])}/${encodeURIComponent(m[5])}.${encodeURIComponent(extLower)}`
      : src;

    const ok = await probeUpstreamUrl(req, urlToUse);
    if (ok) {
      chosenUrl = urlToUse;
      break;
    }
  }

  if (!chosenUrl) {
    try { release(); } catch {}
    throw new AppError(502, 'Upstream indisponível');
  }

  await proxyUpstream(req, res, chosenUrl, release, sessionId);
});

export const proxyHls = asyncHandler(async (req: Request, res: Response) => {
  const sessionId = typeof req.params.sessionId === 'string' ? req.params.sessionId : '';
  const targetRaw = typeof req.query.u === 'string' ? req.query.u : '';

  if (!sessionId) throw new AppError(400, 'sessionId é obrigatório');
  if (!targetRaw) throw new AppError(400, 'u é obrigatório');

  const session = await prisma.corePlaybackSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      lineId: true,
      contentType: true,
      contentPublicId: true,
      ipAddress: true,
      status: true,
      endedAt: true,
    },
  });
  if (!session || session.endedAt || session.status !== 'active') throw new AppError(410, 'Sessão inválida');
  if (session.contentType !== 'live') throw new AppError(400, 'Sessão não suporta HLS');
  if (!session.contentPublicId) throw new AppError(400, 'Sessão sem conteúdo');

  const line = await prisma.coreLine.findUnique({
    where: { id: session.lineId },
    select: { id: true, status: true, expiresAt: true },
  });
  if (!line) throw new AppError(410, 'Sessão inválida');
  if (line.status !== 'ACTIVE') throw new AppError(403, 'Linha desativada');
  if (line.expiresAt.getTime() <= Date.now()) throw new AppError(403, 'Linha expirada');

  const ipAddress = getClientIp(req);
  if (session.ipAddress && ipAddress && session.ipAddress !== ipAddress) throw new AppError(429, 'Sessão em uso por outro IP');

  let targetUrl = '';
  try {
    targetUrl = new URL(targetRaw).toString();
  } catch {
    throw new AppError(400, 'u inválido');
  }

  const stream = await prisma.coreStream.findFirst({
    where: { publicId: session.contentPublicId, isActive: true },
    select: { streamUrl: true },
  });
  if (!stream) throw new AppError(404, 'Stream não encontrada');

  const candidates = parseUpstreamCandidates(stream.streamUrl);
  const effective = candidates.length ? candidates : [stream.streamUrl.trim()];
  const allowedOrigins = new Set<string>();
  for (const src of effective) {
    let base = src;
    const m = src.match(/^(.*?)(\/live\/[^/]+\/[^/]+\/\d+)(?:\.[a-z0-9]+)?/i);
    if (m) base = m[1];
    try {
      const origin = new URL(base).origin;
      if (origin) allowedOrigins.add(origin);
    } catch {}
  }

  let targetOrigin = '';
  try {
    targetOrigin = new URL(targetUrl).origin;
  } catch {
    targetOrigin = '';
  }
  if (!targetOrigin || !allowedOrigins.has(targetOrigin)) throw new AppError(400, 'Upstream não permitido');

  const headers: Record<string, string> = {};
  const passHeaders = ['range', 'user-agent', 'accept', 'accept-language', 'accept-encoding', 'referer', 'origin', 'connection'];
  for (const h of passHeaders) {
    const v = req.headers[h];
    if (typeof v === 'string' && v) headers[h] = v;
  }

  const wantText = /\.m3u8(\?|$)/i.test(targetUrl);
  const upstream = await axios.request({
    url: targetUrl,
    method: 'GET',
    responseType: wantText ? 'text' : 'stream',
    headers,
    timeout: 30000,
    maxRedirects: 5,
    validateStatus: () => true,
  });
  if (upstream.status >= 400) throw new AppError(502, `Upstream retornou ${upstream.status}`);

  const now = new Date();
  if (!session.ipAddress && ipAddress) {
    await prisma.corePlaybackSession.updateMany({
      where: { id: session.id, endedAt: null, status: 'active' },
      data: { ipAddress, lastSeenAt: now },
    });
  } else {
    await prisma.corePlaybackSession.updateMany({
      where: { id: session.id, endedAt: null, status: 'active' },
      data: { lastSeenAt: now },
    });
  }

  const contentType = upstream.headers?.['content-type'];
  if (wantText) {
    const bodyText = String(upstream.data || '');
    const proxyBase = `${getRequestBaseUrl(req)}${getXcPrefix(req)}`;
    const rewritten = rewriteM3u8(bodyText, targetUrl, proxyBase, session.id);

    res.status(200);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Type',
      typeof contentType === 'string' && contentType ? contentType : 'application/vnd.apple.mpegurl; charset=utf-8'
    );
    res.send(rewritten);
    return;
  }

  res.status(upstream.status);
  res.setHeader('Cache-Control', 'no-store');

  const allowlisted = new Set(['content-type', 'content-length', 'accept-ranges', 'content-range', 'etag', 'last-modified']);
  for (const [k, v] of Object.entries(upstream.headers || {})) {
    const key = k.toLowerCase();
    if (!allowlisted.has(key)) continue;
    if (typeof v === 'string') res.setHeader(k, v);
  }

  let bytesSent = 0n;
  const counter = new PassThrough();
  counter.on('data', (chunk: any) => {
    if (chunk?.length) bytesSent += BigInt(chunk.length);
  });

  await pipeline(upstream.data, counter, res);

  await prisma.corePlaybackSession.updateMany({
    where: { id: session.id, endedAt: null, status: 'active' },
    data: { lastSeenAt: new Date(), bytesSent: { increment: bytesSent } },
  });
});

export const redirectTimeshiftStream = asyncHandler(async (req: Request, res: Response) => {
  const username = typeof req.params.username === 'string' ? req.params.username : '';
  const password = typeof req.params.password === 'string' ? req.params.password : '';
  const duration = typeof req.params.duration === 'string' ? req.params.duration : '';
  const start = typeof req.params.start === 'string' ? req.params.start : '';
  const streamIdRaw = typeof req.params.streamId === 'string' ? req.params.streamId : '';
  const ext = typeof req.params.ext === 'string' ? req.params.ext : 'ts';

  const { line } = await authenticateLineFromParams(username, password);
  if (!line.packageId) throw new AppError(403, 'Linha sem pacote');

  const streamPublicId = parseInt(streamIdRaw, 10);
  if (!Number.isFinite(streamPublicId)) throw new AppError(400, 'streamId inválido');

  const stream = await prisma.coreStream.findFirst({
    where: { publicId: streamPublicId, isActive: true },
    select: { id: true, streamUrl: true, tvArchive: true },
  });
  if (!stream) throw new AppError(404, 'Stream não encontrada');
  if (!stream.tvArchive) throw new AppError(400, 'Catchup não habilitado para esta stream');

  const allowedBouquets = await prisma.corePackageBouquet.findMany({
    where: { packageId: line.packageId },
    include: { bouquet: { select: { id: true, isActive: true } } },
  });
  const allowedBouquetIds = allowedBouquets.filter(b => b.bouquet.isActive).map(b => b.bouquet.id);
  if (!allowedBouquetIds.length) throw new AppError(404, 'Sem acesso a bouquets');

  const allowed = await prisma.coreBouquetStream.findFirst({
    where: {
      streamId: stream.id,
      bouquetId: { in: allowedBouquetIds },
      bouquet: { isActive: true },
      stream: { isActive: true },
    },
    select: { streamId: true },
  });
  if (!allowed) throw new AppError(404, 'Sem acesso a esta stream');

  const redirected = await maybeRedirectToEdge(req, res, line.ownerId, stream.id, `${line.id}|timeshift|${streamPublicId}`);
  if (redirected) return;

  const release = acquireConnectionSlot(line.id, line.connections);
  if (!release) throw new AppError(429, 'Limite de conexões atingido');

  const ipAddress = getClientIp(req);
  const userAgent = (req.headers['user-agent'] as string | undefined) || null;
  const serverHost = ((req.headers['x-forwarded-host'] as string | undefined) || req.get('host') || '') || null;
  const sessionId = await createPlaybackSession({
    lineId: line.id,
    maxConnections: line.connections,
    contentType: 'timeshift',
    contentPublicId: streamPublicId,
    ipAddress,
    userAgent,
    serverHost,
  });

  const candidates = parseUpstreamCandidates(stream.streamUrl);
  const effective = candidates.length ? candidates : [stream.streamUrl.trim()];
  const minute = Math.floor(Date.now() / 60_000);
  const startIdx = pickCandidateStartIndex(`${line.id}|${streamPublicId}|${minute}|timeshift`, effective.length);

  let chosenUrl = '';
  for (let i = 0; i < effective.length; i++) {
    const raw = effective[(startIdx + i) % effective.length];
    const m = raw.match(/^(.*?)(\/live\/([^/]+)\/([^/]+)\/(\d+))(?:\.[a-z0-9]+)?/i);
    if (!m) continue;

    const base = m[1];
    const upUser = m[3];
    const upPass = m[4];
    const upStreamId = m[5];
    const targetUrl = `${base}/timeshift/${encodeURIComponent(upUser)}/${encodeURIComponent(upPass)}/${encodeURIComponent(
      duration
    )}/${encodeURIComponent(start)}/${encodeURIComponent(upStreamId)}.${encodeURIComponent(ext)}`;

    const ok = await probeUpstreamUrl(req, targetUrl);
    if (ok) {
      chosenUrl = targetUrl;
      break;
    }
  }

  if (!chosenUrl) {
    try { release(); } catch {}
    throw new AppError(400, 'URL da stream não suporta timeshift automático');
  }

  await proxyUpstream(req, res, chosenUrl, release, sessionId);
});

export const redirectMovieStream = asyncHandler(async (req: Request, res: Response) => {
  const username = typeof req.params.username === 'string' ? req.params.username : '';
  const password = typeof req.params.password === 'string' ? req.params.password : '';
  const vodIdRaw = typeof req.params.vodId === 'string' ? req.params.vodId : '';
  const ext = typeof req.params.ext === 'string' ? req.params.ext : 'mp4';

  const { line } = await authenticateLineFromParams(username, password);
  if (!line.packageId) throw new AppError(403, 'Linha sem pacote');

  const vodPublicId = parseInt(vodIdRaw, 10);
  if (!Number.isFinite(vodPublicId)) throw new AppError(400, 'vodId inválido');

  const vod = await prisma.coreVodItem.findFirst({
    where: { publicId: vodPublicId, isActive: true },
    select: { id: true, streamUrl: true },
  });
  if (!vod) throw new AppError(404, 'VOD não encontrado');

  const allowedBouquets = await prisma.corePackageBouquet.findMany({
    where: { packageId: line.packageId },
    include: { bouquet: { select: { id: true, isActive: true } } },
  });
  const allowedBouquetIds = allowedBouquets.filter(b => b.bouquet.isActive).map(b => b.bouquet.id);
  if (!allowedBouquetIds.length) throw new AppError(404, 'Sem acesso a bouquets');

  const allowed = await prisma.coreBouquetVodItem.findFirst({
    where: {
      vodItemId: vod.id,
      bouquetId: { in: allowedBouquetIds },
      bouquet: { isActive: true },
      vodItem: { isActive: true },
    },
    select: { vodItemId: true },
  });
  if (!allowed) throw new AppError(404, 'Sem acesso a este VOD');

  const release = acquireConnectionSlot(line.id, line.connections);
  if (!release) throw new AppError(429, 'Limite de conexões atingido');

  const ipAddress = getClientIp(req);
  const userAgent = (req.headers['user-agent'] as string | undefined) || null;
  const serverHost = ((req.headers['x-forwarded-host'] as string | undefined) || req.get('host') || '') || null;
  const sessionId = await createPlaybackSession({
    lineId: line.id,
    maxConnections: line.connections,
    contentType: 'movie',
    contentPublicId: vodPublicId,
    ipAddress,
    userAgent,
    serverHost,
  });

  const candidates = parseUpstreamCandidates(vod.streamUrl);
  const effective = candidates.length ? candidates : [vod.streamUrl.trim()];
  const minute = Math.floor(Date.now() / 60_000);
  const startIdx = pickCandidateStartIndex(`${line.id}|vod|${vodPublicId}|${minute}|${ext}`, effective.length);

  let chosenUrl = '';
  for (let i = 0; i < effective.length; i++) {
    const src = effective[(startIdx + i) % effective.length];
    const m = src.match(/^(.*?)(\/movie\/([^/]+)\/([^/]+)\/(\d+))(?:\.[a-z0-9]+)?/i);
    const targetUrl = m
      ? `${m[1]}/movie/${encodeURIComponent(m[3])}/${encodeURIComponent(m[4])}/${encodeURIComponent(m[5])}.${encodeURIComponent(ext)}`
      : src;

    const ok = await probeUpstreamUrl(req, targetUrl);
    if (ok) {
      chosenUrl = targetUrl;
      break;
    }
  }

  if (!chosenUrl) {
    try { release(); } catch {}
    throw new AppError(502, 'Upstream indisponível');
  }

  await proxyUpstream(req, res, chosenUrl, release, sessionId);
});

export const redirectSeriesEpisodeStream = asyncHandler(async (req: Request, res: Response) => {
  const username = typeof req.params.username === 'string' ? req.params.username : '';
  const password = typeof req.params.password === 'string' ? req.params.password : '';
  const episodeIdRaw = typeof req.params.episodeId === 'string' ? req.params.episodeId : '';
  const ext = typeof req.params.ext === 'string' ? req.params.ext : 'mp4';

  const { line } = await authenticateLineFromParams(username, password);
  if (!line.packageId) throw new AppError(403, 'Linha sem pacote');

  const episodePublicId = parseInt(episodeIdRaw, 10);
  if (!Number.isFinite(episodePublicId)) throw new AppError(400, 'episodeId inválido');

  const ep = await prisma.coreSeriesEpisode.findFirst({
    where: { publicId: episodePublicId, isActive: true, series: { isActive: true } },
    select: { streamUrl: true, seriesId: true },
  });
  if (!ep) throw new AppError(404, 'Episódio não encontrado');

  const allowedBouquets = await prisma.corePackageBouquet.findMany({
    where: { packageId: line.packageId },
    include: { bouquet: { select: { id: true, isActive: true } } },
  });
  const allowedBouquetIds = allowedBouquets.filter(b => b.bouquet.isActive).map(b => b.bouquet.id);
  if (!allowedBouquetIds.length) throw new AppError(404, 'Sem acesso a bouquets');

  const allowed = await prisma.coreBouquetSeries.findFirst({
    where: {
      seriesId: ep.seriesId,
      bouquetId: { in: allowedBouquetIds },
      bouquet: { isActive: true },
      series: { isActive: true },
    },
    select: { seriesId: true },
  });
  if (!allowed) throw new AppError(404, 'Sem acesso a esta série');

  const release = acquireConnectionSlot(line.id, line.connections);
  if (!release) throw new AppError(429, 'Limite de conexões atingido');

  const ipAddress = getClientIp(req);
  const userAgent = (req.headers['user-agent'] as string | undefined) || null;
  const serverHost = ((req.headers['x-forwarded-host'] as string | undefined) || req.get('host') || '') || null;
  const sessionId = await createPlaybackSession({
    lineId: line.id,
    maxConnections: line.connections,
    contentType: 'series',
    contentPublicId: episodePublicId,
    ipAddress,
    userAgent,
    serverHost,
  });

  const candidates = parseUpstreamCandidates(ep.streamUrl);
  const effective = candidates.length ? candidates : [ep.streamUrl.trim()];
  const minute = Math.floor(Date.now() / 60_000);
  const startIdx = pickCandidateStartIndex(`${line.id}|series|${episodePublicId}|${minute}|${ext}`, effective.length);

  let chosenUrl = '';
  for (let i = 0; i < effective.length; i++) {
    const src = effective[(startIdx + i) % effective.length];
    const m = src.match(/^(.*?)(\/series\/([^/]+)\/([^/]+)\/(\d+))(?:\.[a-z0-9]+)?/i);
    const targetUrl = m
      ? `${m[1]}/series/${encodeURIComponent(m[3])}/${encodeURIComponent(m[4])}/${encodeURIComponent(m[5])}.${encodeURIComponent(ext)}`
      : src;

    const ok = await probeUpstreamUrl(req, targetUrl);
    if (ok) {
      chosenUrl = targetUrl;
      break;
    }
  }

  if (!chosenUrl) {
    try { release(); } catch {}
    throw new AppError(502, 'Upstream indisponível');
  }

  await proxyUpstream(req, res, chosenUrl, release, sessionId);
});
