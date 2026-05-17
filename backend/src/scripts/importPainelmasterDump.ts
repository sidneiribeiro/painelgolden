import { PrismaClient } from '@prisma/client';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../utils/logger.js';
import { prisma } from '../config/database.js';

const logger = createLogger('ImportDump');
const execFileAsync = promisify(execFile);

type ImportResult = {
  tempDb: string;
  users: { found: number; created: number; updated: number; skipped: number; errors: number };
  servers: { found: number; created: number; updated: number; skipped: number; errors: number };
  customers: { found: number; created: number; updated: number; skipped: number; errors: number };
  core: {
    streams: { found: number; created: number; updated: number; skipped: number; errors: number };
    bouquets: { found: number; created: number; updated: number; skipped: number; errors: number };
    bouquetStreams: { found: number; created: number; skipped: number; errors: number };
    edgeServers: { found: number; created: number; updated: number; skipped: number; errors: number };
    streamEdgeServers: { found: number; created: number; skipped: number; errors: number };
  };
};

function resolveBackupDir(): string {
  const envDir = String(process.env.BACKUP_DIR || '').trim();
  if (envDir) return envDir;
  return path.join(process.cwd(), 'storage', 'backups');
}

function isValidDumpFilename(filename: string): boolean {
  if (!filename) return false;
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) return false;
  return filename.endsWith('.dump') || filename.endsWith('.sql') || filename.endsWith('.backup');
}

function parsePostgresUrl(url: string): { host: string; port: number; database: string; user: string; password: string } {
  const u = new URL(url);
  const database = (u.pathname || '').replace(/^\//, '').split('?')[0];
  if (!database || !u.username) throw new Error('URL de conexão PostgreSQL inválida');
  return {
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password || ''),
    host: u.hostname || 'localhost',
    port: u.port ? parseInt(u.port, 10) : 5432,
    database,
  };
}

function buildDatabaseUrl(baseUrl: string, database: string) {
  const u = new URL(baseUrl);
  u.pathname = `/${database}`;
  return u.toString();
}

