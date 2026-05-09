import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { asyncHandler } from '../middleware/error.middleware.js';
import { XUIClient } from '../services/xui.client.js';
import { decrypt, encrypt } from '../utils/crypto.js';
import crypto from 'crypto';
import ssh2Pkg from 'ssh2';

const { Client: SSHClient } = ssh2Pkg as any;

// Helper para criar cliente XUI a partir de servidor
// O construtor XUIClient já faz a descriptografia internamente
function createXuiClientFromServer(server: any): XUIClient {
  return new XUIClient(server);
}

type BalancerJobStatus = 'processing' | 'completed' | 'failed' | 'canceled';
interface BalancerJob {
  status: BalancerJobStatus;
  serverId: string;
  installType: 'MAIN' | 'LB' | 'CUSTOM';
  startedAt: Date;
  finishedAt?: Date;
  logs: string[];
  error?: string;
}

const balancerJobs = new Map<string, BalancerJob>();
const balancerJobConnections = new Map<string, any>();

function addBalancerJobLog(jobId: string, message: string) {
  const job = balancerJobs.get(jobId);
  if (!job) return;
  const timestamp = new Date().toLocaleTimeString('pt-BR');
  job.logs.push(`[${timestamp}] ${message}`);
  if (job.logs.length > 3000) {
    job.logs.splice(0, job.logs.length - 3000);
  }
}

function cleanupOldBalancerJobs() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  for (const [id, job] of balancerJobs.entries()) {
    if (job.startedAt < oneHourAgo) {
      balancerJobs.delete(id);
      const conn = balancerJobConnections.get(id);
      if (conn) {
        try { conn.end(); } catch {}
      }
      balancerJobConnections.delete(id);
    }
  }
}

function detectInstallType(stdin: string, command: string): 'MAIN' | 'LB' | 'CUSTOM' {
  const firstLine = (stdin || '').split(/\r?\n/)[0]?.trim().toUpperCase();
  if (firstLine === 'MAIN') return 'MAIN';
  if (firstLine === 'LB') return 'LB';
  if ((command || '').toLowerCase().includes('install.py')) return 'CUSTOM';
  return 'CUSTOM';
}

function extractMainMysqlPasswordFromLogs(logs: string[]): string | null {
  const idx = logs.findIndex((l) => l.includes('Please store your MySQL password!'));
  if (idx < 0) return null;
  for (let i = idx + 1; i < Math.min(idx + 25, logs.length); i++) {
    const match = logs[i].match(/\b[A-Za-z0-9]{16}\b/);
    if (match) return match[0];
  }
  return null;
}

/**
 * GET /api/servers
 * Listar servidores com pacotes (formato PainelNeo)
 */
