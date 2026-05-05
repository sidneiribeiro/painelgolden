import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { XUIClient, type XUILine } from '../services/xui.client.js';
import { XUIDBClient } from '../services/xui.db.client.js';
import { decryptApiKey } from './xuiSettings.controller.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { createLogger } from '../utils/logger.js';
import { clampToPrismaInt } from '../utils/prisma-int.utils.js';
import { resolveAllowedCustomerConnections } from '../utils/customer-connections.policy.js';
import { buildM3uUrls } from '../utils/m3u.js';
import { calculateExpTimestamp, unixToDate, isExpired } from '../utils/dateUtils.js';
import { botService } from '../services/bot.service.js';
import { randomUUID } from 'node:crypto';

// Funções auxiliares
function parsePlanPrice(price: string): number {
  // "R$ 30,00" -> 3000
  const cleaned = price.replace(/[^\d,\.]/g, '').replace(',', '.');
  return Math.round(parseFloat(cleaned) * 100);
}

function formatCurrency(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
}

function formatDate(date: Date): string {
  return date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function processTemplate(template: string | null, data: Record<string, any>): string {
  if (!template) return '';
  
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    const regex = new RegExp(`\\{${key}\\}`, 'g');
    result = result.replace(regex, String(value || ''));
  }
  return result;
}

const logger = createLogger('CustomersController');

// ID do reseller super-neo (descoberto na análise do banco)
const SUPER_NEO_MEMBER_ID = 2;

function resolveMemberIdForServer(server: { serverType?: string; xuiResellerId?: number | null }): number {
  const serverType = (server.serverType || 'XUIONE').toUpperCase();
  if (serverType === 'XTREAMUI') {
    const fromConfig = server.xuiResellerId;
    if (typeof fromConfig === 'number' && Number.isFinite(fromConfig) && fromConfig > 0) return fromConfig;
    return 1;
  }
  return SUPER_NEO_MEMBER_ID;
}

// ========================================
// GERAR CREDENCIAIS NUMÉRICAS (9 dígitos)
// ========================================
function generateNumericCredentials(): { username: string; password: string } {
  // Gerar número de 9 dígitos (como o PainelNeo faz)
  // Math.floor(100000000 + Math.random() * 900000000) = 100000000 a 999999999
  const username = Math.floor(100000000 + Math.random() * 900000000).toString();
  let password = Math.floor(100000000 + Math.random() * 900000000).toString();
  
  // Garantir que password é diferente do username
  while (password === username) {
    password = Math.floor(100000000 + Math.random() * 900000000).toString();
  }
  
  return { username, password };
}

// Gera número aleatório de 9 dígitos
function generateRandomNumber(): string {
  // Primeiro dígito nunca é 0 para evitar problemas
  let result = Math.floor(Math.random() * 9 + 1).toString();
  for (let i = 1; i < 9; i++) {
    result += Math.floor(Math.random() * 10).toString();
  }
  return result;
}

// Gera username único
function generateUsername(): string {
  return generateRandomNumber();
}

// Gera password diferente do username
function generatePassword(username: string): string {
  let password = generateRandomNumber();
  // Garantir que password é diferente do username
  while (password === username) {
    password = generateRandomNumber();
  }
  return password;
}

// Verifica se username já existe no XUI
async function isUsernameUnique(client: XUIClient, username: string): Promise<boolean> {
  try {
    const lines = await client.getLines();
    return !lines.some(l => l.username === username);
  } catch {
    return true; // Assume único se falhar a verificação
  }
}

// Gera credenciais únicas (username e password DIFERENTES)
async function generateUniqueCredentials(client: XUIClient): Promise<{ username: string; password: string }> {
  let username = generateUsername();
  
  // Tenta até 5 vezes para garantir unicidade
  for (let attempt = 0; attempt < 5; attempt++) {
    if (await isUsernameUnique(client, username)) {
      break;
    }
    username = generateUsername();
  }
  
  // Gera password diferente do username
  const password = generatePassword(username);
  
  logger.info(`Credenciais geradas: username=${username}, password=${password}`);
  
  return { username, password };
}

// Schemas de validação - Seguindo formato PainelNeo
const createCustomerSchema = z.object({
  server_id: z.string().uuid(),  // OBRIGATÓRIO
  package_id: z.string().uuid(),  // OBRIGATÓRIO
  connections: z.union([z.number(), z.string()]).transform(v => {
    const n = typeof v === 'string' ? parseInt(v, 10) : v;
    const base = isNaN(n) || n < 1 ? 1 : n;
    return clampToPrismaInt(base, 1);
  }).optional().default(1),
  // Para testes
  trial_hours: z.number().optional(),
  // Dados de contato
  name: z.string().optional().nullable(),
  whatsapp: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  telegram: z.string().optional().nullable(),
  // Data personalizada
  expires_at_tz: z.string().optional(),
  plan_price: z.string().optional(),
  // Bouquets (array de IDs)
  bouquets: z.array(z.union([z.string(), z.number()])).optional(),
  // Customização opcional
  username: z.string().optional().nullable(),
  password: z.string().optional().nullable(),
  // Tipo de template a ser usado
  template_type: z.enum(['complete', 'xciptv', 'simple']).optional(),
});

const createTrialSchema = z.object({
  serverId: z.string().uuid().optional(), // Opcional - usa servidor padrão
  hours: z.union([z.number(), z.string()]).transform(v => {
    const n = typeof v === 'string' ? parseInt(v, 10) : v;
    return isNaN(n) ? 6 : n;
  }),
  bouquets: z.array(z.number()).optional(),
  // Dados de contato opcionais
  name: z.string().optional().nullable(),
  whatsapp: z.string().optional().nullable(),
});

const renewSchema = z.object({
  days: z.number().int().min(1),
});

const listFiltersSchema = z.object({
  page: z.string().transform(Number).optional(),
  perPage: z.string().transform(Number).optional(),
  search: z.string().optional(),
  serverId: z.string().optional(),
  status: z.enum(['ACTIVE', 'EXPIRED', 'BANNED']).optional(),
  isTrial: z.enum(['true', 'false']).optional(),
});

// Obtém cliente XUI para um servidor
async function getXuiClientForServer(serverId: string): Promise<XUIClient> {
  const server = await prisma.xuiServer.findUnique({ where: { id: serverId } });
  if (!server) throw new AppError(404, 'Servidor não encontrado');
  if (!server.isActive) throw new AppError(400, 'Servidor desativado');
  
  return new XUIClient(server);
}

// Obtém servidor padrão
async function getDefaultServer() {
  const server = await prisma.xuiServer.findFirst({
    where: { isDefault: true, isActive: true },
  });
  if (!server) {
    // Se não tiver default, pega o primeiro ativo
    return prisma.xuiServer.findFirst({ where: { isActive: true } });
  }
  return server;
}

/**
 * GET /api/customers
 * Listar TODOS os clientes
 */
export const listCustomers = asyncHandler(async (req: Request, res: Response) => {
  try {
  const currentUser = req.user!;
    const { 
      page = 1, 
      perPage = 20, 
      search, 
      status,
      serverId,
      isTrial,
    } = req.query;

    logger.info('[GetCustomers] Buscando...', { page, perPage, search, status });

    // Construir filtros
    const where: any = {};

    // Filtrar por revendedor (se não for admin)
    // Admin pode filtrar por resellerId específico
    const resellerId = req.query.resellerId as string | undefined;
    if (resellerId && ["SUPER_ADMIN", "ADMIN"].includes(currentUser.role)) {
      where.resellerUserId = resellerId;
    } else
    if (!['SUPER_ADMIN', 'ADMIN'].includes(currentUser.role)) {
      where.resellerUserId = currentUser.userId;
    }

    // Filtrar por servidor
    if (serverId) {
      where.serverId = serverId;
    }

    // Filtrar por teste
    if (isTrial !== undefined) {
      where.isTrial = isTrial === 'true';
    }

    // Buscar todos os clientes que atendem os filtros básicos
    const allCustomers = await prisma.customer.findMany({
      where,
      include: {
        package: {
          select: { id: true, name: true }
        },
        server: {
          select: { id: true, name: true, dnsPrimary: true, baseUrl: true }
        },
        reseller: {
          select: { id: true, username: true, name: true }
        }
      },
      orderBy: { createdAt: 'desc' },
    });

    // Mapear com status do banco local ou calculado
    const mapped = allCustomers.map(c => {
      // Usar status do banco se existir, senão calcular
      let calculatedStatus = c.status || 'ACTIVE';
      
      // Se expirado, sempre mostrar como expirado (prioridade sobre status)
      if (c.expiresAt && c.expiresAt < new Date()) {
        calculatedStatus = 'EXPIRED';
      }
      
      // Calcular dias e horas até expirar
      const msUntilExpiry = c.expiresAt ? c.expiresAt.getTime() - Date.now() : 0;
      const daysUntilExpiry = Math.floor(msUntilExpiry / (24 * 60 * 60 * 1000));
      const hoursUntilExpiry = Math.floor(msUntilExpiry / (60 * 60 * 1000));
      
      // Gerar URL M3U - usar DNS primário se configurado, senão baseUrl
      const dns = c.server.dnsPrimary?.trim() || c.server.baseUrl.replace(/\/$/, '');
      const m3uUrl = `${dns}/get.php?username=${c.username}&password=${c.password}&type=m3u_plus&output=mpegts`;
    
      return {
        ...c,
        status: calculatedStatus,
        is_trial: c.isTrial,
        m3u_url: m3uUrl,
        dns: dns,
        days_until_expiry: daysUntilExpiry,
        hours_until_expiry: hoursUntilExpiry,
        expires_at: c.expiresAt.toISOString(),
        created_at: c.createdAt.toISOString(),
      };
    });

    // Filtrar por status se solicitado
    let result = mapped;
    if (status) {
      result = result.filter(c => c.status === status);
    }

    // Filtrar por busca
    if (search) {
      const s = String(search).toLowerCase();
      result = result.filter(c => 
        c.username?.toLowerCase().includes(s) ||
        c.name?.toLowerCase().includes(s) ||
        c.whatsapp?.includes(s)
      );
    }

    // Total após filtros
    const total = result.length;

    // Aplicar paginação
    const skip = (Number(page) - 1) * Number(perPage);
    const paginatedResult = result.slice(skip, skip + Number(perPage));

    logger.info(`[GetCustomers] Encontrados: ${paginatedResult.length} de ${total} (página ${page})`);

    res.json({
      data: paginatedResult,
    meta: {
      total,
      current_page: Number(page),
      per_page: Number(perPage),
      last_page: Math.ceil(total / Number(perPage)),
      from: skip + 1,
      to: Math.min(skip + Number(perPage), total),
    }
  });

  } catch (error: any) {
    logger.error('[GetCustomers] ERRO:', error);
    res.status(500).json({ 
      error: 'Erro ao buscar clientes',
      message: error.message,
    });
  }
});

/**
 * GET /api/customers/expiring
 */
export const getExpiringCustomers = asyncHandler(async (req: Request, res: Response) => {
  const server = await getDefaultServer();
  if (!server) {
    return res.json({ data: [] });
  }

  const client = await getXuiClientForServer(server.id);
  const lines = await client.getLines();
  
  const now = Math.floor(Date.now() / 1000);
  const sevenDaysFromNow = now + (7 * 24 * 60 * 60);
  
  const expiringLines = lines
    .filter(l => l.exp_date > now && l.exp_date <= sevenDaysFromNow && l.enabled === 1)
    .sort((a, b) => a.exp_date - b.exp_date)
    .slice(0, 50);

    res.json({
      data: expiringLines.map(line => ({
      id: String(line.id),
      username: line.username,
      expires_at: new Date(line.exp_date * 1000).toISOString(),
      days_until_expiry: XUIClient.daysUntilExpiry(line.exp_date),
    })),
  });
});

/**
 * GET /api/customers/:serverId/:id
 */
export const getCustomer = asyncHandler(async (req: Request, res: Response) => {
  const { serverId, id } = req.params;
  
  let line: any = null;
  let xuiError: string | null = null;
  
  try {
    const client = await getXuiClientForServer(serverId);
    line = await client.getLine(parseInt(id));
  } catch (error: any) {
    logger.warn(`[GetCustomer] Erro ao buscar linha ${id} no XUI: ${error.message}`);
    xuiError = error.message;
  }

  // Busca dados locais com servidor
  const local = await prisma.customer.findFirst({
    where: { serverId, externalId: id },
    include: { 
      package: true,
      server: {
        select: { id: true, name: true, dnsPrimary: true, baseUrl: true }
      }
    },
  });

  // Se não encontrou nem no XUI nem localmente, retornar erro
  if (!line && !local) {
    return res.status(404).json({ 
      error: 'Cliente não encontrado',
      message: xuiError || 'Cliente não existe no servidor XUI nem no banco local'
    });
  }

  // Se não tem dados do XUI, retornar apenas dados locais
  if (!line) {
    return res.json({
      data: {
        id: local!.externalId,
        username: local!.username,
        password: local!.password,
        status: local!.status,
        is_trial: local!.isTrial,
        connections: local!.connections,
        bouquets: [],
        expires_at: local!.expiresAt?.toISOString(),
        created_at: local!.createdAt?.toISOString(),
        days_until_expiry: local!.expiresAt ? Math.floor((local!.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)) : 0,
        admin_notes: null,
        name: local!.name,
        whatsapp: local!.whatsapp,
        email: local!.email,
        telegram: local!.telegram,
        package: local!.package,
        dns: local!.server?.dnsPrimary || local!.server?.baseUrl || '',
        m3u_url: null,
        urls: null,
        xuiError: xuiError,
      },
    });
  }

      // Determinar status baseado em enabled e exp_date
      let customerStatus = 'ACTIVE';
      const now = Math.floor(Date.now() / 1000);
      if (line.enabled === 0) {
        customerStatus = 'INACTIVE';
      } else if (line.exp_date && line.exp_date < now) {
        customerStatus = 'EXPIRED';
      }

      // Buscar servidor diretamente se não tiver dados locais (cliente existe no XUI mas não no painel)
      let serverInfo = local?.server;
      if (!serverInfo) {
        const server = await prisma.xuiServer.findUnique({
          where: { id: serverId },
          select: { id: true, name: true, dnsPrimary: true, baseUrl: true }
        });
        serverInfo = server;
      }

      // Gerar URLs M3U - usar DNS primário se configurado, senão baseUrl
      const dns = serverInfo?.dnsPrimary?.trim() || serverInfo?.baseUrl?.replace(/\/$/, '') || '';
      const m3uUrl = dns ? `${dns}/get.php?username=${line.username}&password=${line.password}&type=m3u_plus&output=mpegts` : null;

      const responseData = {
          id: String(line.id),
          username: line.username,
          password: line.password,
          status: customerStatus,
          is_trial: line.is_trial === 1,
          connections: line.max_connections,
          bouquets: line.bouquet,
          expires_at: line.exp_date && line.exp_date > 0 ? new Date(line.exp_date * 1000).toISOString() : null,
          created_at: line.created_at && line.created_at > 0 ? new Date(line.created_at * 1000).toISOString() : new Date().toISOString(),
          days_until_expiry: line.exp_date && line.exp_date > 0 ? Math.floor((line.exp_date - Math.floor(Date.now() / 1000)) / (24 * 60 * 60)) : 0,
          admin_notes: line.admin_notes,
          // Dados locais
          name: local?.name || null,
          whatsapp: local?.whatsapp || null,
          email: local?.email || null,
          telegram: local?.telegram || null,
          package: local?.package || null,
          // DNS e URLs
          dns: dns,
          m3u_url: m3uUrl,
          urls: m3uUrl ? {
            m3u_ts: m3uUrl,
            m3u_hls: dns ? `${dns}/get.php?username=${line.username}&password=${line.password}&type=m3u_plus&output=hls` : null,
          } : null,
        };
      
      logger.info('[GetCustomer] Retornando dados:', { id: responseData.id, username: responseData.username, password: responseData.password });
      res.json({ data: responseData });
});

