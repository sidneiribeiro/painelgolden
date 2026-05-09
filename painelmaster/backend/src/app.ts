// ===========================================
// CONFIGURAR TIMEZONE DO BRASIL (PRIMEIRA LINHA!)
// ===========================================
process.env.TZ = 'America/Sao_Paulo';

import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';
import { env, isProduction } from './config/env.js';
import { connectDatabase, disconnectDatabase, prisma } from './config/database.js';
import { logger } from './utils/logger.js';
import { loggerMiddleware } from './middleware/logger.middleware.js';
import { errorMiddleware, notFoundMiddleware } from './middleware/error.middleware.js';
import { generalLimiter } from './middleware/rateLimit.middleware.js';
import { startScheduler, stopScheduler } from './jobs/scheduler.js';
import routes from './routes/index.js';
import xcRoutes from './routes/xc.routes.js';
import { socketService } from './services/socket.service.js';
import { tmdbKeyManager } from './services/vod/tmdb-key-manager.service.js';
import { vodEnrichmentWorkerService } from './services/vod/vod-enrichment-worker.service.js';

const app = express();
const httpServer = createServer(app);

// Configurar timeouts para requisições longas (importação de jogos, etc)
httpServer.timeout = 300000; // 5 minutos
httpServer.keepAliveTimeout = 65000; // 65 segundos
httpServer.headersTimeout = 66000; // 66 segundos

// ===========================================
// ARQUIVOS ESTÁTICOS (PRIMEIRO - ANTES DE TUDO!)
// ===========================================

const uploadsDir = join(process.cwd(), 'public', 'uploads');

// Servir arquivos estáticos (ANTES de helmet e outros middlewares!)
app.use('/uploads', express.static(uploadsDir, {
  setHeaders: (res) => {
    res.set('Access-Control-Allow-Origin', '*');
  }
}));
app.use('/api/uploads', express.static(uploadsDir, {
  setHeaders: (res) => {
    res.set('Access-Control-Allow-Origin', '*');
  }
}));

// Servir arquivos de marketing (banners, vídeos, logos)
const storageDir = join(process.cwd(), 'storage');
const promoStorageDir = '/var/www/painel/storage';
app.use('/storage', express.static(storageDir, {
  setHeaders: (res) => {
    res.set('Access-Control-Allow-Origin', '*');
  }
}));
// Servir também de /var/www/painel/storage (vídeos promo, banners futebol)
app.use('/storage', express.static(promoStorageDir, {
  setHeaders: (res) => {
    res.set('Access-Control-Allow-Origin', '*');
  }
}));
// Alias com prefixo /api para frontend que usa VITE_API_URL apontando para /api
app.use('/api/storage', express.static(storageDir, {
  setHeaders: (res) => {
    res.set('Access-Control-Allow-Origin', '*');
  }
}));
app.use('/api/storage', express.static(promoStorageDir, {
  setHeaders: (res) => {
    res.set('Access-Control-Allow-Origin', '*');
  }
}));

// Servir arquivos do diretório public (logo, favicon, etc)
const publicDir = join(process.cwd(), 'public');
app.use(express.static(publicDir, {
  setHeaders: (res) => {
    res.set('Access-Control-Allow-Origin', '*');
  }
}));
// Fallback manual para garantir serviço via /api/storage/* (evita 404 se static falhar)
app.get('/api/storage/*', async (req, res, next) => {
  try {
    logger.debug(`[Static] /api/storage hit: ${req.path}`);
    const relativePath = req.params[0];
    if (!relativePath) return next();
    // Tentar ambos diretórios de storage
    for (const dir of [storageDir, promoStorageDir]) {
      const fullPath = join(dir, relativePath);
      const fileExists = await fs.access(fullPath).then(() => true).catch(() => false);
      if (fileExists) return res.sendFile(fullPath);
    }
    return res.status(404).json({ error: 'Arquivo não encontrado', path: req.path });
  } catch (err) {
    return next(err);
  }
});

// ===========================================
// MIDDLEWARES GLOBAIS
// ===========================================

// Segurança
const enableHsts = String(process.env.ENABLE_HSTS || '').trim().toLowerCase() !== 'false';
app.use(helmet({
  hsts: enableHsts ? { maxAge: 15552000, includeSubDomains: true } : false,
  contentSecurityPolicy: isProduction ? {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  } : false,
  crossOriginEmbedderPolicy: false,
}));

