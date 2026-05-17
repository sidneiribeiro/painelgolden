import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { prisma } from '../config/database.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ImportCoreStreamsCsv');

type ImportCoreStreamsCsvOptions = {
  filename: string;
  ownerId: string;
  dryRun: boolean;
  maxRows: number;
  createBouquets: boolean;
};

type ImportCoreStreamsCsvResult = {
  file: { filename: string; path: string };
  ownerId: string;
  dryRun: boolean;
  maxRows: number;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  createdBouquets: number;
  updatedBouquetLinks: number;
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

function parseBool(raw: any, fallback = false): boolean {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return fallback;
  return s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'sim';
}

function parseIntSafe(raw: any, fallback: number): number {
  const n = parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function normalizeKind(raw: any): 'LIVE' | 'MOVIE' | 'SERIES' {
  const s = String(raw ?? '').trim().toUpperCase();
  if (s === 'MOVIE') return 'MOVIE';
  if (s === 'SERIES') return 'SERIES';
  return 'LIVE';
}

export async function importCoreStreamsCsvFromFile(opts: ImportCoreStreamsCsvOptions): Promise<ImportCoreStreamsCsvResult> {
  const filename = String(opts.filename || '').trim();
  if (!isValidFilename(filename)) throw new Error('filename inválido (use .csv na pasta de backups)');

  const ownerId = String(opts.ownerId || '').trim();
  if (!ownerId) throw new Error('ownerId é obrigatório');

  const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { id: true } });
  if (!owner) throw new Error('ownerId não encontrado');

  const backupDir = resolveBackupDir();
  const filePath = path.join(backupDir, filename);
  await fsp.access(filePath);

  const details: ImportCoreStreamsCsvResult['details'] = [];
  const add = (line: number, level: 'info' | 'warn' | 'error', message: string) => {
    const limit = opts.dryRun ? 200 : 50;
    if (details.length < limit) details.push({ line, level, message });
  };

  const result: ImportCoreStreamsCsvResult = {
    file: { filename, path: filePath },
    ownerId,
    dryRun: opts.dryRun,
    maxRows: opts.maxRows,
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    createdBouquets: 0,
    updatedBouquetLinks: 0,
    details,
  };

  logger.info('[ImportCoreStreamsCsv] Iniciando', { filePath, ownerId, dryRun: opts.dryRun });

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let headerIndex = new Map<string, number>();
  let lineNo = 0;

  const getField = (row: string[], name: string): string => {
    const idx = headerIndex.get(name.toLowerCase());
    if (idx === undefined) return '';
    return String(row[idx] ?? '').trim();
  };

  const bouquetCache = new Map<string, { id: string; kind: 'LIVE' | 'MOVIE' | 'SERIES' }>();

  for await (const rawLine of rl) {
    lineNo++;
    const line = String(rawLine ?? '');
    if (!line.trim()) continue;
    if (lineNo === 1) {
      const header = parseCsvLine(line).map((h) => h.trim());
      headerIndex = new Map(header.map((h, i) => [h.toLowerCase(), i]));
      continue;
    }

    if (result.processed >= opts.maxRows) {
      add(lineNo, 'warn', `Limite maxRows=${opts.maxRows} atingido; parei aqui`);
      break;
    }

    const row = parseCsvLine(line);
    const name = getField(row, 'name');
    const streamUrl = getField(row, 'streamUrl') || getField(row, 'url');
    if (!name || !streamUrl) {
      result.skipped++;
      add(lineNo, 'warn', 'Linha ignorada: name e streamUrl/url são obrigatórios');
      continue;
    }

    const logoUrl = getField(row, 'logoUrl') || null;
    const epgChannelId = getField(row, 'epgChannelId') || null;
    const isActive = parseBool(getField(row, 'isActive'), true);
    const tvArchive = parseBool(getField(row, 'tvArchive'), false);
    const tvArchiveDuration = Math.max(0, parseIntSafe(getField(row, 'tvArchiveDuration'), 0));
    const priority = parseIntSafe(getField(row, 'priority'), 0);

    const bouquetName = getField(row, 'bouquetName') || getField(row, 'category') || '';
    const bouquetKind = normalizeKind(getField(row, 'bouquetKind') || getField(row, 'kind'));

    result.processed++;

    const existing = await prisma.coreStream
      .findFirst({ where: { ownerId, name }, select: { id: true } })
      .catch(() => null);

    if (opts.dryRun) {
      if (existing?.id) result.updated++;
      else result.created++;
      continue;
    }

    try {
      const stream = existing?.id
        ? await prisma.coreStream.update({
            where: { id: existing.id },
            data: {
              streamUrl,
              logoUrl,
              epgChannelId,
              isActive,
              tvArchive,
              tvArchiveDuration,
              priority,
            },
            select: { id: true },
          })
        : await prisma.coreStream.create({
            data: {
              ownerId,
              name,
              streamUrl,
              logoUrl,
              epgChannelId,
              isActive,
              tvArchive,
              tvArchiveDuration,
              priority,
            },
            select: { id: true },
          });

      if (existing?.id) result.updated++;
      else result.created++;

      if (opts.createBouquets && bouquetName) {
        const cacheKey = `${bouquetKind}:${bouquetName}`.toLowerCase();
        let bouquet = bouquetCache.get(cacheKey);
        if (!bouquet) {
          const found = await prisma.coreBouquet.findFirst({
            where: { ownerId, kind: bouquetKind as any, name: bouquetName },
            select: { id: true, kind: true },
          });
          if (found) bouquet = { id: found.id, kind: found.kind as any };
          else {
            const created = await prisma.coreBouquet.create({
              data: { ownerId, kind: bouquetKind as any, name: bouquetName, isActive: true, sortOrder: 0 },
              select: { id: true, kind: true },
            });
            bouquet = { id: created.id, kind: created.kind as any };
            result.createdBouquets++;
          }
          bouquetCache.set(cacheKey, bouquet);
        }

        await prisma.coreBouquetStream.upsert({
          where: { bouquetId_streamId: { bouquetId: bouquet.id, streamId: stream.id } },
          update: {},
          create: { bouquetId: bouquet.id, streamId: stream.id, sortOrder: 0 },
        });
        result.updatedBouquetLinks++;
      }
    } catch (e: any) {
      result.errors++;
      add(lineNo, 'error', `Erro ao importar canal ${name}: ${e?.message || String(e)}`);
    }
  }

  return result;
}