/**
 * POST /api/customers
 * Criar Cliente (Teste ou Normal) - Formato PainelNeo
 */
export const createCustomer = asyncHandler(async (req: Request, res: Response) => {
  try {
  const currentUser = req.user!;
    const {
      server_id,
      package_id,
      connections: connectionsFromBody = 1,
      trial_hours,      // Para testes
      name,
      whatsapp,
      email,
      telegram,
      expires_at_tz,    // Data personalizada (opcional)
      plan_price,
      bouquets,         // Array de IDs de bouquets
      username,         // Username customizado (se fornecido pelo frontend)
      password,         // Password customizado (se fornecido pelo frontend)
    } = req.body;

    logger.info('[CreateCustomer] Request body:', req.body);

    // 1. VALIDAÇÃO CRÍTICA
    if (!server_id) {
      return res.status(400).json({ error: 'server_id é obrigatório' });
    }
    if (!package_id) {
      return res.status(400).json({ error: 'package_id é obrigatório' });
    }

    // 2. Buscar servidor
    const server = await prisma.xuiServer.findUnique({
      where: { id: server_id },
    });

    if (!server) {
      return res.status(404).json({ error: 'Servidor não encontrado' });
    }

    // 3. Buscar pacote
  const pkg = await prisma.package.findUnique({
      where: { id: package_id },
  });

  if (!pkg) {
      return res.status(404).json({ error: 'Pacote não encontrado' });
    }

    const connectionsForXui = resolveAllowedCustomerConnections(
      currentUser.role,
      connectionsFromBody,
      pkg.connections
    );
    const connectionsForPanel = clampToPrismaInt(connectionsForXui, 1);

    // 4. Verificar se é teste
    const isTrial = pkg.isTrial || trial_hours !== undefined;

    logger.info('[CreateCustomer] Pacote:', {
      name: pkg.name,
      isTrial: pkg.isTrial,
      duration: pkg.duration,
      durationUnit: pkg.durationUnit,
      credits: pkg.credits,
      bouquets: pkg.bouquets,
    });

    // 5. Calcular data de expiração
    let expTimestamp: number;

    if (trial_hours) {
      // Teste com horas específicas
      expTimestamp = calculateExpTimestamp(trial_hours, 'HOURS');
    } else if (expires_at_tz || (req.body as any).expires_at) {
      // Data personalizada (aceita ambos os formatos)
      const customDateValue = expires_at_tz || (req.body as any).expires_at;
      const customDate = new Date(customDateValue);
      if (isNaN(customDate.getTime())) {
        return res.status(400).json({ error: 'Data de expiração inválida' });
      }
      expTimestamp = Math.floor(customDate.getTime() / 1000);
    } else {
      // Calcular baseado no pacote
      expTimestamp = calculateExpTimestamp(pkg.duration, pkg.durationUnit);
    }

    const expiresAt = unixToDate(expTimestamp);

    logger.info('[CreateCustomer] Expiração calculada:', {
      expTimestamp,
      expiresAt: expiresAt.toISOString(),
    });

    // 6. Verificar créditos (se não for teste ou teste com custo)
    const creditsRequired = pkg.credits || 0;

    if (creditsRequired > 0) {
      const user = await prisma.user.findUnique({
        where: { id: currentUser.userId },
      });

      if (!user || user.credits < creditsRequired) {
        return res.status(400).json({
          error: 'Créditos insuficientes',
          required: creditsRequired,
          available: user?.credits || 0,
        });
      }
    }

    // 7. Preparar bouquets
    // CORREÇÃO: Aceitar bouquets como array de strings (padrão PainelNeo)
    let bouquetIds: number[] = [];
    
    // Primeiro, tentar do body (aceita strings ou números)
    if (bouquets && Array.isArray(bouquets) && bouquets.length > 0) {
      bouquetIds = bouquets
        .map((b: any) => {
          // Aceitar string ou número
          const num = typeof b === 'string' ? parseInt(b, 10) : Number(b);
          return isNaN(num) ? null : num;
        })
        .filter((b: any) => b !== null) as number[];
    }
    // Segundo, tentar do pacote
    else if (pkg.bouquets) {
      try {
        const pkgBouquets = typeof pkg.bouquets === 'string' 
          ? JSON.parse(pkg.bouquets) 
          : pkg.bouquets;
        if (Array.isArray(pkgBouquets)) {
          bouquetIds = pkgBouquets
            .map((b: any) => {
              const num = typeof b === 'string' ? parseInt(b, 10) : Number(b);
              return isNaN(num) ? null : num;
            })
            .filter((b: any) => b !== null) as number[];
        }
      } catch (e: any) {
        logger.warn('[CreateCustomer] Erro ao parsear bouquets do pacote:', e?.message || String(e));
      }
    }

    logger.info('[CreateCustomer] Bouquets:', bouquetIds);

    if (bouquetIds.length === 0) {
      logger.warn('[CreateCustomer] ATENÇÃO: Nenhum bouquet será passado!');
    }

    // 8. Criar no XUI.ONE DIRETAMENTE NO BANCO (GARANTE BOUQUETS E IS_TRIAL!)
    logger.info('[CreateCustomer] Usando conexão direta ao banco XUI.ONE');

    // ========================================
    // GERAR/USAR CREDENCIAIS (CRÍTICO!)
    // ========================================
    // Se username/password foram fornecidos, usar eles; senão gerar
    let credentials: { username: string; password: string };
    if (username && password) {
      credentials = { username: username.toString(), password: password.toString() };
      logger.info('[CreateCustomer] Usando credenciais fornecidas:', credentials);
    } else {
      credentials = generateNumericCredentials();
      logger.info('[CreateCustomer] Credenciais geradas:', credentials);
    }

    // ========================================
    // PARÂMETROS PARA BANCO DIRETO
    // ========================================

    logger.info('[CreateCustomer] exp_date calculado:', {
      timestamp: expTimestamp,
      data: new Date(expTimestamp * 1000).toISOString()
    });

    // Determinar is_trial
    const xuiIsTrial = pkg.isTrial ? 1 : 0;

    // Bouquets (padrão [1,2,3] se não especificado)
    const finalBouquets = bouquetIds.length > 0 ? bouquetIds : [1, 2, 3];

    // Verificar se o pacote tem externalId numérico (= package_id do XUI)
    let xuiPackageId: number | undefined;
    if (pkg.externalId && /^\d+$/.test(pkg.externalId)) {
      xuiPackageId = parseInt(pkg.externalId);
      logger.info('[CreateCustomer] Package ID do XUI encontrado: ' + xuiPackageId);
    }

    const memberId = resolveMemberIdForServer(server as any);

    // CRIAR DIRETAMENTE NO BANCO (garante credenciais corretas e controle total)
    const dbClient = new XUIDBClient(server);
    let lineId: number;

    try {
      logger.info('[CreateCustomer] Criando linha diretamente no banco XUI.ONE...');
      
      // Verificar se username já existe no banco
      const usernameExists = await dbClient.usernameExists(credentials.username);
      
      if (usernameExists) {
        // Tentar gerar novo username
        const newCredentials = generateNumericCredentials();
        logger.warn('[CreateCustomer] Username já existe, gerando novo:', newCredentials);
        credentials.username = newCredentials.username;
        credentials.password = newCredentials.password;
      }

      // Criar linha diretamente no banco com TODOS os campos corretos
      lineId = await dbClient.createLine({
        username: credentials.username,
        password: credentials.password,
        exp_date: expTimestamp,
        is_trial: xuiIsTrial as 0 | 1,
        member_id: memberId,
        bouquet: finalBouquets,
        allowed_outputs: [1, 2, 3], // HLS, MPEGTS, RTMP
        max_connections: connectionsForXui,
        admin_notes: `painel-iptv - ${pkg.name}`,
        reseller_notes: (req.body as any).reseller_notes || null,
        package_id: xuiPackageId,
      });

      logger.info('[CreateCustomer] Linha criada no banco:', { 
        lineId, 
        username: credentials.username,
        exp_date: expTimestamp,
        is_trial: xuiIsTrial, 
        bouquets: finalBouquets 
      });

      // Desconectar do banco
      await dbClient.disconnect();

      // 2. ATIVAR VIA API fazendo um editLine COMPLETO (força XUI a processar e cachear a linha)
      // ⚠️ CORREÇÃO CRÍTICA: Esta chamada é OBRIGATÓRIA - sem ela o XUI não reconhece a linha
      // O INSERT direto no MySQL não atualiza o cache interno do XUI, fazendo com que
      // o cliente não consiga logar até que alguém edite/salve manualmente no painel XUI.
      let apiActivated = false;
      const MAX_EDIT_RETRIES = 3;
      
      for (let attempt = 1; attempt <= MAX_EDIT_RETRIES; attempt++) {
        try {
          logger.info(`[CreateCustomer] Ativando linha via API do XUI (tentativa ${attempt}/${MAX_EDIT_RETRIES})...`, { lineId });
          const xuiClient = await getXuiClientForServer(server_id);
          
          // Passar TODOS os campos para forçar o XUI a processar completamente a linha
          const editResult = await xuiClient.editLine(lineId, {
            username: credentials.username,
            password: credentials.password,
            exp_date: expTimestamp,
            max_connections: connectionsForXui,
            bouquets: finalBouquets,
            allowed_outputs: [1, 2, 3],
            is_trial: xuiIsTrial as 0 | 1,
            enabled: 1,
            admin_notes: `painel-iptv - ${pkg.name}`,
            reseller_notes: (req.body as any).reseller_notes || undefined,
          });
          
          if (editResult.result) {
            logger.info('[CreateCustomer] ✅ Linha ativada via API do XUI com sucesso', { lineId, attempt });
            apiActivated = true;
            break;
          } else {
            logger.warn(`[CreateCustomer] API editLine retornou result=false (tentativa ${attempt})`, editResult);
          }
        } catch (apiError: any) {
          logger.warn(`[CreateCustomer] Erro na tentativa ${attempt}/${MAX_EDIT_RETRIES} de ativar via API:`, apiError.message);
        }
        
        // Aguardar antes de retentar (2 segundos entre tentativas)
        if (attempt < MAX_EDIT_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      // FALLBACK: Se API falhou, forçar ativação via UPDATE direto no banco
      if (!apiActivated) {
        logger.warn('[CreateCustomer] ⚠️ API falhou após todas tentativas. Forçando ativação via DB...');
        try {
          const fallbackDb = new XUIDBClient(server);
          await fallbackDb.updateLine(lineId, {
            enabled: 1,
            exp_date: expTimestamp,
            max_connections: connectionsForXui,
          });
          await fallbackDb.disconnect();
          logger.info('[CreateCustomer] ✅ Fallback DB executado - linha atualizada com updated=NOW()');
        } catch (dbFallbackError: any) {
          logger.error('[CreateCustomer] ❌ Fallback DB também falhou:', dbFallbackError.message);
        }
      }
    } catch (error: any) {
      // Tentar desconectar se dbClient foi criado
      if (dbClient) {
        try {
          await dbClient.disconnect();
        } catch (disconnectError) {
          // Ignorar erro de desconexão
        }
      }
      logger.error('[CreateCustomer] Erro ao criar linha:', error.message);
      return res.status(500).json({ 
        error: `Erro ao criar linha no XUI: ${error.message}`,
        message: error.message,
      });
    }

    // IMPORTANTE: Usar as credenciais que definimos no banco
    const finalUsername = credentials.username;
    const finalPassword = credentials.password;

    // 9. Debitar créditos
    if (creditsRequired > 0) {
      const user = await prisma.user.findUnique({
        where: { id: currentUser.userId },
      });

      if (user && user.credits >= creditsRequired) {
  await prisma.user.update({
    where: { id: currentUser.userId },
          data: {
            credits: { decrement: creditsRequired }
          }
  });

        await prisma.creditTransaction.create({
          data: {
            userId: currentUser.userId,
            type: 'SALE',
            amount: -creditsRequired,
            description: `${isTrial ? 'Teste' : 'Cliente'} ${pkg.name} - ${finalUsername}`,
            balanceBefore: user.credits,
            balanceAfter: user.credits - creditsRequired,
            relatedId: String(lineId),
            relatedType: 'customer',
          }
        });
      }
    }

    // 10. Registrar pagamento manual automaticamente (se não for teste)
    if (!isTrial && pkg?.planPrice) {
      try {
        await prisma.manualPayment.create({
          data: {
            customerId: '', // Será atualizado após criar o cliente
            value: pkg.planPrice / 100, // Converter de centavos para reais
            paymentDate: new Date(),
            method: 'MANUAL',
            notes: `Pagamento automático - Cliente criado`,
            createdBy: currentUser.userId,
          },
        });
      } catch (paymentError: any) {
        // Não falhar se não conseguir registrar pagamento
        logger.warn(`[CreateCustomer] Erro ao registrar pagamento automático: ${paymentError.message}`);
      }
    }

    // 11. Gerar token de pagamento único
    const crypto = await import('crypto');
    const paymentToken = crypto.randomBytes(32).toString('hex');

    // 11. Salvar no banco local
    const customer = await prisma.customer.create({
    data: {
        serverId: server.id,
        externalId: String(lineId),
        username: finalUsername,
        password: finalPassword,
        name: name || null,
        whatsapp: whatsapp || null,
        email: email || null,
        telegram: telegram || null,
      packageId: pkg.id,
      resellerUserId: currentUser.userId,
        isTrial: isTrial,
        connections: connectionsForPanel,
        expiresAt: expiresAt,
        status: 'ACTIVE',
        paymentToken: paymentToken,
      }
    });

    logger.info(`[CreateCustomer] Cliente salvo: ${customer.id}`);

    // Registrar pagamento manual automático (se não for teste e tiver pacote)
    if (!isTrial && pkg?.planPrice && customer.id) {
      try {
        await prisma.manualPayment.create({
          data: {
            customerId: customer.id,
            value: pkg.planPrice / 100,
            paymentDate: new Date(),
            method: 'MANUAL',
            notes: `Pagamento automático - Cliente criado`,
            createdBy: currentUser.userId,
          },
        });
        logger.info(`[CreateCustomer] Pagamento automático registrado: R$ ${(pkg.planPrice / 100).toFixed(2)} para cliente ${customer.id}`);
      } catch (paymentError: any) {
        logger.warn(`[CreateCustomer] Erro ao registrar pagamento automático: ${paymentError.message}`);
      }
    }


    // 11. Gerar URLs (usar DNS primário se configurado, senão baseUrl)
    const dns = (server.dnsPrimary?.trim() || server.baseUrl).replace(/\/$/, '');
    let dnsHost = '';
    try {
      dnsHost = new URL(dns).hostname;
    } catch {
      dnsHost = dns.replace(/^https?:\/\//, '').split('/')[0];
    }

    const urls = {
      m3u_ts: `${dns}/get.php?username=${finalUsername}&password=${finalPassword}&type=m3u_plus&output=mpegts`,
      m3u_hls: `${dns}/get.php?username=${finalUsername}&password=${finalPassword}&type=m3u_plus&output=hls`,
      ssiptv: `http://e.${dnsHost}/p/${finalUsername}/${finalPassword}/ssiptv`,
    };

    // 12. Processar template (se disponível)
    // Determinar qual template usar baseado no template_type
    const templateType = req.body.template_type || 'complete';
    let selectedTemplate: string | null = null;
    
    logger.info('[CreateCustomer] Template type recebido:', templateType);
    logger.info('[CreateCustomer] Templates disponíveis no pacote:', {
      hasTemplate: !!pkg.template,
      hasTemplateXciptv: !!pkg.templateXciptv,
      hasTemplateSimple: !!pkg.templateSimple,
    });
    
    // Lógica corrigida: tentar usar o template específico, se não houver, usar o completo como fallback
    if (templateType === 'xciptv') {
      selectedTemplate = pkg.templateXciptv || pkg.template || null;
      logger.info('[CreateCustomer] Usando template XCIPTV', { hasTemplate: !!selectedTemplate });
    } else if (templateType === 'simple') {
      selectedTemplate = pkg.templateSimple || pkg.template || null;
      logger.info('[CreateCustomer] Usando template Simple (App Parceiro)', { hasTemplate: !!selectedTemplate });
    } else {
      // 'complete' ou default
      selectedTemplate = pkg.template || null;
      logger.info('[CreateCustomer] Usando template completo', { hasTemplate: !!selectedTemplate });
    }
    
    let playlist = '';
    if (selectedTemplate) {
      const templateData: Record<string, any> = {
        username: finalUsername,
        password: finalPassword,
        package: pkg.name,
        packageName: pkg.name,
        plan_price: plan_price || formatCurrency(pkg.planPrice || 0),
        created_at: formatDate(new Date()),
        expires_at: formatDate(expiresAt),
        expiresAt: formatDate(expiresAt),
        connections: connectionsForXui,
        dns: dns || 'Não configurado',
        DNS: dns || 'Não configurado', // Maiúscula também
        dns_host: dnsHost,
        m3uUrl: urls.m3u_ts,
        m3u_url: urls.m3u_ts,
        m3u_ts: urls.m3u_ts,
        m3u_hls: urls.m3u_hls,
        ssiptv: urls.ssiptv,
      };
      playlist = processTemplate(selectedTemplate, templateData);
      logger.info('[CreateCustomer] Template processado com sucesso');
    } else {
      logger.warn('[CreateCustomer] Nenhum template encontrado para o tipo:', templateType);
    }

    // 13. Enviar notificação de boas-vindas se tiver WhatsApp
    if (whatsapp) {
      try {
        await botService.sendWelcomeNotification(
          req.user!.userId,
          {
            ...customer,
            package: pkg,
            server: server,
            m3u_url: urls.m3u_ts,
            dns: dns,
          } as any,
          isTrial
        );
      } catch (error) {
        logger.error(`Erro ao enviar notificação de boas-vindas: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // 14. Resposta
  res.status(201).json({
    data: {
        id: customer.id,
        xuiLineId: lineId,
        username: finalUsername,
        password: finalPassword,
        expiresAt: expiresAt,
        expiresAtTz: formatDate(expiresAt),
      package: pkg.name,
        isTrial: isTrial,
        connections: connectionsForXui,
        server: server.name,
        dns: dns,
        urls,
        playlist,
        creditsUsed: creditsRequired,
      },
    });

  } catch (error: any) {
    logger.error('[CreateCustomer] ERRO:', error);
    res.status(500).json({ 
      error: 'Erro ao criar cliente',
      message: error.message,
    });
  }
});

/**
 * POST /api/customers/trial
 * Criar TESTE (Trial)
 */
export const createTrial = asyncHandler(async (req: Request, res: Response) => {
  try {
  const currentUser = req.user!;
    const { serverId, packageId, name, whatsapp, connections: trialConnectionsRaw = 1 } = req.body;

    logger.info('[CreateTrial] Iniciando...', { serverId, packageId, name });

    // 1. Validar campos obrigatórios
    if (!serverId || !packageId) {
      return res.status(400).json({ 
        error: 'serverId e packageId são obrigatórios' 
      });
    }

    // 2. Buscar pacote com servidor
    const pkg = await prisma.package.findUnique({
      where: { id: packageId },
      include: { server: true }
    });

    if (!pkg) {
      return res.status(404).json({ error: 'Pacote não encontrado' });
    }

    if (!pkg.isTrial) {
      return res.status(400).json({ 
        error: 'Este pacote não é de teste. Use o endpoint de criação normal.' 
      });
    }

    const connectionsForXui = resolveAllowedCustomerConnections(
      currentUser.role,
      trialConnectionsRaw,
      pkg.connections
    );
    const connectionsForPanel = clampToPrismaInt(connectionsForXui, 1);

    logger.info('[CreateTrial] Pacote encontrado:', {
      name: pkg.name,
      duration: pkg.duration,
      durationUnit: pkg.durationUnit,
      bouquets: pkg.bouquets,
    });

    // 3. Verificar créditos (se necessário)
    const creditsRequired = pkg.credits || 0;
    
    if (creditsRequired > 0) {
      const user = await prisma.user.findUnique({
        where: { id: currentUser.userId }
      });

      if (!user || user.credits < creditsRequired) {
        return res.status(400).json({
          error: 'Créditos insuficientes',
          required: creditsRequired,
          available: user?.credits || 0,
        });
      }
    }

    // 4. CALCULAR DATA DE EXPIRAÇÃO (CRÍTICO!)
    const expTimestamp = calculateExpTimestamp(pkg.duration, pkg.durationUnit);
    const expiresAt = unixToDate(expTimestamp);

    logger.info('[CreateTrial] Data calculada:', {
      duration: pkg.duration,
      unit: pkg.durationUnit,
      expTimestamp,
      expiresAt: expiresAt.toISOString(),
    });

    // 5. Buscar bouquets do pacote
    let bouquets: number[] = [];
    if (pkg.bouquets) {
      try {
        const parsed = typeof pkg.bouquets === 'string' 
          ? JSON.parse(pkg.bouquets) 
          : pkg.bouquets;
        if (Array.isArray(parsed)) {
          bouquets = parsed.map(b => typeof b === 'string' ? parseInt(b, 10) : b).filter(b => !isNaN(b));
        }
      } catch (e: any) {
        logger.warn('[CreateTrial] Erro ao parsear bouquets:', e?.message || String(e));
      }
    }

    if (bouquets.length === 0) {
      const allBouquets = await prisma.bouquet.findMany({ where: { serverId: pkg.serverId } });
      bouquets = allBouquets.map(b => parseInt(b.externalId)).filter(b => !isNaN(b));
      logger.warn('[CreateTrial] ATENÇÃO: Pacote sem bouquets! Usando todos do servidor.');
    }

    // 6. Criar no XUI.ONE DIRETAMENTE NO BANCO (GARANTE BOUQUETS E IS_TRIAL!)
    logger.info('[CreateTrial] Usando conexão direta ao banco XUI.ONE');

    // ========================================
    // GERAR CREDENCIAIS NUMÉRICAS (CRÍTICO!)
    // ========================================
    const credentials = generateNumericCredentials();
    logger.info('[CreateTrial] Credenciais geradas:', credentials);

    // ========================================
    // CALCULAR DATA DE EXPIRAÇÃO (CRÍTICO!)
    // ========================================
    logger.info('[CreateTrial] exp_date calculado', { expTimestamp });
    logger.info('[CreateTrial] exp_date legível', { expiresAt: expiresAt.toISOString() });
    
    // Bouquets (padrão [1,2,3] se não especificado)
    const finalBouquets = bouquets.length > 0 ? bouquets : [1, 2, 3];

    // ESTRATÉGIA DEFINITIVA: Criar no banco com TUDO correto, depois ativar via API
    const dbClient = new XUIDBClient(pkg.server);
    let lineId: number;

    try {
      logger.info('[CreateTrial] Criando linha diretamente no banco com credenciais corretas...');
      
      // Verificar se username já existe
      const usernameExists = await dbClient.usernameExists(credentials.username);
      if (usernameExists) {
        // Tentar gerar novo username
        const newCredentials = generateNumericCredentials();
        logger.warn('[CreateTrial] Username já existe, gerando novo:', newCredentials);
        credentials.username = newCredentials.username;
        credentials.password = newCredentials.password;
      }

      // 1. CRIAR DIRETAMENTE NO BANCO com TUDO correto
      const memberId = resolveMemberIdForServer(pkg.server as any);
      lineId = await dbClient.createLine({
        username: credentials.username,
        password: credentials.password,
        exp_date: expTimestamp, // CRÍTICO: Define expiração (desativa never expires)
        is_trial: 1, // ← É TESTE!
        member_id: memberId,
        bouquet: finalBouquets,
        allowed_outputs: [1, 2, 3], // HLS, MPEGTS, RTMP
        max_connections: connectionsForXui,
        admin_notes: `painel-iptv - TESTE ${pkg.name}`,
        reseller_notes: undefined,
        package_id: undefined,
      });

      logger.info('[CreateTrial] Linha criada no banco:', { 
        lineId, 
        username: credentials.username,
        exp_date: expTimestamp,
        is_trial: 1, 
        bouquets: finalBouquets 
      });

      // Desconectar do banco
      await dbClient.disconnect();

      // 2. ATIVAR VIA API fazendo um editLine COMPLETO (força XUI a processar e cachear a linha)
      // ⚠️ CORREÇÃO CRÍTICA: Esta chamada é OBRIGATÓRIA - sem ela o XUI não reconhece a linha
      let trialApiActivated = false;
      const MAX_TRIAL_RETRIES = 3;
      
      for (let attempt = 1; attempt <= MAX_TRIAL_RETRIES; attempt++) {
        try {
          logger.info(`[CreateTrial] Ativando linha via API do XUI (tentativa ${attempt}/${MAX_TRIAL_RETRIES})...`, { lineId });
          const xuiClient = await getXuiClientForServer(serverId);
          
          // Passar TODOS os campos para forçar o XUI a processar completamente a linha
          const editResult = await xuiClient.editLine(lineId, {
            username: credentials.username,
            password: credentials.password,
            exp_date: expTimestamp,
            max_connections: connectionsForXui,
            bouquets: finalBouquets,
            allowed_outputs: [1, 2, 3],
            is_trial: 1,
            enabled: 1,
            admin_notes: `painel-iptv - TESTE ${pkg.name}`,
          });
          
          if (editResult.result) {
            logger.info('[CreateTrial] ✅ Linha ativada via API do XUI com sucesso', { lineId, attempt });
            trialApiActivated = true;
            break;
          } else {
            logger.warn(`[CreateTrial] API editLine retornou result=false (tentativa ${attempt})`, editResult);
          }
        } catch (apiError: any) {
          logger.warn(`[CreateTrial] Erro na tentativa ${attempt}/${MAX_TRIAL_RETRIES} de ativar via API:`, apiError.message);
        }
        
        // Aguardar antes de retentar
        if (attempt < MAX_TRIAL_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      // FALLBACK: Se API falhou, forçar ativação via UPDATE direto no banco
      if (!trialApiActivated) {
        logger.warn('[CreateTrial] ⚠️ API falhou após todas tentativas. Forçando ativação via DB...');
        try {
          const fallbackDb = new XUIDBClient(pkg.server);
          await fallbackDb.updateLine(lineId, {
            enabled: 1,
            exp_date: expTimestamp,
            max_connections: connectionsForXui,
          });
          await fallbackDb.disconnect();
          logger.info('[CreateTrial] ✅ Fallback DB executado - linha atualizada com updated=NOW()');
        } catch (dbFallbackError: any) {
          logger.error('[CreateTrial] ❌ Fallback DB também falhou:', dbFallbackError.message);
        }
      }
    } catch (error: any) {
      logger.error('[CreateTrial] Erro ao criar linha:', error.message);
      return res.status(500).json({ 
        error: `Erro ao criar linha no XUI: ${error.message}`,
        message: error.message,
      });
    }

    // IMPORTANTE: Usar as credenciais que definimos no banco
    const finalUsername = credentials.username;
    const finalPassword = credentials.password;

    // 7. Debitar créditos (se necessário)
    if (creditsRequired > 0) {
      await prisma.user.update({
        where: { id: currentUser.userId },
        data: {
          credits: { decrement: creditsRequired }
        }
      });

      const user = await prisma.user.findUnique({
        where: { id: currentUser.userId },
      });

      if (user) {
        await prisma.creditTransaction.create({
          data: {
            userId: currentUser.userId,
            type: 'SALE',
            amount: -creditsRequired,
            description: `Teste ${pkg.name} - ${finalUsername}`,
            balanceBefore: user.credits,
            balanceAfter: user.credits - creditsRequired,
            relatedId: String(lineId),
            relatedType: 'customer',
          }
        });
      }
    }

    // 8. Gerar token de pagamento único
    const crypto = await import('crypto');
    const paymentToken = crypto.randomBytes(32).toString('hex');

    // 9. Salvar no banco local
    const customer = await prisma.customer.create({
    data: {
        serverId: pkg.server.id,
        externalId: String(lineId),
        username: finalUsername,
        password: finalPassword,
        name: name || null,
        whatsapp: whatsapp || null,
        packageId: pkg.id,
      resellerUserId: currentUser.userId,
      isTrial: true,
        connections: connectionsForPanel,
        expiresAt: expiresAt,  // ← DATE VÁLIDO!
        paymentToken: paymentToken,
      }
    });

    logger.info(`[CreateTrial] Cliente salvo: ${customer.id}`);

    // 9. Gerar URLs (usar DNS primário se configurado, senão baseUrl)
    const dns = (pkg.server.dnsPrimary?.trim() || pkg.server.baseUrl).replace(/\/$/, '');
    const urls = buildM3uUrls(dns, finalUsername, finalPassword);

    // 10. Enviar notificação de boas-vindas se tiver WhatsApp
    if (whatsapp) {
      try {
        await botService.sendWelcomeNotification(
          req.user!.userId,
          {
            ...customer,
            package: pkg,
            server: pkg.server,
            m3u_url: urls.m3u_ts,
            dns: dns,
          } as any,
          true // Sempre é teste
        );
      } catch (error) {
        logger.error(`Erro ao enviar notificação de boas-vindas para teste: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // 🚀 AGENDAMENTO: Notificação 1 hora antes do vencimento do teste
    try {
      const now = new Date();
      const oneHourBeforeExpiry = new Date(expiresAt.getTime() - 60 * 60 * 1000);
      const delayMs = oneHourBeforeExpiry.getTime() - now.getTime();

      // Só agenda se o vencimento for mais de 1 hora no futuro
      if (delayMs > 0) {
        logger.info(`[CreateTrial] ⏰ Agendando notificação de vencimento para ${customer.username}`, {
          scheduledFor: oneHourBeforeExpiry.toISOString(),
          delayMinutes: Math.floor(delayMs / 60000),
        });

        setTimeout(async () => {
          try {
            // Buscar configurações atualizadas do usuário
            const settings = await prisma.notificationSettings.findUnique({
              where: { userId: currentUser.userId },
            });

            if (!settings || !settings.enabled) {
              logger.info(`[CreateTrial] Notificações desabilitadas para usuário ${currentUser.userId}, pulando envio agendado`);
              return;
            }

            // Verificar se o cliente ainda existe e é um teste ativo
            const currentCustomer = await prisma.customer.findUnique({
              where: { id: customer.id },
              include: { package: true, server: true },
            });

            if (!currentCustomer || !currentCustomer.isTrial || currentCustomer.status !== 'ACTIVE') {
              logger.info(`[CreateTrial] Cliente ${customer.username} não é mais um teste ativo, pulando notificação agendada`);
              return;
            }

            // Verificar se já foi enviada notificação recentemente (evitar duplicidade)
            const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
            const alreadySent = await prisma.notificationLog.findFirst({
              where: {
                userId: currentUser.userId,
                customerId: customer.id,
                type: 'TRIAL_EXPIRY_REMINDER',
                createdAt: { gte: twoHoursAgo },
              },
            });

            if (alreadySent) {
              logger.info(`[CreateTrial] Notificação de teste já enviada recentemente para ${customer.username}, pulando`);
              return;
            }

            // Enviar notificação de vencimento
            logger.info(`[CreateTrial] 📤 Enviando notificação agendada de vencimento para ${customer.username}`);
            await botService.sendTrialExpiryNotification(currentUser.userId, currentCustomer, settings);
            logger.info(`[CreateTrial] ✅ Notificação agendada enviada com sucesso para ${customer.username}`);

          } catch (scheduledError) {
            logger.error(`[CreateTrial] ❌ Erro ao enviar notificação agendada para ${customer.username}:`, scheduledError);
          }
        }, delayMs);
      } else {
        logger.info(`[CreateTrial] Teste ${customer.username} vence em menos de 1 hora, não agendando notificação`);
      }
    } catch (schedulingError) {
      logger.warn('[CreateTrial] Erro ao agendar notificação de vencimento:', schedulingError);
      // Não falha a criação do teste se o agendamento falhar
    }

    // 11. Retornar sucesso
  res.status(201).json({
      success: true,
    data: {
        id: customer.id,
        xuiLineId: lineId,
        username: finalUsername,
        password: finalPassword,
        expiresAt: expiresAt,
        package: pkg.name,
        isTrial: true,
        connections: connectionsForXui,
        dns: dns,
        urls,
      }
    });

  } catch (error: any) {
    logger.error('[CreateTrial] ERRO:', error);
    res.status(500).json({ 
      error: 'Erro ao criar teste',
      message: error.message,
    });
  }
});

/**
 * POST /api/customers/:serverId/:id/renew
 * Renovar cliente usando conexão direta ao banco
 */
export const renewCustomer = asyncHandler(async (req: Request, res: Response) => {
  const { serverId, id } = req.params;
  const { 
    days, 
    expires_at,  // Data específica (opcional)
    package_id,
    convert_to_official,  // Converter teste em ativo
    debit_credits = true,  // Se deve debitar créditos
  } = req.body;
  const currentUser = req.user!;

  // Buscar cliente local
  const customer = await prisma.customer.findFirst({
    where: { serverId, externalId: id },
    include: { package: true, server: true },
  });

  if (!customer) {
    throw new AppError(404, 'Cliente não encontrado');
  }

  // IMPORTANTE: Usar o servidor do request (serverId), não o customer.server
  // Isso garante que estamos buscando no servidor correto, mesmo se houver múltiplos servidores
  const server = await prisma.xuiServer.findUnique({
    where: { id: serverId },
  });

  if (!server) {
    throw new AppError(404, 'Servidor XUI não encontrado');
  }

  const dbClient = new XUIDBClient(server);

  try {
    // Buscar linha atual no XUI
    // ⚠️ CORREÇÃO: Tentar buscar por ID primeiro, depois por username como fallback
    let line = await dbClient.getLine(parseInt(id));
    
    // Se não encontrar por ID, tentar buscar por username (fallback)
    if (!line && customer.username) {
      logger.warn(`[RenewCustomer] Cliente ${id} não encontrado por ID, tentando buscar por username: ${customer.username}`);
      
      try {
        line = await dbClient.getLineByUsername(customer.username);
        
        // Se encontrar por username, atualizar externalId para sincronizar
        if (line) {
          logger.info(`[RenewCustomer] ✅ Cliente encontrado por username! ID XUI: ${line.id}, externalId local: ${id}`);
          logger.info(`[RenewCustomer] Atualizando externalId de "${id}" para "${line.id}" para sincronizar`);
          
          // Atualizar externalId no banco local
          await prisma.customer.updateMany({
            where: { serverId, externalId: id },
            data: { externalId: String(line.id) },
          });
          
          logger.info(`[RenewCustomer] ✅ externalId atualizado com sucesso`);
        } else {
          logger.warn(`[RenewCustomer] Cliente também não encontrado por username: ${customer.username}`);
        }
      } catch (usernameError: any) {
        logger.error(`[RenewCustomer] Erro ao buscar por username: ${usernameError.message}`);
        // Continuar para lançar erro abaixo
      }
    }
    
    if (!line) {
      throw new AppError(
        404, 
        `Cliente não encontrado no XUI. ID local: ${id}, Username: ${customer.username || 'N/A'}. ` +
        `Verifique se o cliente existe no servidor XUI ${server.name}.`
      );
    }

    // Calcular nova data de expiração
    let newExpDate: number;
    
    if (expires_at) {
      // Data específica fornecida
      const customDate = new Date(expires_at);
      if (isNaN(customDate.getTime())) {
        throw new AppError(400, 'Data de expiração inválida');
      }
      newExpDate = Math.floor(customDate.getTime() / 1000);
    } else {
      // Adicionar dias à data atual
      const daysToAdd = days || customer.package?.duration || 30;
      const currentExp = line.exp_date || Math.floor(Date.now() / 1000);
      const now = Math.floor(Date.now() / 1000);
      const baseDate = currentExp > now ? currentExp : now; // Usar maior entre atual e agora
      newExpDate = baseDate + (daysToAdd * 24 * 60 * 60);
    }

    // ⚠️ CORREÇÃO: Atualizar no banco XUI PRIMEIRO e verificar sucesso antes de atualizar localmente
    // ⚠️ CORREÇÃO BUG RENOVAÇÃO: Sempre incluir enabled=1 para REATIVAR o cliente no XUI
    const updateParams: any = {
      exp_date: newExpDate,
      enabled: 1, // ⚠️ CRÍTICO: Reativar cliente no XUI após renovação
    };

    // Se converter teste em ativo (SEMPRE converter se for teste e estiver renovando)
    if (line.is_trial === 1) {
      updateParams.is_trial = 0;
      logger.info(`[RenewCustomer] Convertendo teste ${id} para cliente ativo`);
    }

    // ⚠️ CORREÇÃO CRÍTICA: Atualizar XUI primeiro e garantir sucesso antes de atualizar localmente
    // ⚠️ CORREÇÃO BUG: Usar line.id (ID real do XUI) ao invés de id do parâmetro
    // Isso é CRÍTICO quando o cliente foi encontrado por username com ID diferente
    const xuiLineId = line.id; // ID real do XUI (pode ser diferente do parâmetro 'id')
    logger.info(`[RenewCustomer] Atualizando XUI para cliente ${xuiLineId} (exp_date: ${newExpDate}, enabled: 1, ${new Date(newExpDate * 1000).toISOString()})`);
    try {
      await dbClient.updateLine(xuiLineId, updateParams);
      logger.info(`[RenewCustomer] ✅ XUI atualizado com sucesso para cliente ${xuiLineId} (enabled=1)`);
    } catch (xuiError: any) {
      // ⚠️ CORREÇÃO: Se XUI falhar, NÃO atualizar localmente e lançar erro
      logger.error(`[RenewCustomer] ❌ ERRO CRÍTICO: Falha ao atualizar XUI para cliente ${xuiLineId}:`, {
        error: xuiError.message,
        stack: xuiError.stack,
        updateParams
      });
      throw new AppError(
        500,
        `Falha ao atualizar cliente no servidor XUI. A renovação não foi aplicada. ` +
        `Erro: ${xuiError.message}. Por favor, tente novamente.`
      );
    }
    
    // ⚠️ CORREÇÃO: Só atualizar localmente se XUI foi atualizado com sucesso
    // ⚠️ CORREÇÃO BUG: Atualizar externalId para line.id (ID correto) se necessário
    // Atualizar isTrial local também
    if (line.is_trial === 1) {
      await prisma.customer.updateMany({
        where: { serverId, externalId: id },
        data: { 
          isTrial: false,
          externalId: String(line.id) // ⚠️ Garantir que externalId está sincronizado
        },
      });
    } else {
      // Garantir sincronização do externalId mesmo se não for trial
      if (id !== String(line.id)) {
        logger.info(`[RenewCustomer] Sincronizando externalId: ${id} → ${line.id}`);
        await prisma.customer.updateMany({
          where: { serverId, externalId: id },
          data: { externalId: String(line.id) },
        });
      }
    }

    // Debitar créditos se necessário
    let updatedUserCredits = null;
    if (debit_credits && customer.package?.credits && customer.package.credits > 0) {
      const user = await prisma.user.findUnique({
        where: { id: currentUser.userId },
      });

      if (user && user.credits >= customer.package.credits) {
        const updatedUser = await prisma.user.update({
          where: { id: currentUser.userId },
          data: {
            credits: { decrement: customer.package.credits }
          },
          select: { credits: true }
        });

        updatedUserCredits = updatedUser.credits;

        await prisma.creditTransaction.create({
          data: {
            userId: currentUser.userId,
            type: 'SALE',
            amount: -customer.package.credits,
            description: `Renovação ${customer.package.name} - ${customer.username}`,
            balanceBefore: user.credits,
            balanceAfter: updatedUser.credits,
            relatedId: id,
            relatedType: 'customer',
          }
        });
      } else {
        logger.warn(`[RenewCustomer] Créditos insuficientes para ${currentUser.userId}`);
        throw new AppError(400, `Créditos insuficientes. Necessário: ${customer.package.credits}, Disponível: ${user?.credits || 0}`);
      }
    }

    // ⚠️ CORREÇÃO: Atualizar dados locais APENAS se XUI foi atualizado com sucesso
    // ⚠️ CORREÇÃO BUG RENOVAÇÃO: Incluir status=ACTIVE para reativar no painel também
    // ⚠️ CORREÇÃO BUG: Usar line.id (ID correto) como referência
    logger.info(`[RenewCustomer] Atualizando dados locais para cliente ${line.id} (expiresAt: ${new Date(newExpDate * 1000).toISOString()}, status: ACTIVE)`);
    await prisma.customer.updateMany({
      where: { serverId, externalId: String(line.id) }, // ⚠️ Usar line.id atualizado
      data: { 
        expiresAt: new Date(newExpDate * 1000),
        status: 'ACTIVE', // ⚠️ CRÍTICO: Reativar cliente no painel após renovação
        // isTrial já foi atualizado acima se era teste
      },
    });
    logger.info(`[RenewCustomer] ✅ Dados locais atualizados para cliente ${line.id} (status=ACTIVE)`);

    // Log de ação
    await prisma.actionLog.create({
      data: {
        userId: currentUser.userId,
        action: 'RENEW_CUSTOMER',
        entity: 'customer',
        entityId: String(line.id), // ⚠️ Usar line.id correto
        details: JSON.stringify({ 
          days: days || 'N/A',
          expires_at: expires_at || 'N/A',
          newExpDate: new Date(newExpDate * 1000).toISOString(),
          convertedToOfficial: convert_to_official || false,
          originalId: id, // Registrar ID original para debug
          finalId: String(line.id), // ID final usado
        }),
        ip: req.ip,
      },
    });

    await dbClient.disconnect();

    logger.info(`Cliente ${id} renovado. Nova expiração: ${new Date(newExpDate * 1000).toISOString()}`);

    // Enviar notificação de renovação se tiver WhatsApp
    if (customer.whatsapp) {
      try {
        // Buscar cliente atualizado com nova data de expiração
        const updatedCustomer = await prisma.customer.findUnique({
          where: { id: customer.id },
          include: {
            package: true,
            server: true,
          },
        });
        
        if (updatedCustomer) {
          await botService.sendRenewalNotification(
            req.user!.userId,
            updatedCustomer as any
          );
        }
      } catch (error) {
        logger.error(`Erro ao enviar notificação de renovação: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Buscar cliente atualizado com pacote para registrar pagamento
    // ⚠️ CORREÇÃO BUG: Usar line.id (ID correto) ao invés de id
    const renewedCustomerWithPackage = await prisma.customer.findFirst({
      where: { serverId, externalId: String(line.id) },
      include: { package: true },
    });

    // Registrar pagamento manual automático (se não for teste e tiver pacote)
    if (renewedCustomerWithPackage && !renewedCustomerWithPackage.isTrial && renewedCustomerWithPackage.package?.planPrice) {
      try {
        await prisma.manualPayment.create({
          data: {
            customerId: renewedCustomerWithPackage.id,
            value: renewedCustomerWithPackage.package.planPrice / 100,
            paymentDate: new Date(),
            method: 'MANUAL',
            notes: `Pagamento automático - Cliente renovado`,
            createdBy: currentUser.userId,
          },
        });
        logger.info(`[RenewCustomer] Pagamento automático registrado: R$ ${(renewedCustomerWithPackage.package.planPrice / 100).toFixed(2)} para cliente ${renewedCustomerWithPackage.id}`);
      } catch (paymentError: any) {
        logger.warn(`[RenewCustomer] Erro ao registrar pagamento automático: ${paymentError.message}`);
      }
    }

    // Buscar créditos atualizados se não tiver sido debitado
    if (!updatedUserCredits) {
      const currentUserData = await prisma.user.findUnique({
        where: { id: currentUser.userId },
        select: { credits: true }
      });
      updatedUserCredits = currentUserData?.credits || null;
    }

    // Buscar cliente atualizado para retornar externalId correto (pode ter sido atualizado durante a renovação)
    const updatedCustomer = await prisma.customer.findFirst({
      where: { serverId, externalId: String(line.id) },
      select: { externalId: true, username: true },
    });

    res.json({
      success: true,
      message: 'Cliente renovado com sucesso',
      newExpiresAt: new Date(newExpDate * 1000).toISOString(),
      convertedToOfficial: convert_to_official || false,
      userCredits: updatedUserCredits, // Retornar créditos atualizados
      customer: updatedCustomer ? {
        externalId: updatedCustomer.externalId,
        username: updatedCustomer.username,
      } : undefined, // Retornar externalId atualizado para o frontend atualizar cache
    });
  } catch (error: any) {
    await dbClient.disconnect().catch(() => {});
    throw error;
  }
});

/**
 * PUT /api/customers/:serverId/:id
 * Editar cliente (nome, senha, conexões, etc.)
 */
export const updateCustomer = asyncHandler(async (req: Request, res: Response) => {
  const { serverId, id } = req.params;
  const { 
    name,
    email,
    whatsapp,
    telegram,
    username,
    password,
    max_connections,
    expires_at,  // Data de vencimento (ISO string)
    packageId,   // ID do pacote (para atualizar)
    notes,
    reseller_notes,
  } = req.body;
  const currentUser = req.user!;

  // Buscar cliente local com servidor
  const customer = await prisma.customer.findFirst({
    where: { serverId, externalId: id },
    include: { server: true, package: true },
  });

  if (!customer) {
    throw new AppError(404, 'Cliente não encontrado');
  }

  const dbClient = new XUIDBClient(customer.server);

  try {
    let panelConnectionsUpdate: number | undefined;

    let packageForConnectionPolicy = customer.package;
    if (packageId) {
      const pkgForCap = await prisma.package.findUnique({ where: { id: packageId } });
      if (!pkgForCap) {
        throw new AppError(404, 'Pacote não encontrado');
      }
      packageForConnectionPolicy = pkgForCap;
    }

    // Preparar atualizações no XUI (banco direto)
    const xuiUpdates: {
      exp_date?: number;
      max_connections?: number;
      username?: string;
      password?: string;
      reseller_notes?: string;
      admin_notes?: string;
    } = {};

    // Data de vencimento
    if (expires_at) {
      const customDate = new Date(expires_at);
      if (isNaN(customDate.getTime())) {
        throw new AppError(400, 'Data de expiração inválida');
      }
      xuiUpdates.exp_date = Math.floor(customDate.getTime() / 1000);
    }

    // Usuário
    if (username) {
      xuiUpdates.username = username;
    }

    // Senha
    if (password) {
      xuiUpdates.password = password;
    }

    // Conexões: revendas limitadas (igual pacotes); admin sem teto de revenda
    if (max_connections !== undefined && max_connections !== null && max_connections !== '') {
      const mc =
        typeof max_connections === 'string'
          ? parseInt(max_connections, 10)
          : Number(max_connections);
      if (Number.isFinite(mc)) {
        const xuiVal = Math.max(1, Math.trunc(mc));
        const allowed = resolveAllowedCustomerConnections(
          currentUser.role,
          xuiVal,
          packageForConnectionPolicy?.connections ?? null
        );
        xuiUpdates.max_connections = allowed;
        panelConnectionsUpdate = clampToPrismaInt(allowed, 1);
      }
    }

    // Notas do reseller
    if (reseller_notes !== undefined) {
      xuiUpdates.reseller_notes = reseller_notes;
    }

    // Atualizar no XUI se houver mudanças
    if (Object.keys(xuiUpdates).length > 0) {
      await dbClient.updateLine(parseInt(id), xuiUpdates);
      logger.info(`[UpdateCustomer] XUI atualizado: ${Object.keys(xuiUpdates).join(', ')}`);
    }

    // Atualizar dados locais
    const updateData: {
      name?: string;
      email?: string;
      whatsapp?: string;
      telegram?: string;
      username?: string;
      password?: string;
      connections?: number;
      expiresAt?: Date;
      packageId?: string;
    } = {};

    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (whatsapp !== undefined) updateData.whatsapp = whatsapp;
    if (telegram !== undefined) updateData.telegram = telegram;
    if (username) updateData.username = username;
    if (password) updateData.password = password;
    if (panelConnectionsUpdate !== undefined) {
      updateData.connections = panelConnectionsUpdate;
    }
    if (expires_at) {
      const customDate = new Date(expires_at);
      updateData.expiresAt = customDate;
    }
    if (packageId) {
      updateData.packageId = packageId;
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.customer.update({
        where: { id: customer.id },
        data: updateData,
      });
    }

    await dbClient.disconnect();

    // Log de ação
    await prisma.actionLog.create({
      data: {
        userId: currentUser.userId,
        action: 'UPDATE_CUSTOMER',
        entity: 'customer',
        entityId: id,
        details: JSON.stringify({ 
          localUpdated: Object.keys(updateData),
          xuiUpdated: Object.keys(xuiUpdates),
        }),
        ip: req.ip,
      },
    });

    // Buscar cliente atualizado
    const updatedCustomer = await prisma.customer.findUnique({
      where: { id: customer.id },
      include: { package: true, server: true },
    });

    logger.info(`Cliente ${id} atualizado: local=${Object.keys(updateData).join(', ')}, xui=${Object.keys(xuiUpdates).join(', ')}`);


    res.json({success: true,
      message: 'Cliente atualizado com sucesso',
      data: updatedCustomer,
    });
  } catch (error: any) {
    await dbClient.disconnect().catch(() => {});
    throw error;
  }
});

/**
 * POST /api/customers/:serverId/:id/block
 * Bloquear cliente usando conexão direta ao banco
 */
export const blockCustomer = asyncHandler(async (req: Request, res: Response) => {
  const { serverId, id } = req.params;

  // Buscar servidor
  const server = await prisma.xuiServer.findUnique({
    where: { id: serverId },
  });

  if (!server) {
    throw new AppError(404, 'Servidor não encontrado');
  }

  const dbClient = new XUIDBClient(server);

  try {
    // Atualizar enabled = 0 no XUI
    await dbClient.updateEnabled(parseInt(id), 0);

    // Atualiza local
    await prisma.customer.updateMany({
      where: { serverId, externalId: id },
      data: { status: 'INACTIVE' },
    });

    await dbClient.disconnect();

    await prisma.actionLog.create({
      data: {
        userId: req.user!.userId,
        action: 'BLOCK_CUSTOMER',
        entity: 'customer',
        entityId: id,
        ip: req.ip,
      },
    });

    logger.info(`Cliente ${id} bloqueado com sucesso`);
    

    res.json({success: true,
      message: 'Cliente bloqueado com sucesso' 
    });
  } catch (error: any) {
    await dbClient.disconnect().catch(() => {});
    throw error;
  }
});

/**
 * POST /api/customers/:serverId/:id/unblock
 * Desbloquear cliente usando conexão direta ao banco
 */
export const unblockCustomer = asyncHandler(async (req: Request, res: Response) => {
  const { serverId, id } = req.params;

  // Buscar servidor
  const server = await prisma.xuiServer.findUnique({
    where: { id: serverId },
  });

  if (!server) {
    throw new AppError(404, 'Servidor não encontrado');
  }

  const dbClient = new XUIDBClient(server);

  try {
    // Atualizar enabled = 1 no XUI
    await dbClient.updateEnabled(parseInt(id), 1);

    // Buscar linha atualizada para verificar status
    const updatedLine = await dbClient.getLine(parseInt(id));
    
    // Atualiza local
    await prisma.customer.updateMany({
      where: { serverId, externalId: id },
      data: { status: 'ACTIVE' },
    });

    await dbClient.disconnect();

    await prisma.actionLog.create({
      data: {
        userId: req.user!.userId,
        action: 'UNBLOCK_CUSTOMER',
        entity: 'customer',
        entityId: id,
        ip: req.ip,
      },
    });

    logger.info(`Cliente ${id} desbloqueado com sucesso`);
    

    res.json({success: true,
      message: 'Cliente desbloqueado com sucesso' 
    });
  } catch (error: any) {
    await dbClient.disconnect().catch(() => {});
    throw error;
  }
});

/**
 * DELETE /api/customers/:serverId/:id
 * ⚠️ IMPORTANTE: Remove apenas do banco local, NÃO deleta do XUI.ONE
 * (Conforme solicitado pelo usuário para evitar problemas)
 */
export const deleteCustomer = asyncHandler(async (req: Request, res: Response) => {
  const { serverId, id } = req.params;

  // 1. Buscar cliente local para confirmar que existe
  const customer = await prisma.customer.findFirst({
    where: { serverId, externalId: id },
    include: { server: true },
  });

  if (!customer) {
    throw new AppError(404, 'Cliente não encontrado');
  }

  logger.info('[DeleteCustomer] Iniciando exclusão', { 
    serverId, 
    externalId: id, 
    username: customer.username,
    serverType: customer.server.serverType,
  });

  // 2. Deletar do XUI (Xtream UI ou XUI ONE) via DB
  let xuiDeleted = false;
  const xuiLineId = parseInt(id, 10);

  if (!isNaN(xuiLineId) && xuiLineId > 0) {
    try {
      const dbClient = new XUIDBClient(customer.server);
      
      // Verificar se a linha existe no XUI antes de deletar
      const line = await dbClient.getLine(xuiLineId);
      
      if (line) {
        // Confirmar que é o mesmo username (segurança extra)
        if (line.username === customer.username) {
          await dbClient.deleteLine(xuiLineId);
          xuiDeleted = true;
          logger.info('[DeleteCustomer] Linha removida do XUI', { 
            lineId: xuiLineId, 
            username: line.username,
          });
        } else {
          logger.warn('[DeleteCustomer] Username nao confere - NAO deletou do XUI', {
            localUsername: customer.username,
            xuiUsername: line.username,
            lineId: xuiLineId,
          });
        }
      } else {
        logger.info('[DeleteCustomer] Linha nao encontrada no XUI (ja removida?)', { lineId: xuiLineId });
        xuiDeleted = true;
      }
      
      await dbClient.disconnect();
    } catch (dbError: any) {
      logger.error('[DeleteCustomer] Erro ao deletar do XUI:', dbError.message);
      // Continua para deletar do local mesmo assim
    }
  } else {
    logger.warn('[DeleteCustomer] externalId nao e numerico valido, pulando exclusao do XUI', { id });
  }

  // 3. Deletar do banco local
  await prisma.customer.deleteMany({
    where: { serverId, externalId: id },
  });

  // 4. Log da acao
  await prisma.actionLog.create({
    data: {
      userId: req.user!.userId,
      action: 'DELETE_CUSTOMER',
      entity: 'customer',
      entityId: id,
      ip: req.ip,
      details: JSON.stringify({ 
        username: customer.username, 
        xuiDeleted,
        serverType: customer.server.serverType,
      }),
    },
  });

  logger.info('[DeleteCustomer] Exclusao concluida', { 
    username: customer.username, 
    xuiDeleted,
  });

  res.json({
    message: xuiDeleted 
      ? 'Cliente removido do painel e do servidor XUI' 
      : 'Cliente removido do painel (falha ao remover do XUI)',
    xuiDeleted,
  });
});

/**
 * POST /api/customers/:serverId/:id/renew-trial
 * Renovar teste (converter teste em ativo ou apenas renovar)
 */
export const renewTrial = asyncHandler(async (req: Request, res: Response) => {
  const { serverId, id } = req.params;
  const { 
    days,
    expires_at,  // Data específica (opcional)
    convert_to_official = true,  // Converter teste em ativo (padrão: sim)
    debit_credits = true,
  } = req.body;
  const currentUser = req.user!;

  // Buscar cliente local
  const customer = await prisma.customer.findFirst({
    where: { serverId, externalId: id },
    include: { package: true, server: true },
  });

  if (!customer) {
    throw new AppError(404, 'Cliente não encontrado');
  }

  if (!customer.isTrial) {
    throw new AppError(400, 'Este cliente não é um teste');
  }

  // IMPORTANTE: Usar o servidor do request (serverId), não o customer.server
  // Isso garante que estamos buscando no servidor correto, mesmo se houver múltiplos servidores
  const server = await prisma.xuiServer.findUnique({
    where: { id: serverId },
  });

  if (!server) {
    throw new AppError(404, 'Servidor XUI não encontrado');
  }

  const dbClient = new XUIDBClient(server);

  try {
    // Buscar linha atual no XUI
    // ⚠️ CORREÇÃO: Tentar buscar por ID primeiro, depois por username como fallback
    let line = await dbClient.getLine(parseInt(id));
    
    // Se não encontrar por ID, tentar buscar por username (fallback)
    if (!line && customer.username) {
      logger.warn(`[RenewTrial] Cliente ${id} não encontrado por ID, tentando buscar por username: ${customer.username}`);
      
      try {
        line = await dbClient.getLineByUsername(customer.username);
        
        // Se encontrar por username, atualizar externalId para sincronizar
        if (line) {
          logger.info(`[RenewTrial] ✅ Cliente encontrado por username! ID XUI: ${line.id}, externalId local: ${id}`);
          logger.info(`[RenewTrial] Atualizando externalId de "${id}" para "${line.id}" para sincronizar`);
          
          // Atualizar externalId no banco local
          await prisma.customer.updateMany({
            where: { serverId, externalId: id },
            data: { externalId: String(line.id) },
          });
          
          logger.info(`[RenewTrial] ✅ externalId atualizado com sucesso`);
        } else {
          logger.warn(`[RenewTrial] Cliente também não encontrado por username: ${customer.username}`);
        }
      } catch (usernameError: any) {
        logger.error(`[RenewTrial] Erro ao buscar por username: ${usernameError.message}`);
        // Continuar para lançar erro abaixo
      }
    }
    
    if (!line) {
      throw new AppError(
        404, 
        `Cliente não encontrado no XUI. ID local: ${id}, Username: ${customer.username || 'N/A'}. ` +
        `Verifique se o cliente existe no servidor XUI ${server.name}.`
      );
    }

    if (line.is_trial !== 1) {
      throw new AppError(400, 'Este cliente não é um teste no XUI');
    }

    // Calcular nova data de expiração
    let newExpDate: number;
    
    if (expires_at) {
      const customDate = new Date(expires_at);
      if (isNaN(customDate.getTime())) {
        throw new AppError(400, 'Data de expiração inválida');
      }
      newExpDate = Math.floor(customDate.getTime() / 1000);
    } else {
      const daysToAdd = days || customer.package?.duration || 30;
      const currentExp = line.exp_date || Math.floor(Date.now() / 1000);
      const now = Math.floor(Date.now() / 1000);
      const baseDate = currentExp > now ? currentExp : now;
      newExpDate = baseDate + (daysToAdd * 24 * 60 * 60);
    }

    // Atualizar no banco XUI
    const updateParams: any = {
      exp_date: newExpDate,
    };

    // Converter teste em ativo se solicitado
    if (convert_to_official) {
      updateParams.is_trial = 0;
    }

    await dbClient.updateLine(parseInt(id), updateParams);

    // Debitar créditos se necessário
    let updatedUserCredits = null;
    if (debit_credits && customer.package?.credits && customer.package.credits > 0) {
      const user = await prisma.user.findUnique({
        where: { id: currentUser.userId },
      });

      if (user && user.credits >= customer.package.credits) {
        const updatedUser = await prisma.user.update({
          where: { id: currentUser.userId },
          data: {
            credits: { decrement: customer.package.credits }
          },
          select: { credits: true }
        });

        updatedUserCredits = updatedUser.credits;

        await prisma.creditTransaction.create({
          data: {
            userId: currentUser.userId,
            type: 'SALE',
            amount: -customer.package.credits,
            description: `Renovação teste ${customer.package.name} - ${customer.username}`,
            balanceBefore: user.credits,
            balanceAfter: updatedUser.credits,
            relatedId: id,
            relatedType: 'customer',
          }
        });
      } else {
        logger.warn(`[RenewTrial] Créditos insuficientes para ${currentUser.userId}`);
        throw new AppError(400, `Créditos insuficientes. Necessário: ${customer.package.credits}, Disponível: ${user?.credits || 0}`);
      }
    }

    // Atualizar dados locais
    await prisma.customer.updateMany({
      where: { serverId, externalId: id },
      data: { 
        expiresAt: new Date(newExpDate * 1000),
        isTrial: convert_to_official ? false : true,
      },
    });

    // Log de ação
    await prisma.actionLog.create({
      data: {
        userId: currentUser.userId,
        action: 'RENEW_TRIAL',
        entity: 'customer',
        entityId: id,
        details: JSON.stringify({ 
          days: days || 'N/A',
          expires_at: expires_at || 'N/A',
          newExpDate: new Date(newExpDate * 1000).toISOString(),
          convert_to_official,
        }),
        ip: req.ip,
      },
    });

    await dbClient.disconnect();

    logger.info(`Teste ${id} renovado. Nova expiração: ${new Date(newExpDate * 1000).toISOString()}, Convertido: ${convert_to_official}`);

    // Buscar créditos atualizados se não tiver sido debitado
    if (!updatedUserCredits) {
      const currentUserData = await prisma.user.findUnique({
        where: { id: currentUser.userId },
        select: { credits: true }
      });
      updatedUserCredits = currentUserData?.credits || null;
    }

    // Buscar cliente atualizado para retornar externalId correto (pode ter sido atualizado durante a renovação)
    const updatedCustomer = await prisma.customer.findFirst({
      where: { serverId, externalId: String(line.id) },
      select: { externalId: true, username: true },
    });

    res.json({
      success: true,
      message: convert_to_official ? 'Teste renovado e convertido em cliente ativo' : 'Teste renovado',
      newExpiresAt: new Date(newExpDate * 1000).toISOString(),
      convertedToOfficial: convert_to_official,
      userCredits: updatedUserCredits, // Retornar créditos atualizados
      customer: updatedCustomer ? {
        externalId: updatedCustomer.externalId,
        username: updatedCustomer.username,
      } : undefined, // Retornar externalId atualizado para o frontend atualizar cache
    });
  } catch (error: any) {
    await dbClient.disconnect().catch(() => {});
    throw error;
  }
});

/**
 * GET /api/customers/live
 * Conexões ao vivo
 */
export const getLiveConnections = asyncHandler(async (req: Request, res: Response) => {
  const { serverId } = req.query;

  let server;
  if (serverId) {
    server = await prisma.xuiServer.findUnique({ where: { id: serverId as string } });
  } else {
    server = await getDefaultServer();
  }

  if (!server) {
    return res.json({ data: [], total: 0 });
  }

  const client = await getXuiClientForServer(server.id);
  const connections = await client.getLiveConnections();

    res.json({

      data: connections,
      total: connections.length,
  });
});

/**
 * GET /api/customers/:serverId/:id/playlist
 */
export const getPlaylist = asyncHandler(async (req: Request, res: Response) => {
  const { serverId, id } = req.params;

  const server = await prisma.xuiServer.findUnique({ where: { id: serverId } });
  if (!server) throw new AppError(404, 'Servidor não encontrado');

  const client = await getXuiClientForServer(serverId);
  
  let line;
  try {
    line = await client.getLine(parseInt(id));
  } catch (error: any) {
    logger.error(`Erro ao buscar linha ${id}: ${error.message}`);
    throw new AppError(404, 'Cliente não encontrado no XUI');
  }

  if (!line || !line.username) {
    throw new AppError(404, 'Cliente não encontrado no XUI');
  }

  // Monta URLs - usa a mesma base URL do servidor (XUI.ONE usa mesma porta)
  // Remove accessCode se estiver na URL
  let baseUrl = server.baseUrl;
  // Remove trailing slash
  baseUrl = baseUrl.replace(/\/$/, '');
  
  const m3uUrl = `${baseUrl}/get.php?username=${line.username}&password=${line.password}&type=m3u_plus&output=ts`;

  const message = `📺 *Dados de Acesso*

👤 Usuário: ${line.username}
🔑 Senha: ${line.password}

📡 Link M3U:
${m3uUrl}`;

    res.json({
    username: line.username,
    password: line.password,
    m3u_url: m3uUrl,
    message,
  });
});

/**
 * Busca uma linha no XUI por username
 */
async function findLineByUsername(client: XUIClient, username: string): Promise<XUILine | null> {
  try {
    const lines = await client.getLines();
    return lines.find(l => l.username === username) || null;
  } catch (error: any) {
    logger.error(`Erro ao buscar linha por username ${username}: ${error.message}`);
    return null;
  }
}

/**
 * Mapeia nome do pacote do SIGMA para ID do pacote no nosso painel
 * Se não encontrar, usa o pacote padrão "1 Mês Completo"
 */
async function mapPackageNameToId(serverId: string, packageName: string): Promise<string | null> {
  try {
    // Buscar pacotes no servidor
    const packages = await prisma.package.findMany({
      where: { serverId, isActive: true },
      select: { id: true, name: true },
    });

    if (packages.length === 0) {
      logger.warn(`[ImportSigma] Nenhum pacote encontrado no servidor ${serverId}`);
      return null;
    }

    // Mapeamentos comuns (case-insensitive)
    const normalizedName = packageName.toLowerCase().trim();
    
    // Tenta encontrar por nome exato (case-insensitive)
    const exactMatch = packages.find(p => p.name.toLowerCase().trim() === normalizedName);
    if (exactMatch) return exactMatch.id;

    // Mapeamentos manuais comuns
    const mappings: Record<string, string[]> = {
      '1 mês completo': ['1 mês', 'mensal', '30 dias'],
      '6 meses completo por 5 créditos': ['6 meses', 'semestral'],
      '12 meses completo por 10 créditos': ['12 meses', 'anual'],
      '3 meses completo': ['3 meses', 'trimestral'],
      '4 meses completo por 3 créditos': ['4 meses'],
    };

    for (const [key, aliases] of Object.entries(mappings)) {
      if (normalizedName.includes(key) || aliases.some(alias => normalizedName.includes(alias))) {
        const matched = packages.find(p => {
          const pkgName = p.name.toLowerCase().trim();
          return pkgName.includes(key) || aliases.some(alias => pkgName.includes(alias));
        });
        if (matched) return matched.id;
      }
    }

    // Se não encontrar, tenta encontrar pacote padrão "1 Mês" (qualquer variação)
    const defaultPackageKeywords = ['1 mês', 'mensal', '30 dias', 'completo'];
    for (const keyword of defaultPackageKeywords) {
      const defaultMatch = packages.find(p => {
        const pkgName = p.name.toLowerCase().trim();
        return pkgName.includes(keyword);
      });
      if (defaultMatch) {
        logger.info(`[ImportSigma] Usando pacote padrão "${defaultMatch.name}" para "${packageName}"`);
        return defaultMatch.id;
      }
    }

    // Se ainda não encontrar, usa o primeiro pacote disponível
    logger.warn(`[ImportSigma] Pacote "${packageName}" não encontrado, usando primeiro pacote disponível: "${packages[0].name}"`);
    return packages[0].id;
  } catch (error: any) {
    logger.error(`Erro ao mapear pacote ${packageName}: ${error.message}`);
    return null;
  }
}

/**
 * Parse CSV string com suporte a campos com vírgulas (usando aspas)
 */
function parseCSV(csvText: string): Record<string, string>[] {
  const lines = csvText.split('\n').filter(line => line.trim());
  if (lines.length < 2) return [];

  // Parse header
  const headers = parseCSVLine(lines[0]);
  const results: Record<string, string>[] = [];

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length !== headers.length) {
      logger.warn(`Linha ${i + 1} tem ${values.length} colunas, esperado ${headers.length}`);
      continue;
    }
    
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    results.push(row);
  }

  return results;
}

/**
 * Parse uma linha CSV, lidando com campos entre aspas
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escape de aspas ("" dentro de "campo")
        current += '"';
        i++; // Skip próxima aspa
      } else {
        // Inicio/fim de campo entre aspas
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // Fim do campo
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  // Adiciona último campo
  result.push(current.trim());
  return result;
}

/**
 * POST /api/customers/import-sigma
 * Importa clientes do SIGMA (Paineneo) via CSV
 */
export const importSigmaCustomers = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  
  // Apenas SUPER_ADMIN e ADMIN podem importar
  if (currentUser.role !== 'SUPER_ADMIN' && currentUser.role !== 'ADMIN') {
    throw new AppError(403, 'Apenas administradores podem importar clientes');
  }

  if (!req.body.csv || typeof req.body.csv !== 'string') {
    throw new AppError(400, 'CSV é obrigatório');
  }

  const csvText = req.body.csv;
  const serverId = req.body.serverId; // Opcional - usa servidor padrão se não informado
  
  logger.info(`[ImportSigma] Iniciando importação de ${csvText.split('\n').length - 1} clientes`);

  // Obter servidor (padrão se não informado)
  let server;
  if (serverId) {
    server = await prisma.xuiServer.findUnique({ where: { id: serverId } });
    if (!server) throw new AppError(404, 'Servidor não encontrado');
  } else {
    server = await getDefaultServer();
    if (!server) throw new AppError(400, 'Nenhum servidor padrão configurado');
  }

  logger.info(`[ImportSigma] Usando servidor: ${server.name} (${server.id})`);
  
  // Parse CSV
  const csvRows = parseCSV(csvText);
  if (csvRows.length === 0) {
    throw new AppError(400, 'CSV vazio ou formato inválido');
  }

  // OTIMIZAÇÃO: Tentar buscar do banco MySQL diretamente (sem limite da API)
  // Se não tiver acesso ao banco, usar API (limite de 50)
  let xuiLines: XUILine[] = [];
  const xuiLinesMap = new Map<string, XUILine>();
  
  // Tentar usar banco MySQL primeiro (busca TODOS os clientes)
  if (server.dbHost && server.dbUser && server.dbPassword) {
    try {
      logger.info(`[ImportSigma] Tentando buscar clientes do banco MySQL diretamente...`);
      const dbClient = new XUIDBClient(server);
      const dbLines = await dbClient.getAllLines();
      
      // Converter XUIDBLine para XUILine
      xuiLines = dbLines.map(dbLine => ({
        id: dbLine.id,
        username: dbLine.username,
        password: dbLine.password,
        exp_date: dbLine.exp_date,
        max_connections: dbLine.max_connections,
        is_trial: dbLine.is_trial,
        enabled: (dbLine.enabled === 1 || dbLine.enabled === 0) ? (dbLine.enabled as 0 | 1) : 1,
        is_banned: 0, // Campo is_banned não existe na tabela lines do XUI, usar 0 (não banido)
        admin_enabled: (dbLine.admin_enabled === 1 || dbLine.admin_enabled === 0) ? (dbLine.admin_enabled as 0 | 1) : 1,
        admin_notes: dbLine.admin_notes || '',
        reseller_notes: dbLine.reseller_notes || '',
        bouquet: dbLine.bouquet ? (typeof dbLine.bouquet === 'string' ? JSON.parse(dbLine.bouquet) : dbLine.bouquet) : [],
        created_at: dbLine.created_at || Math.floor(Date.now() / 1000),
        created_by: dbLine.member_id,
      }));
      
      await dbClient.disconnect();
      logger.info(`[ImportSigma] ${xuiLines.length} clientes encontrados no banco MySQL`);
    } catch (error: any) {
      logger.warn(`[ImportSigma] Erro ao buscar do banco MySQL, tentando API: ${error.message}`);
      // Fallback para API
      const client = await getXuiClientForServer(server.id);
      xuiLines = await client.getLines();
      logger.info(`[ImportSigma] ${xuiLines.length} clientes encontrados via API (pode ter limite de 50)`);
    }
  } else {
    // Se não tiver acesso ao banco, usar API
    logger.info(`[ImportSigma] Banco MySQL não configurado, usando API (limite de 50 clientes)...`);
    const client = await getXuiClientForServer(server.id);
    try {
      xuiLines = await client.getLines();
      logger.info(`[ImportSigma] ${xuiLines.length} clientes encontrados via API`);
      if (xuiLines.length === 50 && csvRows.length > 50) {
        logger.warn(`[ImportSigma] ATENÇÃO: API retornou apenas 50 clientes, mas CSV tem ${csvRows.length}. Configure acesso ao banco MySQL para importar todos.`);
      }
    } catch (error: any) {
      logger.error(`[ImportSigma] Erro ao buscar clientes do XUI: ${error.message}`, error);
      throw new AppError(500, `Erro ao buscar clientes do XUI: ${error.message}`);
    }
  }

  // Criar mapa de username -> XUILine para lookup rápido
  // IMPORTANTE: Usar trim() para remover espaços e normalizar
  xuiLines.forEach(line => {
    const normalizedUsername = (line.username || '').trim();
    if (normalizedUsername) {
      xuiLinesMap.set(normalizedUsername, line);
    }
  });
  
  logger.info(`[ImportSigma] Mapa criado com ${xuiLinesMap.size} clientes`);
  
  // Debug: Logar alguns usernames para debug
  if (xuiLines.length > 0) {
    const sampleUsernames = xuiLines.slice(0, 5).map(l => `"${l.username}"`).join(', ');
    logger.info(`[ImportSigma] Exemplos de usernames: ${sampleUsernames}`);
  } else {
    logger.warn(`[ImportSigma] NENHUM cliente encontrado! Verifique se o servidor está correto e se há clientes cadastrados.`);
  }

  const results = {
    total: csvRows.length,
    success: 0,
    errors: 0,
    duplicates: 0,
    notFoundInXui: 0,
    details: [] as Array<{
      username: string;
      status: 'success' | 'error' | 'duplicate' | 'not_found' | 'package_not_found';
      message: string;
    }>,
  };

  // Processar cada linha
  for (const row of csvRows) {
    const username = row.username?.trim();
    const password = row.password?.trim();
    const name = row.name?.trim() || null;
    const whatsapp = row.whatsapp?.trim() || null;
    const email = row.email?.trim() || null;
    const telegram = row.telegram?.trim() || null;
    const packageName = row.package?.trim() || '';

    if (!username || !password) {
      results.errors++;
      results.details.push({
        username: username || 'N/A',
        status: 'error',
        message: 'Username ou password faltando',
      });
      continue;
    }

    try {
      // 1. Verificar se cliente já existe no banco local
      const existingCustomer = await prisma.customer.findFirst({
        where: {
          serverId: server.id,
          username: username,
        },
      });

      if (existingCustomer) {
        results.duplicates++;
        results.details.push({
          username,
          status: 'duplicate',
          message: 'Cliente já existe no painel',
        });
        continue;
      }

      // 2. Buscar cliente no XUI por username (lookup no mapa)
      // Normalizar username (trim) antes de buscar
      const normalizedUsername = username.trim();
      const xuiLine = xuiLinesMap.get(normalizedUsername);
      
      if (!xuiLine) {
        // Debug: Verificar se o username existe mas com espaços diferentes
        const foundUsernames = Array.from(xuiLinesMap.keys());
        const similarUsernames = foundUsernames.filter(u => u.includes(normalizedUsername) || normalizedUsername.includes(u)).slice(0, 3);
        
        logger.warn(`[ImportSigma] Cliente "${normalizedUsername}" não encontrado no XUI. Usernames similares: ${similarUsernames.join(', ')}`);
        
        results.notFoundInXui++;
        results.details.push({
          username,
          status: 'not_found',
          message: 'Cliente não encontrado no XUI.ONE',
        });
        continue;
      }

      // 3. Usar expiresAt do XUI (NÃO do CSV!)
      const expiresAt = unixToDate(xuiLine.exp_date);

      // 4. Mapear pacote (se não encontrar, usa pacote padrão "1 Mês")
      let packageId: string | null = null;
      if (packageName) {
        packageId = await mapPackageNameToId(server.id, packageName);
        if (!packageId) {
          // Se não encontrou nenhum pacote (nem o padrão), não pode importar
          results.errors++;
          results.details.push({
            username,
            status: 'package_not_found',
            message: `Nenhum pacote disponível no servidor`,
          });
          continue;
        }
      } else {
        // Se não tem nome de pacote no CSV, tenta usar pacote padrão "1 Mês"
        packageId = await mapPackageNameToId(server.id, '1 mês completo');
      }

      // 5. Gerar paymentToken único
      const paymentToken = randomUUID();

      let sigmaPkgConnections: number | null = null;
      if (packageId) {
        const sigmaPkg = await prisma.package.findUnique({
          where: { id: packageId },
          select: { connections: true },
        });
        sigmaPkgConnections = sigmaPkg?.connections ?? null;
      }
      const sigmaConnections = resolveAllowedCustomerConnections(
        currentUser.role,
        Number(xuiLine.max_connections) || 1,
        sigmaPkgConnections
      );

      // 6. Criar registro local (NÃO modifica XUI!)
      const createdCustomer = await prisma.customer.create({
        data: {
          externalId: xuiLine.id.toString(),
          serverId: server.id,
          username: username,
          password: password,
          name: name,
          email: email || null,
          whatsapp: whatsapp || null,
          telegram: telegram || null,
          packageId: packageId,
          resellerUserId: currentUser.userId,
          // Determinar status: verifica enabled, is_banned e exp_date
          status: (() => {
            const now = Math.floor(Date.now() / 1000);
            if (xuiLine.enabled === 0 || xuiLine.is_banned === 1) {
              return 'INACTIVE';
            }
            if (xuiLine.exp_date && xuiLine.exp_date < now) {
              return 'EXPIRED';
            }
            return 'ACTIVE';
          })(),
          isTrial: xuiLine.is_trial === 1,
          connections: clampToPrismaInt(sigmaConnections, 1),
          expiresAt: expiresAt,
          paymentToken: paymentToken,
        },
      });

      // 7. Registrar pagamento manual se tiver pacote
      if (packageId && row.plan_price) {
        const planPrice = parseFloat(row.plan_price);
        if (!isNaN(planPrice) && planPrice > 0) {
          await prisma.manualPayment.create({
            data: {
              customerId: createdCustomer.id,
              value: planPrice,
              paymentDate: new Date(), // Usar data atual como data de pagamento
              method: 'MIGRADO_SIGMA',
              notes: `Cliente migrado do SIGMA - Pacote: ${packageName}`,
              createdBy: currentUser.userId,
            },
          });
        }
      }

      results.success++;
      results.details.push({
        username,
        status: 'success',
        message: 'Cliente importado com sucesso',
      });

    } catch (error: any) {
      logger.error(`[ImportSigma] Erro ao importar cliente ${username}: ${error.message}`);
      results.errors++;
      results.details.push({
        username,
        status: 'error',
        message: error.message || 'Erro desconhecido',
      });
    }
  }

  logger.info(`[ImportSigma] Importação concluída: ${results.success} sucesso, ${results.errors} erros, ${results.duplicates} duplicados, ${results.notFoundInXui} não encontrados no XUI`);

  res.json({
    success: true,
    data: results,
  });
});

/**
 * POST /api/customers/export
 * Exportar clientes para CSV
 */
export const exportCustomers = asyncHandler(async (req: Request, res: Response) => {
  const { serverId, status, packageId } = req.body;
  const currentUser = req.user!;

  logger.info('[ExportCustomers] Iniciando exportação', { serverId, status, packageId });

  // Buscar clientes do banco local
  const where: any = {};
  
  if (serverId) where.serverId = serverId;
  if (packageId) where.packageId = packageId;
  
  const customers = await prisma.customer.findMany({
    where,
    include: {
      package: true,
      server: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  logger.info(`[ExportCustomers] Encontrados ${customers.length} clientes`);

  // Agrupar clientes por servidor para otimizar requisições
  const customersByServer = new Map<string, typeof customers>();
  for (const customer of customers) {
    if (!customersByServer.has(customer.serverId)) {
      customersByServer.set(customer.serverId, []);
    }
    customersByServer.get(customer.serverId)!.push(customer);
  }

  // Buscar todos os lines de cada servidor de uma vez
  const xuiLinesMap = new Map<string, any>();
  for (const [serverId, serverCustomers] of customersByServer) {
    try {
      const client = await getXuiClientForServer(serverId);
      const allLines = await client.getLines();
      
      // Criar mapa de externalId -> line
      for (const line of allLines) {
        xuiLinesMap.set(`${serverId}_${line.id}`, line);
      }
      
      logger.info(`[ExportCustomers] Servidor ${serverId}: ${allLines.length} lines carregados`);
    } catch (error: any) {
      logger.error(`[ExportCustomers] Erro ao buscar lines do servidor ${serverId}: ${error.message}`);
    }
  }

  // Gerar CSV
  const csvRows: string[] = [];
  csvRows.push('username,password,expires_at,is_trial,connections,bouquets,status,package_name,name,whatsapp,email,telegram,server_id,created_at');

  for (const customer of customers) {
    try {
      const xuiLine = xuiLinesMap.get(`${customer.serverId}_${customer.externalId}`);
      
      if (!xuiLine) {
        logger.warn(`[ExportCustomers] Line não encontrado para cliente ${customer.externalId}`);
        continue;
      }

      // Determinar status
      let customerStatus = 'ACTIVE';
      const now = Math.floor(Date.now() / 1000);
      if (xuiLine.enabled === 0) {
        customerStatus = 'INACTIVE';
      } else if (xuiLine.exp_date && xuiLine.exp_date < now) {
        customerStatus = 'EXPIRED';
      }

      // Filtrar por status se especificado
      if (status && customerStatus !== status) continue;

      // Formatar data de vencimento
      const expiresAt = xuiLine.exp_date ? new Date(xuiLine.exp_date * 1000).toISOString() : '';
      const createdAt = customer.createdAt.toISOString();

      // Escapar campos para CSV
      const escape = (val: any) => {
        if (val === null || val === undefined) return '';
        const str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      csvRows.push([
        escape(xuiLine.username),
        escape(xuiLine.password),
        escape(expiresAt),
        escape(xuiLine.is_trial === 1 ? 'true' : 'false'),
        escape(xuiLine.max_connections || 1),
        escape(xuiLine.bouquet || ''),
        escape(customerStatus),
        escape(customer.package?.name || ''),
        escape(customer.name || ''),
        escape(customer.whatsapp || ''),
        escape(customer.email || ''),
        escape(customer.telegram || ''),
        escape(customer.serverId),
        escape(createdAt),
      ].join(','));

    } catch (error: any) {
      logger.error(`[ExportCustomers] Erro ao buscar dados do cliente ${customer.externalId}: ${error.message}`);
      // Continua com próximo cliente
    }
  }

  const csvContent = csvRows.join('\n');
  const filename = `clientes_export_${new Date().toISOString().split('T')[0]}.csv`;

  logger.info(`[ExportCustomers] Exportação concluída: ${csvRows.length - 1} clientes`);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\ufeff' + csvContent); // BOM para UTF-8
});

/**
 * POST /api/customers/import
 * Importar clientes de CSV
 */
export const importCustomers = asyncHandler(async (req: Request, res: Response) => {
  const { serverId, csvContent } = req.body;
  const currentUser = req.user!;

  if (!serverId) {
    throw new AppError(400, 'serverId é obrigatório');
  }

  if (!csvContent) {
    throw new AppError(400, 'csvContent é obrigatório');
  }

  logger.info('[ImportCustomers] Iniciando importação', { serverId });

  const server = await prisma.xuiServer.findUnique({ where: { id: serverId } });
  if (!server) throw new AppError(404, 'Servidor não encontrado');

  const client = new XUIClient(server);

  // Parse CSV
  const lines = csvContent.trim().split('\n');
  const headers = lines[0].split(',');
  const dataLines = lines.slice(1);

  const results = {
    total: dataLines.length,
    success: 0,
    errors: 0,
    skipped: 0,
    details: [] as any[],
  };

  for (const line of dataLines) {
    const values = line.split(',').map((v: string) => v.trim().replace(/^"|"$/g, ''));
    const row: any = {};
    headers.forEach((h, i) => {
      row[h.trim()] = values[i] || '';
    });

    const username = row.username;
    const password = row.password;

    if (!username || !password) {
      results.errors++;
      results.details.push({ username, status: 'error', message: 'Username ou password faltando' });
      continue;
    }

    try {
      // Verificar se já existe
      const existingLines = await client.getLines();
      if (existingLines.some(l => l.username === username)) {
        results.skipped++;
        results.details.push({ username, status: 'skipped', message: 'Cliente já existe' });
        continue;
      }

      // Calcular data de vencimento
      let expTimestamp: number;
      if (row.expires_at) {
        expTimestamp = Math.floor(new Date(row.expires_at).getTime() / 1000);
      } else {
        // Padrão: 30 dias
        expTimestamp = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);
      }

      const connParsed = parseInt(String(row.connections || '1'), 10);
      const rawConn = !Number.isFinite(connParsed) || connParsed < 1 ? 1 : connParsed;
      const connectionsForXui = resolveAllowedCustomerConnections(
        currentUser.role,
        rawConn,
        null
      );

      // Criar no XUI
      const xuiLine = await client.createLine({
        username,
        password,
        exp_date: expTimestamp,
        max_connections: connectionsForXui,
        is_trial: row.is_trial === 'true' ? 1 : 0,
        bouquet: row.bouquets || '',
        enabled: 1,
        notes: 'Importado via CSV',
      });

      // Salvar no banco local
      await prisma.customer.create({
        data: {
          serverId,
          externalId: String(xuiLine.id),
          username: username,
          password: password,
          name: row.name || null,
          whatsapp: row.whatsapp || null,
          email: row.email || null,
          telegram: row.telegram || null,
          packageId: null, // Pode melhorar depois associando por nome
          resellerUserId: currentUser.userId,
          isTrial: row.is_trial === 'true',
          connections: clampToPrismaInt(connectionsForXui, 1),
          expiresAt: new Date(expTimestamp * 1000),
          status: 'ACTIVE',
        },
      });

      results.success++;
      results.details.push({ username, status: 'success', message: 'Cliente importado' });

    } catch (error: any) {
      logger.error(`[ImportCustomers] Erro ao importar ${username}: ${error.message}`);
      results.errors++;
      results.details.push({ username, status: 'error', message: error.message });
    }
  }

  logger.info(`[ImportCustomers] Importação concluída: ${results.success} sucesso, ${results.errors} erros, ${results.skipped} pulados`);

  res.json({
    success: true,
    data: results,
  });
});

/**
 * POST /api/customers/sync-to-xui
 * Sincronizar todos os clientes do banco local para um novo servidor XUI
 */
export const syncCustomersToXui = asyncHandler(async (req: Request, res: Response) => {
  const { serverId, dryRun = false, source } = req.body as { serverId?: string; dryRun?: boolean; source?: 'xui' | 'panel' };
  const currentUser = req.user!;

  if (!serverId) {
    throw new AppError(400, 'serverId é obrigatório');
  }

  // Se o frontend não enviar explicitamente, usar SEMPRE modo painel (desastre)
  const sourceMode: 'xui' | 'panel' = source === 'xui' || source === 'panel' ? source : 'panel';
  const usePanelOnly = sourceMode === 'panel';

  logger.info('[SyncToXui] Iniciando sincronização', { serverId, dryRun, source: sourceMode, usePanelOnly });

  const server = await prisma.xuiServer.findUnique({ where: { id: serverId } });
  if (!server) throw new AppError(404, 'Servidor não encontrado');

  // Cliente XUI do servidor de DESTINO (onde as linhas serão recriadas)
  const client = new XUIClient(server);

  // Buscar todos os clientes do banco local
  const localCustomers = await prisma.customer.findMany({
    include: {
      package: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  logger.info(`[SyncToXui] Encontrados ${localCustomers.length} clientes no banco local`);

  // Buscar linhas existentes no XUI DESTINO para evitar duplicar usernames
  const xuiLines = await client.getLines();
  const xuiUsernames = new Set(xuiLines.map(l => l.username));

  // Cache de bouquets padrão por servidor de destino (evita buscar toda hora)
  const defaultBouquetsCache = new Map<string, number[]>();

  const results = {
    total: localCustomers.length,
    created: 0,
    skipped: 0,
    errors: 0,
    details: [] as any[],
  };

  for (const customer of localCustomers) {
    try {
      let username: string;
      let password: string;
      let expDate: number | undefined;
      let maxConnections: number;
      let isTrial: 0 | 1;
      let bouquets: number[] = [];
      let enabled: number;

      if (usePanelOnly) {
        // ============================
        // MODO SOMENTE PAINEL
        // Reconstrói os dados apenas a partir do que está no banco local
        // ============================
        username = customer.username;
        password = customer.password;
        maxConnections = customer.connections || (customer.package?.connections ?? 1) || 1;
        isTrial = customer.isTrial ? 1 : 0;
        enabled = customer.status === 'ACTIVE' ? 1 : 0;

        // exp_date a partir de expiresAt
        if (customer.expiresAt) {
          expDate = Math.floor(customer.expiresAt.getTime() / 1000);
        }

        // Bouquets a partir do pacote (se houver)
        if (customer.package?.bouquets) {
          try {
            const raw = customer.package.bouquets;
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (Array.isArray(parsed)) {
              bouquets = parsed
                .map((b: any) => (typeof b === 'string' ? parseInt(b, 10) : b))
                .filter((b: any) => !isNaN(b));
            }
          } catch (e: any) {
            logger.warn(`[SyncToXui] Erro ao parsear bouquets do pacote para cliente ${customer.id}: ${e?.message || String(e)}`);
          }
        }

        // Se ainda não tiver bouquets, usar todos os bouquets do servidor de DESTINO como fallback
        if (bouquets.length === 0) {
          let defaultBouquets = defaultBouquetsCache.get(serverId);
          if (!defaultBouquets) {
            const allBouquets = await prisma.bouquet.findMany({ where: { serverId } });
            defaultBouquets = allBouquets
              .map(b => parseInt(b.externalId, 10))
              .filter(id => !isNaN(id));
            if (defaultBouquets.length === 0) {
              // Fallback duro, caso não haja bouquets cadastrados
              defaultBouquets = [1];
            }
            defaultBouquetsCache.set(serverId, defaultBouquets);
          }
          bouquets = defaultBouquets;
        }
      } else {
        // ============================
        // MODO ANTIGO: Buscar dados diretamente do XUI original
        // ============================
        const originalClient = await getXuiClientForServer(customer.serverId);
        const originalLine = await originalClient.getLine(parseInt(customer.externalId));

        username = originalLine.username;
        password = originalLine.password;
        expDate = originalLine.exp_date;
        maxConnections = originalLine.max_connections || 1;
        isTrial = originalLine.is_trial as 0 | 1;
        enabled = originalLine.enabled;

        // Alguns XUI usam "bouquet" (array) ou "bouquets"
        const lineBouquets: any = (originalLine as any).bouquet ?? (originalLine as any).bouquets;
        if (Array.isArray(lineBouquets)) {
          bouquets = lineBouquets.map((b: any) => (typeof b === 'string' ? parseInt(b, 10) : b)).filter((b: any) => !isNaN(b));
        }
      }

      if (!username) {
        throw new Error('Username vazio para cliente local ' + customer.id);
      }

      // Verificar se já existe no XUI destino
      if (xuiUsernames.has(username)) {
        results.skipped++;
        results.details.push({
          username,
          status: 'skipped',
          message: 'Cliente já existe no servidor destino',
        });
        continue;
      }

      if (dryRun) {
        results.created++;
        results.details.push({
          username,
          status: 'would_create',
          message: usePanelOnly
            ? 'Cliente seria criado no XUI destino usando dados do painel (modo somente painel)'
            : 'Cliente seria criado copiando dados do XUI original',
        });
        continue;
      }

      // Montar payload para createLine DIRETO NO BANCO (garante credenciais e is_trial corretos)
      const bouquetsToUse = bouquets.length > 0 ? bouquets : [1];

      // USAR BANCO DIRETO (igual ao createCustomer)
      const dbClient = new XUIDBClient(server);
      let newLineId: number;

      try {
        logger.info('[SyncToXui] Criando linha DIRETO NO BANCO para cliente local', {
          customerId: customer.id,
          username,
          password,
          isTrial,
          expDate,
          bouquets: bouquetsToUse,
        });

        // Verificar se username já existe
        const usernameExists = await dbClient.usernameExists(username);
        if (usernameExists) {
          throw new Error(`Username ${username} já existe no banco destino`);
        }

        // Criar linha diretamente no banco (garante TODOS os campos corretos)
        newLineId = await dbClient.createLine({
          username,
          password,
          exp_date: expDate || Math.floor(Date.now() / 1000) + 86400 * 30, // Default 30 dias
          is_trial: isTrial,
          member_id: resolveMemberIdForServer(server as any),
          bouquet: bouquetsToUse,
          allowed_outputs: [1, 2, 3], // HLS, MPEGTS, RTMP
          max_connections: maxConnections || 1,
          admin_notes: `Sincronizado do painel em ${new Date().toISOString()} (modo=${usePanelOnly ? 'panel' : 'xui'})`,
          reseller_notes: customer.name ? `Cliente: ${customer.name}` : null,
        });

        logger.info('[SyncToXui] Linha criada no banco com sucesso', { 
          lineId: newLineId, 
          username,
          exp_date: expDate,
          is_trial: isTrial,
          bouquets: bouquetsToUse
        });

        // Desconectar do banco
        await dbClient.disconnect();

        // Ativar via API fazendo editLine completo (força XUI a processar)
        try {
          logger.info('[SyncToXui] Ativando linha via API do XUI...', { lineId: newLineId });
          await client.editLine(newLineId, {
            exp_date: expDate || Math.floor(Date.now() / 1000) + 86400 * 30,
            max_connections: maxConnections || 1,
            bouquets: bouquetsToUse,
            allowed_outputs: [1, 2, 3],
            is_trial: isTrial,
          });
          logger.info('[SyncToXui] Linha ativada via API com sucesso');
        } catch (apiError: any) {
          logger.warn('[SyncToXui] Erro ao ativar via API (não crítico):', apiError.message);
          // Não falhar - a linha já foi criada no banco
        }
      } catch (dbError: any) {
        // Tentar desconectar
        try {
          await dbClient.disconnect();
        } catch (e) {
          // Ignorar
        }
        throw dbError;
      }

      // Atualizar externalId / serverId no banco local se o servidor mudou
      if (customer.serverId !== serverId) {
        await prisma.customer.update({
          where: { id: customer.id },
          data: {
            serverId,
            externalId: String(newLineId),
          },
        });
      }

      results.created++;
      results.details.push({
        username,
        status: 'success',
        message: 'Cliente sincronizado com sucesso',
        newLineId,
        source: usePanelOnly ? 'panel' : 'xui',
      });
    } catch (error: any) {
      logger.error(`[SyncToXui] Erro ao sincronizar cliente ${customer.id}: ${error.message}`);
      results.errors++;
      results.details.push({
        customerId: customer.id,
        status: 'error',
        message: error.message,
      });
    }
  }

  logger.info(`[SyncToXui] Sincronização concluída: ${results.created} criados, ${results.skipped} pulados, ${results.errors} erros`);

  res.json({
    success: true,
    data: results,
  });
});