// CORS — origins configuráveis via env ALLOWED_ORIGINS (lista separada por vírgula)
const allowedOrigins = (process.env.ALLOWED_ORIGINS || env.FRONTEND_URL || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: isProduction
    ? (origin, cb) => {
        if (!allowedOrigins.length) return cb(null, false);
        if (!origin) return cb(null, true);

        const normalizedOrigin = origin.replace(/\/$/, '');
        const isAllowed = allowedOrigins.some((raw) => {
          const pattern = raw.replace(/\/$/, '');
          if (pattern === '*') return true;

          try {
            const o = new URL(normalizedOrigin);

            if (pattern.startsWith('http://') || pattern.startsWith('https://')) {
              const p = new URL(pattern);
              if (p.protocol !== o.protocol) return false;
              if (p.host === o.host) return true;
              if (p.hostname.startsWith('*.')) {
                const base = p.hostname.slice(2);
                return o.hostname !== base && o.hostname.endsWith(`.${base}`);
              }
              return false;
            }

            if (pattern.startsWith('*.')) {
              const base = pattern.slice(2);
              return o.hostname !== base && o.hostname.endsWith(`.${base}`);
            }

            return o.hostname === pattern || o.host === pattern;
          } catch {
            return pattern === normalizedOrigin;
          }
        });

        return cb(null, isAllowed);
      }
    : true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Rate limiting
app.use(generalLimiter);

// Logging
app.use(loggerMiddleware);

// Servir arquivos estáticos de uploads/storage (logos, banners, etc)
// /app/storage é montado via volume no docker-compose.yml
app.use('/api/uploads', express.static('/app/storage'));
app.use('/api/storage', express.static('/app/storage'));
// Alias sem /api para URLs antigos salvos como /uploads/... e /storage/...
app.use('/uploads', express.static('/app/storage'));
app.use('/storage',  express.static('/app/storage'));

// Trust proxy (para rate limiting funcionar corretamente atrás de nginx/etc)
app.set('trust proxy', 1);

// ===========================================
// ROTAS
// ===========================================

// Compatibilidade Xtream em raiz (para apps que não aceitam path no DNS)
app.use(xcRoutes);

const isCoreEdgeOnly = process.env.CORE_EDGE_ONLY === 'true';

if (isCoreEdgeOnly) {
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      mode: 'edge',
    });
  });

  let lastCpuSample: { idle: number; total: number; at: number } | null = null;

  const readCpuSample = async () => {
    const text = await fs.readFile('/proc/stat', 'utf8');
    const line = text.split('\n').find((l) => l.startsWith('cpu '));
    if (!line) return null;
    const parts = line.trim().split(/\s+/).slice(1).map((n) => parseInt(n, 10)).filter((n) => Number.isFinite(n));
    if (parts.length < 4) return null;
    const idle = (parts[3] || 0) + (parts[4] || 0);
    const total = parts.reduce((a, b) => a + b, 0);
    return { idle, total, at: Date.now() };
  };

  const readMemPercent = async () => {
    const text = await fs.readFile('/proc/meminfo', 'utf8');
    const getKb = (key: string) => {
      const m = text.match(new RegExp(`^${key}:\\s+(\\d+)\\s+kB$`, 'm'));
      return m ? parseInt(m[1], 10) : 0;
    };
    const total = getKb('MemTotal');
    const available = getKb('MemAvailable');
    if (!total) return null;
    const used = Math.max(0, total - available);
    return Math.max(0, Math.min(100, (used / total) * 100));
  };

  const readNetBytes = async () => {
    const text = await fs.readFile('/proc/net/dev', 'utf8');
    const lines = text.split('\n').slice(2).map((l) => l.trim()).filter(Boolean);
    let rx = 0n;
    let tx = 0n;
    for (const l of lines) {
      const [ifacePart, rest] = l.split(':');
      const iface = (ifacePart || '').trim();
      if (!iface || iface === 'lo') continue;
      const cols = (rest || '').trim().split(/\s+/);
      if (cols.length < 16) continue;
      const rxBytes = BigInt(cols[0] || '0');
      const txBytes = BigInt(cols[8] || '0');
      rx += rxBytes;
      tx += txBytes;
    }
    return { rxBytes: rx.toString(), txBytes: tx.toString() };
  };

  app.get('/api/edge/metrics', async (req, res) => {
    const envToken = (process.env.EDGE_TOKEN || '').trim();
    const token = String(req.headers['x-edge-token'] || '').trim();
    if (envToken && token !== envToken) {
      return res.status(403).json({ error: 'Token inválido' });
    }

    const hostHeader = String(req.headers['x-forwarded-host'] || req.headers.host || '').trim();
    const now = new Date();
    const freshAfter = new Date(Date.now() - 90_000);
    const staleWindowAfter = new Date(Date.now() - 30 * 60_000);

    const [cpuNow, memPercent, net, activeSessions, distinctLines, staleSessions] = await Promise.all([
      readCpuSample().catch(() => null),
      readMemPercent().catch(() => null),
      readNetBytes().catch(() => null),
      prisma.corePlaybackSession
        .count({
          where: {
            endedAt: null,
            status: 'active',
            lastSeenAt: { gt: freshAfter },
            ...(hostHeader ? { serverHost: hostHeader } : {}),
          },
        })
        .catch(() => null),
      prisma.corePlaybackSession
        .findMany({
          where: {
            endedAt: null,
            status: 'active',
            lastSeenAt: { gt: freshAfter },
            ...(hostHeader ? { serverHost: hostHeader } : {}),
          },
          distinct: ['lineId'],
          select: { lineId: true },
        })
        .then((rows) => rows.length)
        .catch(() => null),
      prisma.corePlaybackSession
        .count({
          where: {
            endedAt: null,
            status: 'active',
            lastSeenAt: { lte: freshAfter, gt: staleWindowAfter },
            ...(hostHeader ? { serverHost: hostHeader } : {}),
          },
        })
        .catch(() => null),
    ]);

    let cpuPercent: number | null = null;
    if (cpuNow) {
      if (lastCpuSample) {
        const idleDelta = cpuNow.idle - lastCpuSample.idle;
        const totalDelta = cpuNow.total - lastCpuSample.total;
        if (totalDelta > 0) {
          const usage = 1 - idleDelta / totalDelta;
          cpuPercent = Math.max(0, Math.min(100, usage * 100));
        }
      }
      lastCpuSample = cpuNow;
    }

    res.json({
      data: {
        timestamp: now.toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        cpuPercent,
        memPercent,
        net,
        activeConnections: typeof activeSessions === 'number' ? activeSessions : null,
        activeUsers: typeof distinctLines === 'number' ? distinctLines : null,
        flowsOn: typeof activeSessions === 'number' ? activeSessions : null,
        flowsOff: typeof staleSessions === 'number' ? staleSessions : null,
        host: hostHeader || null,
      },
    });
  });
} else {
  app.use('/api', routes);
}