async function createTempDatabase(cfg: { host: string; port: number; user: string; password: string }, tempDb: string) {
  const sql = `DROP DATABASE IF EXISTS "${tempDb}"; CREATE DATABASE "${tempDb}";`;
  await execFileAsync(
    'psql',
    ['-h', cfg.host, '-p', String(cfg.port), '-U', cfg.user, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { env: { ...process.env, PGPASSWORD: cfg.password } }
  );
}

async function dropTempDatabase(cfg: { host: string; port: number; user: string; password: string }, tempDb: string) {
  const sql = `DROP DATABASE IF EXISTS "${tempDb}";`;
  await execFileAsync(
    'psql',
    ['-h', cfg.host, '-p', String(cfg.port), '-U', cfg.user, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { env: { ...process.env, PGPASSWORD: cfg.password } }
  );
}

async function restoreDumpIntoDatabase(
  cfg: { host: string; port: number; user: string; password: string },
  tempDb: string,
  dumpPath: string
) {
  try {
    await execFileAsync(
      'pg_restore',
      ['-h', cfg.host, '-p', String(cfg.port), '-U', cfg.user, '-d', tempDb, '--no-owner', '--no-privileges', dumpPath],
      { env: { ...process.env, PGPASSWORD: cfg.password } }
    );
    return;
  } catch (e: any) {
    const msg = String(e?.stderr || e?.message || '');
    if (!msg.toLowerCase().includes('text format') && !msg.toLowerCase().includes('not a valid archive')) {
      throw e;
    }
  }

  await execFileAsync(
    'psql',
    ['-h', cfg.host, '-p', String(cfg.port), '-U', cfg.user, '-d', tempDb, '-v', 'ON_ERROR_STOP=1', '-f', dumpPath],
    { env: { ...process.env, PGPASSWORD: cfg.password } }
  );
}

async function ensureUniqueEmail(target: PrismaClient, email: string, preferredUsername: string, allowSameUserId?: string) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return `${preferredUsername}@import.local`;

  const found = await target.user.findUnique({ where: { email: normalized }, select: { id: true } });
  if (!found) return normalized;
  if (allowSameUserId && found.id === allowSameUserId) return normalized;
  return `${preferredUsername}+${Date.now().toString(36)}@import.local`;
}

export async function importPainelmasterDumpFromFile(opts: { filename: string; dryRun: boolean }): Promise<ImportResult> {
  const { filename, dryRun } = opts;
  if (!isValidDumpFilename(filename)) throw new Error('filename inválido (use .dump/.backup/.sql na pasta de backups)');

  const backupDir = resolveBackupDir();
  const dumpPath = path.join(backupDir, filename);
  await fs.access(dumpPath);

  const baseDbUrl = String(process.env.DATABASE_URL || '').trim();
  if (!baseDbUrl) throw new Error('DATABASE_URL não configurada');
  const cfg = parsePostgresUrl(baseDbUrl);

  const tempDb = `import_${Date.now().toString(36)}`;
  const keepTempDb = String(process.env.KEEP_IMPORT_DB || '').trim().toLowerCase() === 'true';

  const result: ImportResult = {
    tempDb,
    users: { found: 0, created: 0, updated: 0, skipped: 0, errors: 0 },
    servers: { found: 0, created: 0, updated: 0, skipped: 0, errors: 0 },
    customers: { found: 0, created: 0, updated: 0, skipped: 0, errors: 0 },
    core: {
      streams: { found: 0, created: 0, updated: 0, skipped: 0, errors: 0 },
      bouquets: { found: 0, created: 0, updated: 0, skipped: 0, errors: 0 },
      bouquetStreams: { found: 0, created: 0, skipped: 0, errors: 0 },
      edgeServers: { found: 0, created: 0, updated: 0, skipped: 0, errors: 0 },
      streamEdgeServers: { found: 0, created: 0, skipped: 0, errors: 0 },
    },
  };

  logger.info('[ImportDump] Preparando DB temporário', { dumpPath, tempDb, dryRun });

  await createTempDatabase(cfg, tempDb);

  const sourceDbUrl = buildDatabaseUrl(baseDbUrl, tempDb);
  const source = new PrismaClient({
    datasources: { db: { url: sourceDbUrl } },
    log: ['error'],
  });

  try {
    logger.info('[ImportDump] Restaurando dump no DB temporário');
    await restoreDumpIntoDatabase(cfg, tempDb, dumpPath);

    const customerRows = await source.customer
      .findMany({
        select: { resellerUserId: true, serverId: true, externalId: true },
        take: 500000,
      })
      .catch(() => []);

    const streamRows = await source.coreStream
      .findMany({
        select: { ownerId: true, id: true },
        take: 500000,
      })
      .catch(() => []);

    const bouquetRows = await source.coreBouquet
      .findMany({
        select: { ownerId: true, id: true },
        take: 500000,
      })
      .catch(() => []);

    const edgeRows = await source.coreEdgeServer
      .findMany({
        select: { ownerId: true, id: true },
        take: 500000,
      })
      .catch(() => []);

    const userIds = new Set<string>();
    const serverIds = new Set<string>();
    for (const c of customerRows as any[]) {
      if (c?.resellerUserId) userIds.add(String(c.resellerUserId));
      if (c?.serverId) serverIds.add(String(c.serverId));
    }
    for (const s of streamRows as any[]) if (s?.ownerId) userIds.add(String(s.ownerId));
    for (const b of bouquetRows as any[]) if (b?.ownerId) userIds.add(String(b.ownerId));
    for (const e of edgeRows as any[]) if (e?.ownerId) userIds.add(String(e.ownerId));

    const sourceUsers = await source.user
      .findMany({
        where: { id: { in: Array.from(userIds) } },
        select: {
          id: true,
          username: true,
          email: true,
          password: true,
          name: true,
          whatsapp: true,
          telegram: true,
          role: true,
          status: true,
          credits: true,
          creditsReadonly: true,
          billingType: true,
          dueDate: true,
          customerPrice: true,
          billingCycleDays: true,
          isBlockedByBilling: true,
          parentId: true,
          accessGroupId: true,
          canCreateResellers: true,
          maxSubResellers: true,
          commissionPercent: true,
          maxTrialsPerDay: true,
          maxCustomers: true,
          trialHoursAllowed: true,
          allowedPackages: true,
          allowedServers: true,
          menuPermissions: true,
        },
        take: 500000,
      })
      .catch(() => []);

    result.users.found = (sourceUsers as any[]).length;

    const userIdMap = new Map<string, string>();

    for (const u of sourceUsers as any[]) {
      const username = String(u.username || '').trim();
      if (!username) {
        result.users.skipped++;
        continue;
      }

      try {
        const existing = await prisma.user.findUnique({ where: { username }, select: { id: true, email: true } });
        const email = await ensureUniqueEmail(prisma as any, String(u.email || ''), username, existing?.id);

        if (dryRun) {
          if (existing) result.users.updated++;
          else result.users.created++;
          userIdMap.set(String(u.id), existing?.id || `DRYRUN:${username}`);
          continue;
        }

        const upserted = await prisma.user.upsert({
          where: { username },
          create: {
            username,
            email,
            password: String(u.password || ''),
            name: u.name || null,
            whatsapp: u.whatsapp || null,
            telegram: u.telegram || null,
            role: u.role || 'RESELLER',
            status: u.status || 'ACTIVE',
            credits: typeof u.credits === 'number' ? u.credits : 0,
            creditsReadonly: !!u.creditsReadonly,
            billingType: u.billingType || 'PREPAID',
            dueDate: u.dueDate || null,
            customerPrice: u.customerPrice || null,
            billingCycleDays: typeof u.billingCycleDays === 'number' ? u.billingCycleDays : 30,
            isBlockedByBilling: !!u.isBlockedByBilling,
            parentId: u.parentId || null,
            accessGroupId: u.accessGroupId || null,
            canCreateResellers: !!u.canCreateResellers,
            maxSubResellers: u.maxSubResellers ?? null,
            commissionPercent: typeof u.commissionPercent === 'number' ? u.commissionPercent : 0,
            maxTrialsPerDay: u.maxTrialsPerDay ?? null,
            maxCustomers: u.maxCustomers ?? null,
            trialHoursAllowed: u.trialHoursAllowed || '3,6,12,24',
            allowedPackages: u.allowedPackages || null,
            allowedServers: u.allowedServers || null,
            menuPermissions: u.menuPermissions || null,
          },
          update: {
            email,
            password: String(u.password || ''),
            name: u.name || null,
            whatsapp: u.whatsapp || null,
            telegram: u.telegram || null,
            role: u.role || 'RESELLER',
            status: u.status || 'ACTIVE',
            credits: typeof u.credits === 'number' ? u.credits : 0,
            creditsReadonly: !!u.creditsReadonly,
            billingType: u.billingType || 'PREPAID',
            dueDate: u.dueDate || null,
            customerPrice: u.customerPrice || null,
            billingCycleDays: typeof u.billingCycleDays === 'number' ? u.billingCycleDays : 30,
            isBlockedByBilling: !!u.isBlockedByBilling,
            parentId: u.parentId || null,
            accessGroupId: u.accessGroupId || null,
            canCreateResellers: !!u.canCreateResellers,
            maxSubResellers: u.maxSubResellers ?? null,
            commissionPercent: typeof u.commissionPercent === 'number' ? u.commissionPercent : 0,
            maxTrialsPerDay: u.maxTrialsPerDay ?? null,
            maxCustomers: u.maxCustomers ?? null,
            trialHoursAllowed: u.trialHoursAllowed || '3,6,12,24',
            allowedPackages: u.allowedPackages || null,
            allowedServers: u.allowedServers || null,
            menuPermissions: u.menuPermissions || null,
          },
          select: { id: true },
        });

        userIdMap.set(String(u.id), upserted.id);
        if (existing) result.users.updated++;
        else result.users.created++;
      } catch (e: any) {
        result.users.errors++;
        logger.error('[ImportDump] Falha ao importar user', { username, error: e?.message || String(e) });
      }
    }

    const sourceServers = await source.xuiServer
      .findMany({
        where: { id: { in: Array.from(serverIds) } },
        take: 20000,
      })
      .catch(() => []);

    result.servers.found = (sourceServers as any[]).length;
    const serverIdMap = new Map<string, string>();

    for (const s of sourceServers as any[]) {
      try {
        const baseUrl = String(s.baseUrl || '').trim();
        const accessCode = String(s.accessCode || '').trim();
        if (!baseUrl || !accessCode) {
          result.servers.skipped++;
          continue;
        }

        const where = { baseUrl_accessCode: { baseUrl, accessCode } } as any;
        const existing = await prisma.xuiServer.findUnique({ where, select: { id: true } });

        if (dryRun) {
          if (existing) result.servers.updated++;
          else result.servers.created++;
          serverIdMap.set(String(s.id), existing?.id || `DRYRUN:${baseUrl}`);
          continue;
        }

        const upserted = await prisma.xuiServer.upsert({
          where,
          create: {
            name: String(s.name || 'Servidor'),
            baseUrl,
            serverType: String(s.serverType || 'XUIONE'),
            accessCode,
            apiKey: String(s.apiKey || ''),
            apiUsername: s.apiUsername || null,
            apiPassword: s.apiPassword || null,
            dnsPrimary: s.dnsPrimary || null,
            dnsList: s.dnsList || null,
            defaultTemplate: s.defaultTemplate || null,
            isActive: s.isActive !== false,
            isDefault: !!s.isDefault,
            status: String(s.status || 'OFFLINE'),
            lastSync: s.lastSync || null,
            lastCheck: s.lastCheck || null,
            xuiResellerId: s.xuiResellerId ?? null,
            xuiResellerUsername: s.xuiResellerUsername || null,
            xuiResellerApiKey: s.xuiResellerApiKey || null,
            dbHost: s.dbHost || null,
            dbPort: typeof s.dbPort === 'number' ? s.dbPort : 3306,
            dbName: s.dbName || null,
            dbUser: s.dbUser || null,
            dbPassword: s.dbPassword || null,
            sshHost: s.sshHost || null,
            sshPort: typeof s.sshPort === 'number' ? s.sshPort : 22,
            sshUser: s.sshUser || null,
            sshPassword: s.sshPassword || null,
            sshKey: s.sshKey || null,
          },
          update: {
            name: String(s.name || 'Servidor'),
            serverType: String(s.serverType || 'XUIONE'),
            apiKey: String(s.apiKey || ''),
            apiUsername: s.apiUsername || null,
            apiPassword: s.apiPassword || null,
            dnsPrimary: s.dnsPrimary || null,
            dnsList: s.dnsList || null,
            defaultTemplate: s.defaultTemplate || null,
            isActive: s.isActive !== false,
            isDefault: !!s.isDefault,
            status: String(s.status || 'OFFLINE'),
            lastSync: s.lastSync || null,
            lastCheck: s.lastCheck || null,
            xuiResellerId: s.xuiResellerId ?? null,
            xuiResellerUsername: s.xuiResellerUsername || null,
            xuiResellerApiKey: s.xuiResellerApiKey || null,
            dbHost: s.dbHost || null,
            dbPort: typeof s.dbPort === 'number' ? s.dbPort : 3306,
            dbName: s.dbName || null,
            dbUser: s.dbUser || null,
            dbPassword: s.dbPassword || null,
            sshHost: s.sshHost || null,
            sshPort: typeof s.sshPort === 'number' ? s.sshPort : 22,
            sshUser: s.sshUser || null,
            sshPassword: s.sshPassword || null,
            sshKey: s.sshKey || null,
          },
          select: { id: true },
        });

        serverIdMap.set(String(s.id), upserted.id);
        if (existing) result.servers.updated++;
        else result.servers.created++;
      } catch (e: any) {
        result.servers.errors++;
        logger.error('[ImportDump] Falha ao importar server', { error: e?.message || String(e) });
      }
    }

    const sourceCustomers = await source.customer
      .findMany({
        where: { serverId: { in: Array.from(serverIds) } },
        select: {
          serverId: true,
          externalId: true,
          username: true,
          password: true,
          name: true,
          email: true,
          whatsapp: true,
          telegram: true,
          status: true,
          isTrial: true,
          connections: true,
          expiresAt: true,
          resellerUserId: true,
        },
        take: 500000,
      })
      .catch(() => []);

    result.customers.found = (sourceCustomers as any[]).length;

    for (const c of sourceCustomers as any[]) {
      try {
        const oldServerId = String(c.serverId || '');
        const newServerId = serverIdMap.get(oldServerId);
        if (!newServerId) {
          result.customers.skipped++;
          continue;
        }

        const oldResellerId = String(c.resellerUserId || '');
        const newResellerId = userIdMap.get(oldResellerId);
        if (!newResellerId) {
          result.customers.skipped++;
          continue;
        }

        const externalId = String(c.externalId || '').trim();
        if (!externalId) {
          result.customers.skipped++;
          continue;
        }

        const where = { serverId_externalId: { serverId: newServerId, externalId } } as any;
        const existing = await prisma.customer.findUnique({ where, select: { id: true } });

        if (dryRun) {
          if (existing) result.customers.updated++;
          else result.customers.created++;
          continue;
        }

        if (existing) {
          await prisma.customer.update({
            where: { id: existing.id },
            data: {
              username: String(c.username || ''),
              password: String(c.password || ''),
              name: c.name || null,
              email: c.email || null,
              whatsapp: c.whatsapp || null,
              telegram: c.telegram || null,
              status: String(c.status || 'ACTIVE'),
              isTrial: !!c.isTrial,
              connections: typeof c.connections === 'number' ? c.connections : 1,
              expiresAt: c.expiresAt,
              resellerUserId: newResellerId,
            },
          });
          result.customers.updated++;
        } else {
          await prisma.customer.create({
            data: {
              externalId,
              serverId: newServerId,
              username: String(c.username || ''),
              password: String(c.password || ''),
              name: c.name || null,
              email: c.email || null,
              whatsapp: c.whatsapp || null,
              telegram: c.telegram || null,
              status: String(c.status || 'ACTIVE'),
              isTrial: !!c.isTrial,
              connections: typeof c.connections === 'number' ? c.connections : 1,
              expiresAt: c.expiresAt,
              resellerUserId: newResellerId,
              packageId: null,
            },
          });
          result.customers.created++;
        }
      } catch (e: any) {
        result.customers.errors++;
        logger.error('[ImportDump] Falha ao importar customer', { error: e?.message || String(e) });
      }
    }

    const sourceCoreStreams = await source.coreStream
      .findMany({
        select: {
          id: true,
          ownerId: true,
          name: true,
          streamUrl: true,
          logoUrl: true,
          epgChannelId: true,
          tvArchive: true,
          tvArchiveDuration: true,
          isActive: true,
          upstreamsCheckedAt: true,
          upstreamsTotal: true,
          upstreamsOk: true,
          upstreamsDown: true,
          upstreamsLastOkAt: true,
          upstreamsLastOkUrl: true,
        },
        take: 500000,
      })
      .catch(() => []);

    result.core.streams.found = (sourceCoreStreams as any[]).length;
    const coreStreamIdMap = new Map<string, string>();

    for (const s of sourceCoreStreams as any[]) {
      const ownerId = userIdMap.get(String(s.ownerId || ''));
      if (!ownerId) {
        result.core.streams.skipped++;
        continue;
      }
      const name = String(s.name || '').trim();
      if (!name) {
        result.core.streams.skipped++;
        continue;
      }

      try {
        const where = { ownerId_name: { ownerId, name } } as any;
        const existing = await prisma.coreStream.findUnique({ where, select: { id: true } });

        if (dryRun) {
          if (existing) result.core.streams.updated++;
          else result.core.streams.created++;
          coreStreamIdMap.set(String(s.id), existing?.id || `DRYRUN:${ownerId}:${name}`);
          continue;
        }

        const upserted = await prisma.coreStream.upsert({
          where,
          create: {
            ownerId,
            name,
            streamUrl: String(s.streamUrl || ''),
            logoUrl: s.logoUrl || null,
            epgChannelId: s.epgChannelId || null,
            tvArchive: !!s.tvArchive,
            tvArchiveDuration: typeof s.tvArchiveDuration === 'number' ? s.tvArchiveDuration : 0,
            isActive: s.isActive !== false,
            upstreamsCheckedAt: s.upstreamsCheckedAt || null,
            upstreamsTotal: typeof s.upstreamsTotal === 'number' ? s.upstreamsTotal : 0,
            upstreamsOk: typeof s.upstreamsOk === 'number' ? s.upstreamsOk : 0,
            upstreamsDown: typeof s.upstreamsDown === 'number' ? s.upstreamsDown : 0,
            upstreamsLastOkAt: s.upstreamsLastOkAt || null,
            upstreamsLastOkUrl: s.upstreamsLastOkUrl || null,
          },
          update: {
            streamUrl: String(s.streamUrl || ''),
            logoUrl: s.logoUrl || null,
            epgChannelId: s.epgChannelId || null,
            tvArchive: !!s.tvArchive,
            tvArchiveDuration: typeof s.tvArchiveDuration === 'number' ? s.tvArchiveDuration : 0,
            isActive: s.isActive !== false,
            upstreamsCheckedAt: s.upstreamsCheckedAt || null,
            upstreamsTotal: typeof s.upstreamsTotal === 'number' ? s.upstreamsTotal : 0,
            upstreamsOk: typeof s.upstreamsOk === 'number' ? s.upstreamsOk : 0,
            upstreamsDown: typeof s.upstreamsDown === 'number' ? s.upstreamsDown : 0,
            upstreamsLastOkAt: s.upstreamsLastOkAt || null,
            upstreamsLastOkUrl: s.upstreamsLastOkUrl || null,
          },
          select: { id: true },
        });

        coreStreamIdMap.set(String(s.id), upserted.id);
        if (existing) result.core.streams.updated++;
        else result.core.streams.created++;
      } catch (e: any) {
        result.core.streams.errors++;
        logger.error('[ImportDump] Falha ao importar core stream', { error: e?.message || String(e) });
      }
    }

    const sourceCoreBouquets = await source.coreBouquet
      .findMany({
        select: { id: true, ownerId: true, kind: true, name: true, isActive: true, sortOrder: true },
        take: 500000,
      })
      .catch(() => []);

    result.core.bouquets.found = (sourceCoreBouquets as any[]).length;
    const coreBouquetIdMap = new Map<string, string>();

    for (const b of sourceCoreBouquets as any[]) {
      const ownerId = userIdMap.get(String(b.ownerId || ''));
      if (!ownerId) {
        result.core.bouquets.skipped++;
        continue;
      }
      const name = String(b.name || '').trim();
      const kind = String(b.kind || '').trim() || 'LIVE';
      if (!name) {
        result.core.bouquets.skipped++;
        continue;
      }

      try {
        const where = { ownerId_kind_name: { ownerId, kind, name } } as any;
        const existing = await prisma.coreBouquet.findUnique({ where, select: { id: true } });

        if (dryRun) {
          if (existing) result.core.bouquets.updated++;
          else result.core.bouquets.created++;
          coreBouquetIdMap.set(String(b.id), existing?.id || `DRYRUN:${ownerId}:${kind}:${name}`);
          continue;
        }

        const upserted = await prisma.coreBouquet.upsert({
          where,
          create: {
            ownerId,
            kind: kind as any,
            name,
            isActive: b.isActive !== false,
            sortOrder: typeof b.sortOrder === 'number' ? b.sortOrder : 0,
          },
          update: {
            isActive: b.isActive !== false,
            sortOrder: typeof b.sortOrder === 'number' ? b.sortOrder : 0,
          },
          select: { id: true },
        });

        coreBouquetIdMap.set(String(b.id), upserted.id);
        if (existing) result.core.bouquets.updated++;
        else result.core.bouquets.created++;
      } catch (e: any) {
        result.core.bouquets.errors++;
        logger.error('[ImportDump] Falha ao importar core bouquet', { error: e?.message || String(e) });
      }
    }

    const sourceBouquetStreams = await source.coreBouquetStream
      .findMany({
        select: { bouquetId: true, streamId: true, sortOrder: true },
        take: 1000000,
      })
      .catch(() => []);

    result.core.bouquetStreams.found = (sourceBouquetStreams as any[]).length;
    if (!dryRun) {
      const rowsToCreate: Array<{ bouquetId: string; streamId: string; sortOrder: number }> = [];
      for (const r of sourceBouquetStreams as any[]) {
        const bouquetId = coreBouquetIdMap.get(String(r.bouquetId || ''));
        const streamId = coreStreamIdMap.get(String(r.streamId || ''));
        if (!bouquetId || !streamId) {
          result.core.bouquetStreams.skipped++;
          continue;
        }
        rowsToCreate.push({
          bouquetId,
          streamId,
          sortOrder: typeof r.sortOrder === 'number' ? r.sortOrder : 0,
        });
      }

      if (rowsToCreate.length) {
        try {
          const created = await prisma.coreBouquetStream.createMany({ data: rowsToCreate, skipDuplicates: true });
          result.core.bouquetStreams.created += created.count;
        } catch (e: any) {
          result.core.bouquetStreams.errors++;
          logger.error('[ImportDump] Falha ao importar core bouquet streams', { error: e?.message || String(e) });
        }
      }
    } else {
      for (const r of sourceBouquetStreams as any[]) {
        const bouquetId = coreBouquetIdMap.get(String(r.bouquetId || ''));
        const streamId = coreStreamIdMap.get(String(r.streamId || ''));
        if (!bouquetId || !streamId) {
          result.core.bouquetStreams.skipped++;
          continue;
        }
        result.core.bouquetStreams.created++;
      }
    }

    const sourceEdgeServers = await source.coreEdgeServer
      .findMany({
        select: {
          id: true,
          ownerId: true,
          name: true,
          domain: true,
          ip: true,
          vpnIp: true,
          timezoneOffsetSeconds: true,
          networkInterface: true,
          networkSpeed: true,
          httpPort: true,
          httpsPort: true,
          rtmpPort: true,
          maxClients: true,
          onlyTimeshift: true,
          duplex: true,
          geoipEnabled: true,
          geoipPriority: true,
          geoipCountries: true,
          ispEnabled: true,
          ispPriority: true,
          ispNames: true,
          edgeTokenEnc: true,
          installedAt: true,
          sshHost: true,
          sshPort: true,
          sshUser: true,
          sshPasswordEnc: true,
          sshKeyEnc: true,
          os: true,
          isActive: true,
        },
        take: 500000,
      })
      .catch(() => []);

    result.core.edgeServers.found = (sourceEdgeServers as any[]).length;
    const edgeIdMap = new Map<string, string>();

    for (const s of sourceEdgeServers as any[]) {
      const ownerId = userIdMap.get(String(s.ownerId || ''));
      if (!ownerId) {
        result.core.edgeServers.skipped++;
        continue;
      }
      const name = String(s.name || '').trim();
      if (!name) {
        result.core.edgeServers.skipped++;
        continue;
      }

      try {
        const where = { ownerId_name: { ownerId, name } } as any;
        const existing = await prisma.coreEdgeServer.findUnique({ where, select: { id: true } });

        if (dryRun) {
          if (existing) result.core.edgeServers.updated++;
          else result.core.edgeServers.created++;
          edgeIdMap.set(String(s.id), existing?.id || `DRYRUN:${ownerId}:${name}`);
          continue;
        }

        const upserted = await prisma.coreEdgeServer.upsert({
          where,
          create: {
            ownerId,
            name,
            domain: s.domain || null,
            ip: s.ip || null,
            vpnIp: s.vpnIp || null,
            timezoneOffsetSeconds: typeof s.timezoneOffsetSeconds === 'number' ? s.timezoneOffsetSeconds : 0,
            networkInterface: s.networkInterface || null,
            networkSpeed: typeof s.networkSpeed === 'number' ? s.networkSpeed : 0,
            httpPort: typeof s.httpPort === 'number' ? s.httpPort : 80,
            httpsPort: typeof s.httpsPort === 'number' ? s.httpsPort : 443,
            rtmpPort: typeof s.rtmpPort === 'number' ? s.rtmpPort : 0,
            maxClients: typeof s.maxClients === 'number' ? s.maxClients : 100000,
            onlyTimeshift: !!s.onlyTimeshift,
            duplex: !!s.duplex,
            geoipEnabled: !!s.geoipEnabled,
            geoipPriority: String(s.geoipPriority || 'low'),
            geoipCountries: s.geoipCountries || null,
            ispEnabled: !!s.ispEnabled,
            ispPriority: String(s.ispPriority || 'low'),
            ispNames: s.ispNames || null,
            edgeTokenEnc: s.edgeTokenEnc || null,
            installedAt: s.installedAt || null,
            sshHost: s.sshHost || null,
            sshPort: typeof s.sshPort === 'number' ? s.sshPort : 22,
            sshUser: s.sshUser || null,
            sshPasswordEnc: s.sshPasswordEnc || null,
            sshKeyEnc: s.sshKeyEnc || null,
            os: String(s.os || 'ubuntu'),
            isActive: s.isActive !== false,
          },
          update: {
            domain: s.domain || null,
            ip: s.ip || null,
            vpnIp: s.vpnIp || null,
            timezoneOffsetSeconds: typeof s.timezoneOffsetSeconds === 'number' ? s.timezoneOffsetSeconds : 0,
            networkInterface: s.networkInterface || null,
            networkSpeed: typeof s.networkSpeed === 'number' ? s.networkSpeed : 0,
            httpPort: typeof s.httpPort === 'number' ? s.httpPort : 80,
            httpsPort: typeof s.httpsPort === 'number' ? s.httpsPort : 443,
            rtmpPort: typeof s.rtmpPort === 'number' ? s.rtmpPort : 0,
            maxClients: typeof s.maxClients === 'number' ? s.maxClients : 100000,
            onlyTimeshift: !!s.onlyTimeshift,
            duplex: !!s.duplex,
            geoipEnabled: !!s.geoipEnabled,
            geoipPriority: String(s.geoipPriority || 'low'),
            geoipCountries: s.geoipCountries || null,
            ispEnabled: !!s.ispEnabled,
            ispPriority: String(s.ispPriority || 'low'),
            ispNames: s.ispNames || null,
            edgeTokenEnc: s.edgeTokenEnc || null,
            installedAt: s.installedAt || null,
            sshHost: s.sshHost || null,
            sshPort: typeof s.sshPort === 'number' ? s.sshPort : 22,
            sshUser: s.sshUser || null,
            sshPasswordEnc: s.sshPasswordEnc || null,
            sshKeyEnc: s.sshKeyEnc || null,
            os: String(s.os || 'ubuntu'),
            isActive: s.isActive !== false,
          },
          select: { id: true },
        });

        edgeIdMap.set(String(s.id), upserted.id);
        if (existing) result.core.edgeServers.updated++;
        else result.core.edgeServers.created++;
      } catch (e: any) {
        result.core.edgeServers.errors++;
        logger.error('[ImportDump] Falha ao importar core edge server', { error: e?.message || String(e) });
      }
    }

    const sourceStreamEdgeServers = await (source as any).coreStreamEdgeServer
      .findMany({
        select: { streamId: true, serverId: true },
        take: 1000000,
      })
      .catch(() => []);

    result.core.streamEdgeServers.found = (sourceStreamEdgeServers as any[]).length;
    if (!dryRun) {
      const rowsToCreate: Array<{ streamId: string; serverId: string }> = [];
      for (const r of sourceStreamEdgeServers as any[]) {
        const streamId = coreStreamIdMap.get(String(r.streamId || ''));
        const serverId = edgeIdMap.get(String(r.serverId || ''));
        if (!streamId || !serverId) {
          result.core.streamEdgeServers.skipped++;
          continue;
        }
        rowsToCreate.push({ streamId, serverId });
      }
      if (rowsToCreate.length) {
        try {
          const created = await prisma.coreStreamEdgeServer.createMany({ data: rowsToCreate, skipDuplicates: true });
          result.core.streamEdgeServers.created += created.count;
        } catch (e: any) {
          result.core.streamEdgeServers.errors++;
          logger.error('[ImportDump] Falha ao importar core stream edge servers', { error: e?.message || String(e) });
        }
      }
    } else {
      for (const r of sourceStreamEdgeServers as any[]) {
        const streamId = coreStreamIdMap.get(String(r.streamId || ''));
        const serverId = edgeIdMap.get(String(r.serverId || ''));
        if (!streamId || !serverId) {
          result.core.streamEdgeServers.skipped++;
          continue;
        }
        result.core.streamEdgeServers.created++;
      }
    }
  } finally {
    await source.$disconnect().catch(() => {});
    if (!keepTempDb) {
      await dropTempDatabase(cfg, tempDb).catch((e: any) => {
        logger.warn('[ImportDump] Falha ao remover DB temporário', { tempDb, error: e?.message || String(e) });
      });
    } else {
      logger.warn('[ImportDump] KEEP_IMPORT_DB=true, mantendo DB temporário', { tempDb });
    }
  }

  return result;
}

