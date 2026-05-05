import mysql, { Connection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { createLogger } from '../utils/logger.js';
import { retryDatabase } from '../utils/retry.util.js';
import type { XuiServer } from '@prisma/client';

const logger = createLogger('XUIDBClient');

export interface XUIDBLine {
  id: number;
  member_id: number;
  username: string;
  password: string;
  exp_date: number;
  is_trial: 0 | 1;
  enabled: number;
  admin_enabled: number;
  bouquet: string | null; // JSON string ou null
  allowed_outputs: string | null; // JSON string ou null
  max_connections: number;
  admin_notes: string | null;
  reseller_notes: string | null;
  created_at: number | null;
  package_id: number | null;
}

export interface CreateLineDBParams {
  username: string;
  password: string;
  exp_date: number;
  is_trial: 0 | 1;
  member_id: number;
  bouquet: number[]; // Array de IDs de bouquets
  allowed_outputs: number[]; // Array de IDs de outputs (ex: [1, 2] = TS, HLS)
  max_connections?: number;
  admin_notes?: string;
  reseller_notes?: string;
  package_id?: number;
  is_restreamer?: 0 | 1; // 1 = permite restream
}

/**
 * Cliente para conexão direta ao banco XUI.ONE / Xtream UI
 * Usado para operações críticas que a API não suporta corretamente
 * 
 * IMPORTANTE: Xtream UI usa tabela `users`, XUI ONE usa tabela `lines`
 * Colunas também diferem entre os dois sistemas
 */
export class XUIDBClient {
  private connection: Connection | null = null;
  private server: XuiServer;
  private serverType: 'XUIONE' | 'XTREAMUI';
  private columnsCache = new Map<string, Set<string>>();
  private primaryKeyCache = new Map<string, string | null>();
  private columnsMetaCache = new Map<
    string,
    Map<
      string,
      {
        dataType: string;
        columnType: string;
        isNullable: 'YES' | 'NO';
        columnDefault: string | null;
        extra: string;
      }
    >
  >();
  private xtreamOutputsValueCache = new Map<string, string>();

  constructor(server: XuiServer) {
    this.server = server;
    this.serverType = ((server as any).serverType || 'XUIONE') as 'XUIONE' | 'XTREAMUI';
  }

  private async getPrimaryKeyColumn(conn: Connection, tableName: string): Promise<string | null> {
    const cached = this.primaryKeyCache.get(tableName);
    if (cached !== undefined) return cached;

    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = ?
         AND CONSTRAINT_NAME = 'PRIMARY'
       ORDER BY ORDINAL_POSITION
       LIMIT 1`,
      [tableName]
    );

    const col = (rows as any[])?.[0]?.COLUMN_NAME ? String((rows as any[])[0].COLUMN_NAME) : null;
    this.primaryKeyCache.set(tableName, col);
    return col;
  }

  private async tableExists(conn: Connection, tableName: string): Promise<boolean> {
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = ?
       LIMIT 1`,
      [tableName]
    );
    return (rows as any[]).length > 0;
  }

  private async getXtreamAccessOutputIds(conn: Connection): Promise<{ ts?: number; hls?: number; rtmp?: number }> {
    const exists = await this.tableExists(conn, 'access_output');
    if (!exists) return {};

    const columnsMeta = await this.getTableColumnsMeta(conn, 'access_output');
    const columns = new Set(columnsMeta.keys());

    const pk = await this.getPrimaryKeyColumn(conn, 'access_output');
    const autoInc = [...columnsMeta.entries()].find(([, m]) => m.extra.toLowerCase().includes('auto_increment'))?.[0];
    const idColumn =
      (pk && columns.has(pk) && pk) ||
      (autoInc && columns.has(autoInc) && autoInc) ||
      (columns.has('id') && 'id') ||
      [...columns].find((c) => c.toLowerCase().endsWith('_id')) ||
      [...columns][0];

    if (!idColumn) return {};

    const textCols = [
      'output_key',
      'output',
      'code',
      'container',
      'format',
      'name',
      'title',
      'output_name',
    ].filter((c) => columns.has(c));

    const selectCols = [`\`${idColumn}\` AS id`, ...textCols.map((c) => `\`${c}\``)].join(', ');
    const [rows] = await conn.execute<RowDataPacket[]>(`SELECT ${selectCols} FROM \`access_output\``);

    const found: { ts?: number; hls?: number; rtmp?: number } = {};

    const score = (hay: string, needles: string[]): number =>
      needles.reduce((acc, n) => acc + (hay === n ? 3 : hay.includes(n) ? 1 : 0), 0);

    for (const r of rows as any[]) {
      const id = Number(r.id);
      if (!Number.isFinite(id)) continue;
      const hay = JSON.stringify(r).toLowerCase();

      const hlsScore = score(hay, ['"hls"', 'hls', '"m3u8"', 'm3u8']);
      const tsScore = score(hay, ['"mpegts"', 'mpegts', '"ts"', 'ts']);
      const rtmpScore = score(hay, ['"rtmp"', 'rtmp']);

      if (!found.hls && hlsScore > 0) found.hls = id;
      if (!found.ts && tsScore > 0) found.ts = id;
      if (!found.rtmp && rtmpScore > 0) found.rtmp = id;

      if (found.hls && found.ts && found.rtmp) break;
    }

    return found;
  }

  private async applyXtreamUserOutputMappings(conn: Connection, userId: number): Promise<void> {
    const tableOk = await this.tableExists(conn, 'user_output');
    if (!tableOk) return;

    const ids = await this.getXtreamAccessOutputIds(conn);
    const desired = [ids.hls, ids.ts, ids.rtmp].filter((v): v is number => Number.isFinite(v as any));
    const fallback = [1, 2, 3];
    const finalDesired = desired.length ? desired : fallback;

    for (const accessOutputId of finalDesired) {
      await conn.execute(
        `INSERT IGNORE INTO \`user_output\` (user_id, access_output_id) VALUES (?, ?)`,
        [userId, accessOutputId]
      );
    }
  }

  private async getTableColumnsMeta(
    conn: Connection,
    tableName: string
  ): Promise<
    Map<
      string,
      { dataType: string; columnType: string; isNullable: 'YES' | 'NO'; columnDefault: string | null; extra: string }
    >
  > {
    const cached = this.columnsMetaCache.get(tableName);
    if (cached) return cached;

    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [tableName]
    );

    const meta = new Map<
      string,
      { dataType: string; columnType: string; isNullable: 'YES' | 'NO'; columnDefault: string | null; extra: string }
    >();
    for (const r of rows as any[]) {
      const name = String(r.COLUMN_NAME);
      meta.set(name, {
        dataType: String(r.DATA_TYPE || ''),
        columnType: String(r.COLUMN_TYPE || ''),
        isNullable: (String(r.IS_NULLABLE || 'YES').toUpperCase() === 'NO' ? 'NO' : 'YES') as 'YES' | 'NO',
        columnDefault: r.COLUMN_DEFAULT === undefined ? null : (r.COLUMN_DEFAULT as any),
        extra: String(r.EXTRA || ''),
      });
    }

    this.columnsMetaCache.set(tableName, meta);
    this.columnsCache.set(tableName, new Set(meta.keys()));
    return meta;
  }

  private async getXtreamAllowedOutputsValue(
    conn: Connection,
    tableName: string,
    columnName: string,
    columnMeta: { dataType: string; columnType: string },
    allowedOutputs: number[]
  ): Promise<string> {
    const cacheKey = `${tableName}.${columnName}.${columnMeta.dataType}.${columnMeta.columnType}`;
    const cached = this.xtreamOutputsValueCache.get(cacheKey);
    if (cached) return cached;

    const dataType = (columnMeta.dataType || '').toLowerCase();
    const columnType = (columnMeta.columnType || '').toLowerCase();
    const numericCsv = allowedOutputs.join(',');
    const candidates = [
      ['m3u8', 'ts', 'rtmp'],
      ['hls', 'mpegts', 'rtmp'],
      ['hls', 'ts', 'rtmp'],
    ] as const;

    let stringPreferred: string[] = [...candidates[0]];

    if (['int', 'tinyint', 'smallint', 'mediumint', 'bigint', 'bit'].includes(dataType)) {
      const value = String(7);
      this.xtreamOutputsValueCache.set(cacheKey, value);
      return value;
    }

    let chosenFormat:
      | 'json-string'
      | 'json-number'
      | 'csv-string'
      | 'csv-number'
      | 'set-string'
      | 'raw-string'
      | 'php-serialize' = 'json-string';

    if (dataType === 'json') {
      chosenFormat = 'json-string';
    } else if (columnType.startsWith('set(')) {
      chosenFormat = 'set-string';
    } else {
      try {
        const [rows] = await conn.execute<RowDataPacket[]>(
          `SELECT \`${columnName}\` AS val FROM \`${tableName}\` WHERE \`${columnName}\` IS NOT NULL AND \`${columnName}\` <> '' LIMIT 1`
        );

        const sample = (rows as any[])?.[0]?.val;

        if (Array.isArray(sample)) {
          const hasString = sample.some((v) => typeof v === 'string');
          chosenFormat = hasString ? 'json-string' : 'json-number';
          if (hasString) {
            const lowerValues = sample.map((v) => String(v).toLowerCase());
            const best = [...candidates]
              .map((c) => ({ c: [...c], score: c.filter((v) => lowerValues.includes(v)).length }))
              .sort((a, b) => b.score - a.score)[0];
            if (best && best.score > 0) stringPreferred = best.c;
          }
        } else if (typeof sample === 'string') {
          const trimmed = sample.trim();
          const lower = trimmed.toLowerCase();

          const best = [...candidates]
            .map((c) => ({ c: [...c], score: c.filter((v) => lower.includes(v)).length }))
            .sort((a, b) => b.score - a.score)[0];
          if (best && best.score > 0) stringPreferred = best.c;

          if (/^\d+(,\d+)*$/.test(trimmed)) {
            chosenFormat = 'csv-number';
          } else if (trimmed.includes(',') && /[a-zA-Z]/.test(trimmed)) {
            chosenFormat = 'csv-string';
          } else if (/^a:\d+:\{/.test(trimmed)) {
            chosenFormat = 'php-serialize';
          } else if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            try {
              const parsed = JSON.parse(trimmed);
              if (Array.isArray(parsed)) {
                const hasString = parsed.some((v) => typeof v === 'string');
                chosenFormat = hasString ? 'json-string' : 'json-number';
                if (hasString) {
                  const lowerValues = parsed.map((v) => String(v).toLowerCase());
                  const bestFromJson = [...candidates]
                    .map((c) => ({ c: [...c], score: c.filter((v) => lowerValues.includes(v)).length }))
                    .sort((a, b) => b.score - a.score)[0];
                  if (bestFromJson && bestFromJson.score > 0) stringPreferred = bestFromJson.c;
                }
              }
            } catch {
            }
          } else {
            if (
              lower.includes('hls') ||
              lower.includes('rtmp') ||
              lower.includes('ts') ||
              lower.includes('mpegts') ||
              lower.includes('m3u8')
            ) {
              chosenFormat = 'raw-string';
            }
          }
        }
      } catch {
      }
    }

    const stringCsv = stringPreferred.join(',');

    let value = JSON.stringify(stringPreferred);
    if (chosenFormat === 'json-number') value = JSON.stringify(allowedOutputs);
    if (chosenFormat === 'csv-number') value = numericCsv;
    if (chosenFormat === 'csv-string') value = stringCsv;
    if (chosenFormat === 'raw-string') value = stringCsv;
    if (chosenFormat === 'php-serialize') {
      const parts: string[] = [];
      stringPreferred.forEach((s, i) => {
        const len = Buffer.byteLength(s, 'utf8');
        parts.push(`i:${i};s:${len}:"${s}";`);
      });
      value = `a:${stringPreferred.length}:{${parts.join('')}}`;
    }
    if (chosenFormat === 'set-string') {
      const values = [...columnType.matchAll(/'([^']*)'/g)].map((m) => m[1]);
      const selected: string[] = [];
      const allNumeric = values.length > 0 && values.every((v) => /^\d+$/.test(v));
      if (allNumeric) {
        for (const v of allowedOutputs.map(String)) {
          if (values.includes(v)) selected.push(v);
        }
      } else {
        const best = [...candidates]
          .map((c) => ({ c: [...c], score: c.filter((v) => values.includes(v)).length }))
          .sort((a, b) => b.score - a.score)[0];
        const selectedValues = best && best.score > 0 ? best.c : stringPreferred;
        for (const v of selectedValues) {
          if (values.includes(v)) selected.push(v);
        }
      }
      value = selected.length ? selected.join(',') : (allNumeric ? numericCsv : stringCsv);
    }

    this.xtreamOutputsValueCache.set(cacheKey, value);
    return value;
  }

  private async applyXtreamAllowedOutputs(conn: Connection, lineId: number, allowedOutputs: number[]): Promise<void> {
    const tableName = this.linesTable;
    const columnsMeta = await this.getTableColumnsMeta(conn, tableName);
    const columns = this.columnsCache.get(tableName) || new Set(columnsMeta.keys());

    const candidateColumns = [
      'allowed_outputs',
      'allowed_output_formats',
      'allowed_output_format',
      'allowed_output',
      'output_formats',
      'output_format',
      '_tipolista',
      'tipolista'
    ];
    const updates: string[] = [];
    const values: any[] = [];

    for (const col of candidateColumns) {
      if (!columns.has(col)) continue;
      const meta = columnsMeta.get(col) || { dataType: '', columnType: '', isNullable: 'YES' as const, columnDefault: null, extra: '' };
      const v = await this.getXtreamAllowedOutputsValue(conn, tableName, col, meta, allowedOutputs);
      updates.push(`\`${col}\` = ?`);
      values.push(v);
    }

    if (!updates.length) {
      await this.applyXtreamUserOutputMappings(conn, lineId);
      return;
    }

    values.push(lineId);
    await conn.execute(`UPDATE \`${tableName}\` SET ${updates.join(', ')} WHERE id = ?`, values);
    await this.applyXtreamUserOutputMappings(conn, lineId);
  }

  /**
   * Retorna o nome da tabela de clientes/linhas baseado no tipo de servidor
   * XUI ONE = `lines`, Xtream UI = `users`
   */
  private get linesTable(): string {
    return this.serverType === 'XTREAMUI' ? 'users' : 'lines';
  }

  /**
   * Verifica se a conexão está ativa
   */
  private async isConnectionAlive(conn: Connection): Promise<boolean> {
    try {
      await conn.ping();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Conecta ao banco XUI.ONE
   * ⚠️ CORREÇÃO: Verifica se conexão existente está ativa antes de reutilizar
   */
  private async connect(): Promise<Connection> {
    // ⚠️ CORREÇÃO: Verificar se conexão existente está ativa
    if (this.connection) {
      const isAlive = await this.isConnectionAlive(this.connection);
      if (isAlive) {
        return this.connection;
      } else {
        // Conexão está morta, limpar e reconectar
        logger.warn('[XUIDB] Conexão existente está morta, reconectando...');
        try {
          await this.connection.end();
        } catch (e) {
          // Ignorar erro ao fechar conexão morta
        }
        this.connection = null;
      }
    }

    // Usar credenciais configuradas no servidor ou fallback
    let dbHost = this.server.dbHost;
    let dbPort = this.server.dbPort || (this.serverType === 'XTREAMUI' ? 7999 : 3306);
    let dbUser = this.server.dbUser;
    let dbPass = this.server.dbPassword;
    let dbName = this.server.dbName || (this.serverType === 'XTREAMUI' ? 'xtream_iptvpro' : 'xui');

    // Fallback: Extrair host da baseUrl se não configurado
    if (!dbHost) {
      try {
        const url = new URL(this.server.baseUrl);
        dbHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' 
          ? 'localhost' 
          : url.hostname;
      } catch {
        dbHost = 'localhost';
      }
    }

    // Se ainda não tiver credenciais, usar valores padrão (compatibilidade)
    if (!dbUser) {
      dbUser = this.serverType === 'XTREAMUI' ? 'user_iptvpro' : 'koffice_user';
    }
    if (!dbPass) {
      // Tentar descriptografar se existir, senão usar padrão
      dbPass = 'senha_segura'; // Fallback temporário
    } else {
      // Descriptografar senha se estiver criptografada
      try {
        const { decrypt } = await import('../utils/crypto.js');
        dbPass = decrypt(dbPass);
      } catch (e) {
        // Se falhar, usar como está (pode já estar descriptografado em dev)
        logger.warn('[XUIDB] Erro ao descriptografar senha do banco, usando como está');
      }
    }
    
    const config = {
      host: dbHost,
      port: dbPort,
      user: dbUser,
      password: dbPass,
      database: dbName,
      connectTimeout: 10000,
    };

    logger.info('[XUIDB] Conectando ao banco XUI.ONE...', { host: config.host });

    try {
      this.connection = await mysql.createConnection(config);
      logger.info('[XUIDB] Conectado ao banco XUI.ONE');
      return this.connection;
    } catch (error: any) {
      logger.error('[XUIDB] Erro ao conectar ao banco:', error.message);
      throw new Error(`Erro ao conectar ao banco XUI.ONE: ${error.message}`);
    }
  }

  /**
   * Desconecta do banco
   */
  async disconnect(): Promise<void> {
    if (this.connection) {
      await this.connection.end();
      this.connection = null;
      logger.info('[XUIDB] Desconectado do banco XUI.ONE');
    }
  }

  /**
   * Executa uma query genérica no banco de dados
   */
  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    const conn = await this.connect();
    try {
      const [rows] = await conn.execute<RowDataPacket[]>(sql, params);
      return rows as T[];
    } catch (error: any) {
      logger.error('[XUIDB] Erro ao executar query:', error.message);
      throw error;
    }
  }

  /**
   * Cria uma linha diretamente no banco (garantindo bouquets e is_trial corretos)
   */
  async createLine(params: CreateLineDBParams): Promise<number> {
    const conn = await this.connect();

    try {
      await conn.beginTransaction();

      // Converter bouquets para JSON string (formato: "[1,2,3]")
      const bouquetJson = JSON.stringify(params.bouquet);
      
      // Converter allowed_outputs para JSON string
      const outputsJson = JSON.stringify(params.allowed_outputs);

      const now = Math.floor(Date.now() / 1000);

      let result: any;

      if (this.serverType === 'XTREAMUI') {
        const tableName = 'users';
        const columnsMeta = await this.getTableColumnsMeta(conn, tableName);

        const bouquetData = params.bouquet.map(id => String(id));
        const bouquetJson = JSON.stringify(bouquetData);

        const coerceUnixSeconds = (
          meta: { dataType: string },
          unixSeconds: number
        ): number | Date => {
          const dt = (meta.dataType || '').toLowerCase();
          if (['datetime', 'timestamp', 'date'].includes(dt)) {
            return new Date(unixSeconds * 1000);
          }
          return unixSeconds;
        };

        const makeDefaultValue = (col: string, meta: { dataType: string; columnType: string }): any => {
          const dt = (meta.dataType || '').toLowerCase();
          if (['int', 'tinyint', 'smallint', 'mediumint', 'bigint', 'decimal', 'float', 'double', 'bit'].includes(dt)) {
            return 0;
          }
          if (['datetime', 'timestamp', 'date'].includes(dt)) {
            return new Date();
          }
          if (dt === 'json') {
            return '[]';
          }
          if (dt === 'enum') {
            const match = meta.columnType.match(/'([^']+)'/);
            return match ? match[1] : '';
          }
          if (dt === 'set') {
            return '';
          }
          if (['char', 'varchar', 'text', 'mediumtext', 'longtext', 'tinytext'].includes(dt)) {
            return '';
          }
          return '';
        };

        const valuesByColumn: Record<string, any> = {
          member_id: params.member_id,
          username: params.username,
          password: params.password,
          exp_date: columnsMeta.has('exp_date')
            ? coerceUnixSeconds(columnsMeta.get('exp_date')!, params.exp_date)
            : params.exp_date,
          is_trial: params.is_trial,
          enabled: 1,
          admin_enabled: 1,
          bouquet: bouquetJson,
          max_connections: params.max_connections || 1,
          admin_notes: params.admin_notes || '',
          reseller_notes: params.reseller_notes || '',
          created_at: columnsMeta.has('created_at')
            ? coerceUnixSeconds(columnsMeta.get('created_at')!, now)
            : now,
          created_by: params.member_id,
          is_restreamer: params.is_restreamer ?? 0,
          allowed_ips: '[]',
          allowed_ua: '[]',
          forced_country: '',
          play_token: '',
          trust_renew: 0,
          phone: null,
          email: null,
          package_id: params.package_id || null,
        };

        const insertColumns: string[] = [];
        const insertValues: any[] = [];

        for (const [col, meta] of columnsMeta.entries()) {
          if (col === 'id' && meta.extra.toLowerCase().includes('auto_increment')) continue;

          const hasExplicit = Object.prototype.hasOwnProperty.call(valuesByColumn, col) && valuesByColumn[col] !== undefined;
          const mustProvide =
            meta.isNullable === 'NO' &&
            meta.columnDefault === null &&
            !meta.extra.toLowerCase().includes('auto_increment');

          if (hasExplicit) {
            insertColumns.push(col);
            insertValues.push(valuesByColumn[col]);
            continue;
          }

          if (mustProvide) {
            insertColumns.push(col);
            insertValues.push(makeDefaultValue(col, meta));
          }
        }

        if (!insertColumns.includes('member_id')) {
          insertColumns.push('member_id');
          insertValues.push(params.member_id);
        }
        if (!insertColumns.includes('username')) {
          insertColumns.push('username');
          insertValues.push(params.username);
        }
        if (!insertColumns.includes('password')) {
          insertColumns.push('password');
          insertValues.push(params.password);
        }

        const sql = `INSERT INTO \`${tableName}\` (${insertColumns.map((c) => `\`${c}\``).join(', ')}) VALUES (${insertColumns.map(() => '?').join(', ')})`;
        [result] = await conn.execute(sql, insertValues);
      } else {
        // XUI ONE: tabela `lines` - com allowed_outputs e package_id
        [result] = await conn.execute(
          `INSERT INTO \`lines\` (
            member_id, username, password, exp_date, is_trial,
            enabled, admin_enabled, bouquet, allowed_outputs,
            max_connections, admin_notes, reseller_notes,
            created_at, package_id, is_restreamer
          ) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            params.member_id,
            params.username,
            params.password,
            params.exp_date,
            params.is_trial,
            bouquetJson,
            outputsJson,
            params.max_connections || 1,
            params.admin_notes || null,
            params.reseller_notes || null,
            now,
            params.package_id || null,
            params.is_restreamer ?? 1,
          ]
        );
      }

      const insertResult = result as any;
      const lineId = insertResult.insertId;

      logger.info('[XUIDB] Linha criada com sucesso', {
        lineId,
        username: params.username,
        is_trial: params.is_trial,
        bouquet: params.bouquet,
      });

      if (this.serverType === 'XTREAMUI') {
        await this.applyXtreamAllowedOutputs(conn, lineId, params.allowed_outputs);
      }

      // CRÍTICO: Fazer um UPDATE simples para "ativar/validar" a linha
      await conn.execute(
        `UPDATE \`${this.linesTable}\` SET reseller_notes = ? WHERE id = ?`,
        [params.reseller_notes || params.admin_notes || '', lineId]
      );

      logger.info('[XUIDB] Linha atualizada para ativação', { lineId });

      await conn.commit();
      return lineId;
    } catch (error: any) {
      await conn.rollback();
      logger.error('[XUIDB] Erro ao criar linha:', error.message);
      throw error;
    }
  }

  /**
   * Verifica se username já existe
   */
  async usernameExists(username: string): Promise<boolean> {
    const conn = await this.connect();

    try {
      const [rows] = await conn.execute<RowDataPacket[]>(
        `SELECT id FROM \`${this.linesTable}\` WHERE username = ? LIMIT 1`,
        [username]
      );

      return rows.length > 0;
    } catch (error: any) {
      logger.error('[XUIDB] Erro ao verificar username:', error.message);
      throw error;
    }
  }

  /**
   * Obtém uma linha pelo ID
   */
  async getLine(id: number): Promise<XUIDBLine | null> {
    const conn = await this.connect();

    try {
      const [rows] = await conn.execute<RowDataPacket[]>(
        `SELECT * FROM \`${this.linesTable}\` WHERE id = ? LIMIT 1`,
        [id]
      );

      if (rows.length === 0) {
        return null;
      }

      return rows[0] as XUIDBLine;
    } catch (error: any) {
      logger.error('[XUIDB] Erro ao buscar linha:', error.message);
      throw error;
    }
  }

  /**
   * Busca TODAS as linhas diretamente do banco (sem limite da API)
   * Útil para importação quando há muitos clientes
   */
  async getAllLines(): Promise<XUIDBLine[]> {
    const conn = await this.connect();

    try {
      const [rows] = await conn.execute<RowDataPacket[]>(
        `SELECT * FROM \`${this.linesTable}\` ORDER BY id`
      );

      logger.info(`[XUIDB] getAllLines encontrou ${rows.length} linhas no banco`);
      return rows as XUIDBLine[];
    } catch (error: any) {
      logger.error('[XUIDB] Erro ao buscar todas as linhas:', error.message);
      throw error;
    }
  }

  /**
   * Busca uma linha por username
   */
  async getLineByUsername(username: string): Promise<XUIDBLine | null> {
    const conn = await this.connect();

    try {
      const [rows] = await conn.execute<RowDataPacket[]>(
        `SELECT * FROM \`${this.linesTable}\` WHERE username = ? LIMIT 1`,
        [username]
      );

      if (rows.length === 0) {
        return null;
      }

      return rows[0] as XUIDBLine;
    } catch (error: any) {
      logger.error(`[XUIDB] Erro ao buscar linha por username ${username}:`, error.message);
      throw error;
    }
  }

  /**
   * Atualiza bouquets de uma linha
   */
  async updateBouquets(lineId: number, bouquets: number[]): Promise<void> {
    const conn = await this.connect();

    try {
      const bouquetJson = JSON.stringify(bouquets);

      await conn.execute(
        `UPDATE \`${this.linesTable}\` SET bouquet = ? WHERE id = ?`,
        [bouquetJson, lineId]
      );

      logger.info('[XUIDB] Bouquets atualizados', { lineId, bouquets });
    } catch (error: any) {
      logger.error('[XUIDB] Erro ao atualizar bouquets:', error.message);
      throw error;
    }
  }

  /**
   * Atualiza is_trial de uma linha
   */
  async updateIsTrial(lineId: number, is_trial: 0 | 1): Promise<void> {
    const conn = await this.connect();

    try {
      await conn.execute(
        `UPDATE \`${this.linesTable}\` SET is_trial = ? WHERE id = ?`,
        [is_trial, lineId]
      );

      logger.info('[XUIDB] is_trial atualizado', { lineId, is_trial });
    } catch (error: any) {
      logger.error('[XUIDB] Erro ao atualizar is_trial:', error.message);
      throw error;
    }
  }

  /**
   * Atualiza data de expiração de uma linha
   */
  async updateExpDate(lineId: number, exp_date: number): Promise<void> {
    const conn = await this.connect();

    try {
      await conn.execute(
        `UPDATE \`${this.linesTable}\` SET exp_date = ? WHERE id = ?`,
        [exp_date, lineId]
      );

      logger.info('[XUIDB] exp_date atualizado', { lineId, exp_date });
    } catch (error: any) {
      logger.error('[XUIDB] Erro ao atualizar exp_date:', error.message);
      throw error;
    }
  }

  /**
   * Atualiza enabled (bloquear/desbloquear)
   */
  async updateEnabled(lineId: number, enabled: 0 | 1): Promise<void> {
    const conn = await this.connect();

    try {
      await conn.execute(
        `UPDATE \`${this.linesTable}\` SET enabled = ? WHERE id = ?`,
        [enabled, lineId]
      );

      logger.info('[XUIDB] enabled atualizado', { lineId, enabled });
    } catch (error: any) {
      logger.error('[XUIDB] Erro ao atualizar enabled:', error.message);
      throw error;
    }
  }

  /**
   * Atualiza múltiplos campos de uma linha
   */
  /**
   * Atualiza uma linha no banco XUI.ONE
   * ⚠️ CORREÇÃO: Implementa retry, verifica affectedRows e valida pós-atualização
   */
  async updateLine(lineId: number, params: {
    exp_date?: number;
    enabled?: 0 | 1;
    is_trial?: 0 | 1;
    max_connections?: number;
    username?: string;
    password?: string;
    admin_notes?: string;
    reseller_notes?: string;
    bouquet?: number[];
    allowed_outputs?: number[];
  }): Promise<void> {
    // ⚠️ CORREÇÃO 1: Usar retry com backoff exponencial para erros de conexão
    await retryDatabase(
      async () => {
        const conn = await this.connect();

        try {
          const updates: string[] = [];
          const values: any[] = [];

          if (params.exp_date !== undefined) {
            updates.push('exp_date = ?');
            values.push(params.exp_date);
          }
          if (params.enabled !== undefined) {
            updates.push('enabled = ?');
            values.push(params.enabled);
          }
          if (params.is_trial !== undefined) {
            updates.push('is_trial = ?');
            values.push(params.is_trial);
          }
          if (params.max_connections !== undefined) {
            updates.push('max_connections = ?');
            values.push(params.max_connections);
          }
          if (params.username !== undefined) {
            updates.push('username = ?');
            values.push(params.username);
          }
          if (params.password !== undefined) {
            updates.push('password = ?');
            values.push(params.password);
          }
          if (params.admin_notes !== undefined) {
            updates.push('admin_notes = ?');
            values.push(params.admin_notes);
          }
          if (params.reseller_notes !== undefined) {
            updates.push('reseller_notes = ?');
            values.push(params.reseller_notes);
          }
          if (params.bouquet !== undefined) {
            updates.push('bouquet = ?');
            values.push(JSON.stringify(params.bouquet));
          }
          if (params.allowed_outputs !== undefined && this.serverType !== 'XTREAMUI') {
            updates.push('allowed_outputs = ?');
            values.push(JSON.stringify(params.allowed_outputs));
          }

          if (updates.length === 0) {
            if (params.allowed_outputs !== undefined && this.serverType === 'XTREAMUI') {
              await this.applyXtreamAllowedOutputs(conn, lineId, params.allowed_outputs);
            }
            return;
          }

          // Atualizar campo `updated` para que o XUI detecte mudanças
          // Apenas XUI ONE tem esse campo, Xtream UI não tem
          if (this.serverType !== 'XTREAMUI') {
            updates.push('updated = NOW()');
          }
          
          values.push(lineId);

          // ⚠️ CORREÇÃO 2: Verificar affectedRows após UPDATE
          const [result] = await conn.execute<ResultSetHeader>(
            `UPDATE \`${this.linesTable}\` SET ${updates.join(', ')} WHERE id = ?`,
            values
          );

          // ⚠️ CORREÇÃO 2: Verificar se realmente atualizou alguma linha
          if (result.affectedRows === 0) {
            throw new Error(`Linha ${lineId} não encontrada ou não foi atualizada (affectedRows: 0)`);
          }

          logger.info('[XUIDB] Linha atualizada', { 
            lineId, 
            updates: Object.keys(params),
            affectedRows: result.affectedRows 
          });

          if (params.allowed_outputs !== undefined && this.serverType === 'XTREAMUI') {
            await this.applyXtreamAllowedOutputs(conn, lineId, params.allowed_outputs);
          }

          // ⚠️ CORREÇÃO 3: Verificação pós-atualização (apenas para campos críticos)
          // Verificar se exp_date foi realmente atualizado (campo mais crítico)
          if (params.exp_date !== undefined) {
            logger.info(`[XUIDB] Verificando pós-atualização: buscando linha ${lineId} para validar exp_date...`);
            const updatedLine = await this.getLine(lineId);
            if (!updatedLine) {
              throw new Error(`Linha ${lineId} não encontrada após atualização`);
            }
            if (updatedLine.exp_date !== params.exp_date) {
              throw new Error(
                `Falha na verificação pós-atualização: exp_date esperado ${params.exp_date}, ` +
                `mas encontrado ${updatedLine.exp_date} na linha ${lineId}`
              );
            }
            logger.info(`[XUIDB] ✅ Verificação pós-atualização OK: exp_date = ${params.exp_date} (${new Date(params.exp_date * 1000).toISOString()})`);
          }

          // Verificar is_trial se foi atualizado
          if (params.is_trial !== undefined) {
            logger.info(`[XUIDB] Verificando pós-atualização: validando is_trial para linha ${lineId}...`);
            const updatedLine = await this.getLine(lineId);
            if (updatedLine && updatedLine.is_trial !== params.is_trial) {
              throw new Error(
                `Falha na verificação pós-atualização: is_trial esperado ${params.is_trial}, ` +
                `mas encontrado ${updatedLine.is_trial} na linha ${lineId}`
              );
            }
            logger.info(`[XUIDB] ✅ Verificação pós-atualização OK: is_trial = ${params.is_trial}`);
          }
        } catch (error: any) {
          logger.error('[XUIDB] Erro ao atualizar linha:', {
            lineId,
            error: error.message,
            stack: error.stack
          });
          throw error;
        }
      },
      {
        maxRetries: 3,
        initialDelay: 500,
        maxDelay: 5000,
        retryableErrorCodes: [
          'ECONNRESET',
          'ETIMEDOUT',
          'PROTOCOL_CONNECTION_LOST',
          'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
          'ECONNREFUSED'
        ],
        onRetry: (attempt, error) => {
          logger.warn(`[XUIDB] Retentando atualização da linha ${lineId} (tentativa ${attempt}/3): ${error.message}`);
        }
      }
    );
  }

  /**
   * Busca pacotes diretamente do banco (fallback quando API não funciona)
   */
  async getPackagesFromDB(): Promise<any[]> {
    const conn = await this.connect();
    try {
      const [rows] = await conn.execute<RowDataPacket[]>(
        'SELECT * FROM `packages` ORDER BY id'
      );
      logger.info(`[XUIDB] getPackagesFromDB encontrou ${rows.length} pacotes`);
      return rows;
    } catch (error: any) {
      logger.error('[XUIDB] Erro ao buscar pacotes:', error.message);
      throw error;
    }
  }

  /**
   * Busca bouquets diretamente do banco (fallback quando API não funciona)
   */
  async getBouquetsFromDB(): Promise<any[]> {
    const conn = await this.connect();
    try {
      const [rows] = await conn.execute<RowDataPacket[]>(
        'SELECT * FROM `bouquets` ORDER BY id'
      );
      logger.info(`[XUIDB] getBouquetsFromDB encontrou ${rows.length} bouquets`);
      return rows;
    } catch (error: any) {
      logger.error('[XUIDB] Erro ao buscar bouquets:', error.message);
      throw error;
    }
  }

  /**
   * Deleta uma linha pelo ID
   */
  async deleteLine(lineId: number): Promise<void> {
    const conn = await this.connect();
    try {
      const [result] = await conn.execute<ResultSetHeader>(
        `DELETE FROM \`${this.linesTable}\` WHERE id = ?`,
        [lineId]
      );
      logger.info('[XUIDB] Linha deletada', { lineId, affectedRows: result.affectedRows });
    } catch (error: any) {
      logger.error('[XUIDB] Erro ao deletar linha:', error.message);
      throw error;
    }
  }

  /**
   * Desconecta automaticamente quando o objeto é destruído
   */
  async destroy(): Promise<void> {
    await this.disconnect();
  }
}