// ===========================================
// HANDLERS DE ERRO
// ===========================================

app.use(notFoundMiddleware);
app.use(errorMiddleware);

// ===========================================
// INICIALIZAÇÃO
// ===========================================

async function start() {
  try {
    
    // Conecta ao banco
    await connectDatabase();
    
    if (!isCoreEdgeOnly) {
      // Inicializa gerenciador de chaves TMDB
      await tmdbKeyManager.initialize();

      // Inicia scheduler de jobs (agora é async para inicializar agendamentos VOD)
      await startScheduler();

      // Inicializa Socket.io
      socketService.initialize(httpServer);

      // Inicia worker de enriquecimento TMDB (background)
      vodEnrichmentWorkerService.start();
    }

    // Inicia servidor HTTP
    httpServer.listen(env.PORT, '0.0.0.0', () => {
      logger.info(`
╔═══════════════════════════════════════════════════════════╗
║                   PAINEL IPTV - BACKEND                   ║
╠═══════════════════════════════════════════════════════════╣
║  🚀 Servidor rodando em: http://0.0.0.0:${env.PORT}             ║
║  📊 Ambiente: ${env.NODE_ENV.padEnd(42)}║
║  🔐 CORS: ${(isProduction ? env.FRONTEND_URL : 'Liberado').padEnd(46)}║
║  🔌 Socket.io: Ativo                                       ║
╚═══════════════════════════════════════════════════════════╝
      `);
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`Recebido ${signal}. Encerrando...`);
      
      httpServer.close(async () => {
        if (!isCoreEdgeOnly) {
          stopScheduler();
          vodEnrichmentWorkerService.stop();
        }
        await disconnectDatabase();
        logger.info('Servidor encerrado com sucesso');
        process.exit(0);
      });

      // Força encerramento após 10s
      setTimeout(() => {
        logger.error('Forçando encerramento...');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    logger.error({ error }, 'Erro ao iniciar servidor');
    process.exit(1);
  }
}

start();

export default app;
