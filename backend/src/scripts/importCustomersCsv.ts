import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import bcrypt from 'bcryptjs';
import { prisma } from '../config/database.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ImportCustomersCsv');

type ImportCustomersCsvOptions = {
  filename: string;
  serverId: string;
  dryRun: boolean;
  createMissingResellers: boolean;
  defaultExpiresDays: number;
  maxRows: number;
};

type ImportCustomersCsvResult = {
  file: { filename: string; path: string };
  serverId: string;
  dryRun: boolean;
  maxRows: number;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  missingResellers: string[];
  details: Array<{ line: number; level: 'info' | 'warn' | 'error'; message: string }>;
};

function resolveBackupDir(): string {
  const envDir = String(process.env.BACKUP_DIR || '').trim();
  if (envDir) return envDir;
  return path.join(process.cwd(), 'storage', 'backups');
}

function isValidFilename(filename: string): boolean {
  if (!filename) return false;
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) return false;
  return filename.endsWith('.csv');
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          cur += '"';
          i++;
          continue;
        }
        inQuotes = false;
        continue;
      }
      cur += ch;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((v) => String(v ?? '').trim());
}

function parseBool(raw: any): boolean {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return false;
  return s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'sim';
}

function parseIntSafe(raw: any, fallback: number): number {
  const n = parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function parseDateOrNull(raw: any): Date | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    if (!Number.isFinite(n)) return null;
    const ms = n > 9_999_999_999 ? n : n * 1000;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const d = new Date(s);
  if (Number.isFinite(d.getTime())) return d;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d2 = new Date(`${s}T00:00:00.000Z`);
    return Number.isFinite(d2.getTime()) ? d2 : null;
  }
  return null;
}

function normalizeUsername(raw: any): string {
  return String(raw ?? '').trim();
}

function normalizeEmail(raw: any): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  return s;
}

function makeExternalId(resellerUsername: string, username: string): string {
  return `import:${resellerUsername}:${username}`.slice(0, 190);
}

export async function importCustomersCsvFromFile(opts: ImportCustomersCsvOptions): Promise<ImportCustomersCsvResult> {
  const filename = String(opts.filename || '').trim();
  if (!isValidFilename(filename)) throw new Error('filename inválido (use .csv na pasta de backups)');

  const serverId = String(opts.serverId || '').trim();
  if (!serverId) throw new Error('serverId é obrigatório');

  const server = await prisma.xuiServer.findUnique({ where: { id: serverId }, select: { id: true, name: true } });
  if (!server) throw new Error('Servidor (serverId) não encontrado');

  const backupDir = resolveBackupDir();
  const filePath = path.join(backupDir, filename);
  await fsp.access(filePath);

  const details: ImportCustomersCsvResult['details'] = [];
  const add = (line: number, level: 'info' | 'warn' | 'error', message: string) => {
    const limit = opts.dryRun ? 200 : 50;
    if (details.length < limit) details.push({ line, level, message });
  };

  const result: ImportCustomersCsvResult = {
    file: { filename, path: filePath },
    serverId,
    dryRun: opts.dryRun,
    maxRows: opts.maxRows,
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    missingResellers: [],
    details,
  };

  logger.info('[ImportCustomersCsv] Iniciando', { filePath, serverId, serverName: server.name, dryRun: opts.dryRun });

  const missingResellers = new Set<string>();

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let header: string[] | null = null;
  const headerIndex = new Map<string, number>();
  let lineNo = 0;

  const getField = (row: string[], name: string): string => {
    const idx = headerIndex.get(name.toLowerCase());
    if (idx === undefined) return '';
    return String(row[idx] ?? '').trim();
  };

  for await (const rawLine of rl) {
    lineNo++;
    const line = String(rawLine ?? '');
    if (!line.trim()) continue;
    if (lineNo === 1) {
      header = parseCsvLine(line).map((h) => h.trim());
      header.forEach((h, i) => headerIndex.set(h.toLowerCase(), i));
      continue;
    }

    if (result.processed >= opts.maxRows) {
      add(lineNo, 'warn', `Limite maxRows=${opts.maxRows} atingido; parei aqui`);
      break;
    }

    const row = parseCsvLine(line);
    const resellerUsername = normalizeUsername(getField(row, 'resellerUsername') || getField(row, 'reseller') || 'admin') || 'admin';
    const username = normalizeUsername(getField(row, 'username'));
    const password = String(getField(row, 'password'));

    if (!username || !password) {
      result.skipped++;
      add(lineNo, 'warn', 'Linha ignorada: username/password obrigatórios');
      continue;
    }

    const expiresAtRaw = getField(row, 'expiresAt');
    const expiresAt =
      parseDateOrNull(expiresAtRaw) || new Date(Date.now() + Math.max(1, opts.defaultExpiresDays) * 24 * 60 * 60 * 1000);
    const connections = Math.max(1, parseIntSafe(getField(row, 'connections'), 1));
    const isTrial = parseBool(getField(row, 'isTrial') || getField(row, 'trial'));
    const status = (getField(row, 'status') || 'ACTIVE').trim() || 'ACTIVE';
    const name = getField(row, 'name') || null;
    const email = normalizeEmail(getField(row, 'email'));
    const whatsapp = getField(row, 'whatsapp') || null;
    const telegram = getField(row, 'telegram') || null;
    const externalId = (getField(row, 'externalId') || makeExternalId(resellerUsername, username)).trim();

    result.processed++;

    let reseller = await prisma.user.findUnique({ where: { username: resellerUsername }, select: { id: true } });
    if (!reseller) {
      missingResellers.add(resellerUsername);
      if (!opts.createMissingResellers) {
        result.skipped++;
        add(lineNo, 'warn', `Revenda não encontrada (${resellerUsername}); pulei`);
        continue;
      }

      const fakeEmail = `${resellerUsername}+${Date.now().toString(36)}@import.local`;
      const randomPassword = bcrypt.hashSync(`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, 10);

      if (opts.dryRun) {
        reseller = { id: `DRYRUN:${resellerUsername}` };
        add(lineNo, 'info', `Criaria revenda ausente: ${resellerUsername}`);
      } else {
        reseller = await prisma.user.create({
          data: {
            username: resellerUsername,
            email: fakeEmail,
            password: randomPassword,
            role: 'RESELLER',
            status: 'ACTIVE',
            credits: 0,
          },
          select: { id: true },
        });
        add(lineNo, 'info', `Revenda criada: ${resellerUsername}`);
      }
    }

    const where = { serverId_externalId: { serverId, externalId } } as any;
    const existing = await prisma.customer.findUnique({ where, select: { id: true } }).catch(() => null);

    if (opts.dryRun) {
      if (existing) result.updated++;
      else result.created++;
      continue;
    }

    try {
      if (existing?.id) {
        await prisma.customer.update({
          where: { id: existing.id },
          data: {
            username,
            password,
            name,
            email,
            whatsapp,
            telegram,
            status,
            isTrial,
            connections,
            expiresAt,
            resellerUserId: reseller.id,
            packageId: null,
          },
        });
        result.updated++;
      } else {
        await prisma.customer.create({
          data: {
            externalId,
            serverId,
            username,
            password,
            name,
            email,
            whatsapp,
            telegram,
            status,
            isTrial,
            connections,
            expiresAt,
            resellerUserId: reseller.id,
            packageId: null,
          },
        });
        result.created++;
      }
    } catch (e: any) {
      result.errors++;
      add(lineNo, 'error', `Erro ao importar cliente ${username}: ${e?.message || String(e)}`);
    }
  }

  result.missingResellers = Array.from(missingResellers);
  return result;
}