export const listServers = asyncHandler(async (req: Request, res: Response) => {
  try {
    const servers = await prisma.xuiServer.findMany({
      where: { isActive: true },
      include: {
        packages: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    res.json({
      data: servers.map(s => ({
        id: s.id,
        name: s.name,
        baseUrl: s.baseUrl,
        dns: s.dnsPrimary,
        dns_list: s.dnsList,
        status: s.status,
        packages: s.packages.map(p => ({
          id: p.id,
          server_id: s.id,
          server_package_id: p.xuiPackageId,
          server: s.name,
          name: p.name,
          is_trial: p.isTrial ? 'YES' : 'NO',
          duration: p.duration,
          duration_in: p.durationUnit,
          credits: p.credits,
          plan_price: p.planPrice,
          template: p.template,
          bouquets: p.bouquets,
          connections: p.connections,
        })),
      })),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/servers/status
 */
export const getServersStatus = asyncHandler(async (req: Request, res: Response) => {
  try {
    const servers = await prisma.xuiServer.findMany({ where: { isActive: true } });
    const results = [];
    
    for (const server of servers) {
      try {
        const client = createXuiClientFromServer(server);
        const info = await client.getUserInfo();
        results.push({
          id: server.id,
          name: server.name,
          status: 'ONLINE',
          credits: info?.data?.credits || info?.credits || 0,
        });
      } catch (error) {
        results.push({
          id: server.id,
          name: server.name,
          status: 'OFFLINE',
          error: 'Falha na conexão',
        });
      }
    }
    
    res.json({ data: results });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/servers/:id/bouquets
 * Buscar bouquets de um servidor
 */
export const getServerBouquets = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const server = await prisma.xuiServer.findUnique({
      where: { id },
    });

    if (!server) {
      return res.status(404).json({ error: 'Servidor não encontrado' });
    }

    const xuiClient = createXuiClientFromServer(server);
    
    // Buscar bouquets do banco local primeiro
    const localBouquets = await prisma.bouquet.findMany({
      where: { serverId: server.id },
    });

    if (localBouquets.length > 0) {
      return res.json(localBouquets.map(b => ({
        id: String(b.id),
        name: b.name,
      })));
    }

    // Se não tiver no banco, buscar do XUI
    try {
      const xuiBouquets = await xuiClient.getBouquets();
      res.json(xuiBouquets.map((b: any) => ({
        id: String(b.id),
        name: b.bouquet_name || b.name,
      })));
    } catch (error) {
      res.json([]);
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/servers/:id/content
 */
export const getServerContent = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const server = await prisma.xuiServer.findUnique({ where: { id } });
    if (!server) {
      return res.status(404).json({ error: 'Servidor não encontrado' });
    }
    
    const client = createXuiClientFromServer(server);
    
    // Buscar pacotes e bouquets
    const [packages, bouquets] = await Promise.all([
      client.getPackages(),
      client.getBouquets(),
    ]);
    
    res.json({
      packages: packages || [],
      bouquets: bouquets || [],
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export const installBalancer = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const commandFromBody = typeof req.body?.command === 'string' ? req.body.command.trim() : '';
  const stdinFromBody = typeof req.body?.stdin === 'string' ? req.body.stdin : '';
  const command = commandFromBody.length > 0
    ? commandFromBody
    : `wget https://github.com/dOC4eVER/ubuntu20.04/raw/master/sub_install.sh -O /tmp/sub_install.sh && bash /tmp/sub_install.sh`;

  const server = await prisma.xuiServer.findUnique({ where: { id } });
  if (!server) {
    return res.status(404).json({ error: 'Servidor não encontrado' });
  }

  if (!server.sshHost) {
    return res.status(400).json({ error: 'SSH não configurado neste servidor (sshHost)' });
  }

  if (!server.sshUser) {
    return res.status(400).json({ error: 'SSH não configurado neste servidor (sshUser)' });
  }

  if (!server.sshPassword && !server.sshKey) {
    return res.status(400).json({ error: 'SSH não configurado neste servidor (sshPassword ou sshKey)' });
  }

  const jobId = `balancer-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  balancerJobs.set(jobId, {
    status: 'processing',
    serverId: server.id,
    installType: detectInstallType(stdinFromBody, command),
    startedAt: new Date(),
    logs: [],
  });

  addBalancerJobLog(jobId, `🚀 Iniciando instalação do balance no servidor: ${server.name}`);
  addBalancerJobLog(jobId, `🖥️ SSH: ${server.sshUser}@${server.sshHost}:${server.sshPort || 22}`);
  addBalancerJobLog(jobId, `🧾 Comando iniciado`);

  res.json({ success: true, jobId });

  const ssh = new SSHClient();
  balancerJobConnections.set(jobId, ssh);

  const sshPassword = server.sshPassword ? decrypt(server.sshPassword) : undefined;
  const sshKey = server.sshKey ? decrypt(server.sshKey) : undefined;

  const finish = async (status: BalancerJobStatus, error?: string) => {
    const job = balancerJobs.get(jobId);
    if (!job) return;
    job.status = status;
    job.finishedAt = new Date();
    if (error) job.error = error;
    balancerJobs.set(jobId, job);

    if (status === 'completed' && job.installType === 'MAIN') {
      const password = extractMainMysqlPasswordFromLogs(job.logs || []);
      if (password) {
        try {
          await prisma.xuiServer.update({
            where: { id: server.id },
            data: {
              dbPort: 7999,
              dbName: 'xtream_iptvpro',
              dbUser: 'user_iptvpro',
              dbPassword: encrypt(password),
              dbHost: server.dbHost || server.sshHost || undefined,
            },
          });
          addBalancerJobLog(jobId, '🔐 Credenciais do banco detectadas e salvas no servidor (dbPassword)');
        } catch {
          addBalancerJobLog(jobId, '⚠️ Não foi possível salvar as credenciais do banco automaticamente');
        }
      }
    }

    const conn = balancerJobConnections.get(jobId);
    if (conn) {
      try { conn.end(); } catch {}
    }
    balancerJobConnections.delete(jobId);
    cleanupOldBalancerJobs();
  };

  try {
    ssh.on('ready', () => {
      addBalancerJobLog(jobId, '✅ Conectado via SSH');
      ssh.exec(command, { pty: true }, (err: any, stream: any) => {
        if (err) {
          addBalancerJobLog(jobId, `❌ Falha ao executar comando: ${err.message || err}`);
          void finish('failed', err.message || String(err));
          return;
        }

        if (stdinFromBody && stdinFromBody.length > 0) {
          try {
            stream.write(stdinFromBody.endsWith('\n') ? stdinFromBody : `${stdinFromBody}\n`);
          } catch {}
        }

        stream.on('data', (data: Buffer) => {
          const text = data.toString('utf8');
          for (const line of text.split(/\r?\n/)) {
            if (line.trim().length > 0) addBalancerJobLog(jobId, line);
          }
        });

        stream.stderr.on('data', (data: Buffer) => {
          const text = data.toString('utf8');
          for (const line of text.split(/\r?\n/)) {
            if (line.trim().length > 0) addBalancerJobLog(jobId, line);
          }
        });

        stream.on('close', (code: number) => {
          if (code === 0) {
            addBalancerJobLog(jobId, '✅ Instalação finalizada com sucesso');
            void finish('completed');
          } else {
            addBalancerJobLog(jobId, `❌ Instalação finalizada com erro (exit code ${code})`);
            void finish('failed', `Exit code ${code}`);
          }
        });
      });
    });

    ssh.on('error', (err: any) => {
      addBalancerJobLog(jobId, `❌ Erro SSH: ${err?.message || err}`);
      void finish('failed', err?.message || String(err));
    });

    ssh.on('end', () => {
      const job = balancerJobs.get(jobId);
      if (job && job.status === 'processing') {
        addBalancerJobLog(jobId, '⚠️ Conexão SSH encerrada');
      }
    });

    ssh.connect({
      host: server.sshHost,
      port: server.sshPort || 22,
      username: server.sshUser,
      password: sshPassword,
      privateKey: sshKey,
      readyTimeout: 20000,
      keepaliveInterval: 10000,
    } as any);
  } catch (e: any) {
    addBalancerJobLog(jobId, `❌ Erro: ${e?.message || e}`);
    void finish('failed', e?.message || String(e));
  }
});

export const getBalancerJob = asyncHandler(async (req: Request, res: Response) => {
  const { jobId } = req.params;
  const job = balancerJobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job não encontrado ou expirado' });
  }
  res.json({
    jobId,
    status: job.status,
    logs: job.logs || [],
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
  });
});

export const cancelBalancerJob = asyncHandler(async (req: Request, res: Response) => {
  const { jobId } = req.params;
  const job = balancerJobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job não encontrado ou expirado' });
  }

  if (job.status !== 'processing') {
    return res.json({ success: true });
  }

  addBalancerJobLog(jobId, '⛔ Cancelando...');
  const conn = balancerJobConnections.get(jobId);
  if (conn) {
    try { conn.end(); } catch {}
  }
  job.status = 'canceled';
  job.finishedAt = new Date();
  balancerJobs.set(jobId, job);
  balancerJobConnections.delete(jobId);
  cleanupOldBalancerJobs();

  res.json({ success: true });
});
