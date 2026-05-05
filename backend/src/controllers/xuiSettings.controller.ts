import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { XUIClient } from '../services/xui.client.js';
import { XUIDBClient } from '../services/xui.db.client.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { createLogger } from '../utils/logger.js';
import crypto from 'crypto';

const logger = createLogger('XuiSettingsController');

// Chave de criptografia (em produção, usar variável de ambiente)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'painel-iptv-encryption-key-32ch';
const IV_LENGTH = 16;

// Funções de criptografia
function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32)), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text: string): string {
  try {
    const parts = text.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = Buffer.from(parts[1], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32)), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch {
    return text; // Se falhar, retorna o original (pode ser texto não criptografado)
  }
}

// Schemas de validação
const xuiServerSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  baseUrl: z.string().url('URL inválida'),
  serverType: z.enum(['XUIONE', 'XTREAMUI']).optional().default('XUIONE'),
  accessCode: z.string().optional().default(''),
  apiKey: z.string().optional().default(''),
  apiUsername: z.string().optional(),
  apiPassword: z.string().optional(),
  resellerGroupId: z.number().optional(), // ID do grupo de reseller selecionado
  isDefault: z.boolean().optional(),
  // Campos DNS
  dnsPrimary: z.string().optional(),
  dnsList: z.string().optional(),
  // Campos de banco de dados
  dbHost: z.string().optional(),
  dbPort: z.number().int().min(1).max(65535).optional(),
  dbName: z.string().optional(),
  dbUser: z.string().optional(),
  dbPassword: z.string().optional(),
  // Campos SSH (opcional)
  sshHost: z.string().optional(),
  sshPort: z.number().int().min(1).max(65535).optional(),
  sshUser: z.string().optional(),
  sshPassword: z.string().optional(),
  sshKey: z.string().optional(),
});

/**
 * GET /api/settings/xui
 * Lista todos os servidores XUI configurados
 */
export const getAll = asyncHandler(async (req: Request, res: Response) => {
  const servers = await prisma.xuiServer.findMany({
    select: {
      id: true,
      name: true,
      baseUrl: true,
      serverType: true,
      accessCode: true,
      // NÃO retornar apiKey completa!
      isActive: true,
      isDefault: true,
      status: true,
      lastSync: true,
      dnsPrimary: true,
      dnsList: true,
      dbHost: true,
      dbPort: true,
      dbName: true,
      dbUser: true,
      xuiResellerId: true,
      createdAt: true,
      _count: {
        select: {
          packages: true,
          customers: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json({ data: servers });
});

/**
 * GET /api/settings/xui/:id
 */
export const getById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const server = await prisma.xuiServer.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      baseUrl: true,
      accessCode: true,
      serverType: true,
      isActive: true,
      isDefault: true,
      status: true,
      lastSync: true,
      dnsPrimary: true,
      dnsList: true,
    },
  });

  if (!server) {
    throw new AppError(404, 'Servidor não encontrado');
  }

  res.json({ data: server });
});

/**
 * POST /api/settings/xui
 * Cria novo servidor XUI
 */
export const create = asyncHandler(async (req: Request, res: Response) => {
  const data = xuiServerSchema.parse(req.body);

  // Verifica se já existe
  const existing = await prisma.xuiServer.findFirst({
    where: {
      baseUrl: data.baseUrl,
      accessCode: data.accessCode,
    },
  });

  if (existing) {
    throw new AppError(409, 'Este servidor já está configurado');
  }

  // Criptografa API Key
  const encryptedApiKey = encrypt(data.apiKey);

  // Se for default, remove default dos outros
  if (data.isDefault) {
    await prisma.xuiServer.updateMany({
      where: { isDefault: true },
      data: { isDefault: false },
    });
  }

  const serverData: any = {
    name: data.name,
    baseUrl: data.baseUrl,
    serverType: data.serverType || 'XUIONE',
    accessCode: data.accessCode || '',
    apiKey: encryptedApiKey,
    isDefault: data.isDefault || false,
  };

  // Campos Xtream UI
  if (data.apiUsername) serverData.apiUsername = data.apiUsername;
  if (data.apiPassword) serverData.apiPassword = encrypt(data.apiPassword);

  // Campos DNS
  if (data.dnsPrimary !== undefined) serverData.dnsPrimary = data.dnsPrimary || null;
  if (data.dnsList !== undefined) serverData.dnsList = data.dnsList || null;

  // Campos de banco de dados
  if (data.dbHost !== undefined) serverData.dbHost = data.dbHost;
  if (data.dbPort !== undefined) serverData.dbPort = data.dbPort;
  if (data.dbName !== undefined) serverData.dbName = data.dbName;
  if (data.dbUser !== undefined) serverData.dbUser = data.dbUser;
  if (data.dbPassword !== undefined) serverData.dbPassword = encrypt(data.dbPassword);

  // Campos SSH
  if (data.sshHost !== undefined) serverData.sshHost = data.sshHost;
  if (data.sshPort !== undefined) serverData.sshPort = data.sshPort;
  if (data.sshUser !== undefined) serverData.sshUser = data.sshUser;
  if (data.sshPassword !== undefined) serverData.sshPassword = encrypt(data.sshPassword);
  if (data.sshKey !== undefined) serverData.sshKey = encrypt(data.sshKey);

  const server = await prisma.xuiServer.create({
    data: serverData,
  });

  // Se resellerGroupId foi fornecido, criar o reseller automaticamente
  if (data.resellerGroupId) {
    try {
      const client = new XUIClient({
        baseUrl: data.baseUrl,
        serverType: data.serverType || 'XUIONE',
        accessCode: data.accessCode || '',
        apiKey: data.apiKey || '',
        apiUsername: data.apiUsername || '',
        apiPassword: data.apiPassword || '',
        needsDecrypt: false,
      });
      
      const adminInfo = await client.getUserInfo();
      
      // Username simples: painel-iptv
      let username = 'painel-iptv';
      try {
        const users = await client.getUsers();
        const existing = users.find(u => u.username === username);
        if (existing) {
          username = `painel-iptv-${Date.now().toString().slice(-6)}`;
        }
      } catch {
        // Se falhar ao buscar, usa o nome simples
      }
      
      logger.info(`[Create Server] Criando reseller: ${username} com owner_id: ${adminInfo.user_id}`);
      
      const resellerResult = await client.createUser({
        username,
        password: Math.random().toString(36).slice(-12) + Math.random().toString(36).slice(-12),
        email: req.user!.email || undefined,
        member_group_id: data.resellerGroupId,
        credits: 100000,
        owner_id: adminInfo.user_id, // ID do admin (usuário da API Key)
      });

      // Buscar API key do reseller criado
      let resellerApiKey: string | null = null;
      try {
        const resellerInfo = await client.getUser(resellerResult.user_id);
        if (resellerInfo && resellerInfo.api_key) {
          resellerApiKey = resellerInfo.api_key;
          logger.info('[Create Server] API key do reseller obtida');
        }
      } catch (error: any) {
        logger.warn('[Create Server] Não foi possível obter API key do reseller:', error.message);
      }

      // Atualizar servidor com reseller_id e API key
      await prisma.xuiServer.update({
        where: { id: server.id },
        data: {
          xuiResellerId: resellerResult.user_id,
          xuiResellerUsername: resellerResult.username,
          xuiResellerApiKey: resellerApiKey ? encrypt(resellerApiKey) : null,
        },
      });

      logger.info(`Reseller criado automaticamente: ID ${resellerResult.user_id}, Username: ${resellerResult.username}`);
    } catch (error: any) {
      logger.error('[Create Server] Erro ao criar reseller automaticamente:', error);
      // Não falha a criação do servidor se o reseller falhar
    }
  }

  // Log de ação
  await prisma.actionLog.create({
    data: {
      userId: req.user!.userId,
      action: 'CREATE_XUI_SERVER',
      entity: 'xui_server',
      entityId: server.id,
      details: JSON.stringify({ name: data.name, baseUrl: data.baseUrl }),
      ip: req.ip,
    },
  });

  logger.info(`Servidor XUI "${data.name}" criado por ${req.user!.username}`);

  res.status(201).json({
    data: {
      id: server.id,
      name: server.name,
      baseUrl: server.baseUrl,
      accessCode: server.accessCode,
      isActive: server.isActive,
      isDefault: server.isDefault,
    },
  });
});

/**
 * PUT /api/settings/xui/:id
 */
export const update = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const data = xuiServerSchema.partial().parse(req.body);

  const server = await prisma.xuiServer.findUnique({ where: { id } });
  if (!server) {
    throw new AppError(404, 'Servidor não encontrado');
  }

  const updateData: any = {};
  if (data.name) updateData.name = data.name;
  if (data.baseUrl) updateData.baseUrl = data.baseUrl;
  if (data.accessCode) updateData.accessCode = data.accessCode;
  if (data.apiKey) updateData.apiKey = encrypt(data.apiKey);
  if (data.serverType) updateData.serverType = data.serverType;
  if (data.apiUsername !== undefined) updateData.apiUsername = data.apiUsername || null;
  if (data.apiPassword) updateData.apiPassword = encrypt(data.apiPassword);

  // Campos DNS
  if (data.dnsPrimary !== undefined) updateData.dnsPrimary = data.dnsPrimary || null;
  if (data.dnsList !== undefined) updateData.dnsList = data.dnsList || null;

  // Campos de banco de dados
  if (data.dbHost !== undefined) updateData.dbHost = data.dbHost;
  if (data.dbPort !== undefined) updateData.dbPort = data.dbPort;
  if (data.dbName !== undefined) updateData.dbName = data.dbName;
  if (data.dbUser !== undefined) updateData.dbUser = data.dbUser;
  if (data.dbPassword !== undefined) updateData.dbPassword = encrypt(data.dbPassword);

  // Campos SSH
  if (data.sshHost !== undefined) updateData.sshHost = data.sshHost;
  if (data.sshPort !== undefined) updateData.sshPort = data.sshPort;
  if (data.sshUser !== undefined) updateData.sshUser = data.sshUser;
  if (data.sshPassword !== undefined) updateData.sshPassword = encrypt(data.sshPassword);
  if (data.sshKey !== undefined) updateData.sshKey = encrypt(data.sshKey);

  if (data.isDefault) {
    await prisma.xuiServer.updateMany({
      where: { isDefault: true, id: { not: id } },
      data: { isDefault: false },
    });
    updateData.isDefault = true;
  }

  const updated = await prisma.xuiServer.update({
    where: { id },
    data: updateData,
  });

  res.json({ data: updated });
});

/**
 * DELETE /api/settings/xui/:id
 */
export const remove = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const server = await prisma.xuiServer.findUnique({ 
    where: { id },
    include: {
      _count: {
        select: {
          customers: true,
          packages: true,
          bouquets: true,
          vodItems: true,
          vodImportSchedules: true,
        }
      }
    }
  });
  
  if (!server) {
    throw new AppError(404, 'Servidor não encontrado');
  }

  // ⚠️ EXCLUSÃO EM CASCATA: Deletar registros relacionados primeiro
  // (VODItem, VODImportSchedule e FootballConfig já têm onDelete: Cascade no schema)
  
  logger.info(`Removendo servidor XUI "${server.name}" e registros relacionados...`);
  logger.info(`  - Clientes: ${server._count.customers}`);
  logger.info(`  - Pacotes: ${server._count.packages}`);
  logger.info(`  - Bouquets: ${server._count.bouquets}`);
  logger.info(`  - Itens VOD: ${server._count.vodItems}`);
  logger.info(`  - Agendamentos VOD: ${server._count.vodImportSchedules}`);

  // Usar transação para garantir atomicidade
  await prisma.$transaction(async (tx) => {
    // 0. CRÍTICO: Buscar IDs dos bouquets do servidor para deletar Checkouts que os referenciam
    const serverBouquets = await tx.bouquet.findMany({
      where: { serverId: id },
      select: { id: true }
    });
    const bouquetIds = serverBouquets.map(b => b.id);
    
    // 1. Deletar Checkouts que referenciam bouquets deste servidor (FK constraint)
    if (bouquetIds.length > 0) {
      const checkoutsDeleted = await tx.checkout.deleteMany({ 
        where: { bouquetId: { in: bouquetIds } } 
      });
      logger.debug(`  ✅ ${checkoutsDeleted.count} checkouts deletados`);
    }

    // 2. Deletar PremiumSources que referenciam este servidor
    const premiumSourcesDeleted = await tx.premiumSource.deleteMany({ 
      where: { serverId: id } 
    }).catch(() => ({ count: 0 }));
    logger.debug(`  ✅ ${premiumSourcesDeleted.count} premium sources deletados`);

    // 3. Deletar clientes (pode ter dependências em outras tabelas)
    const customersDeleted = await tx.customer.deleteMany({ where: { serverId: id } });
    logger.debug(`  ✅ ${customersDeleted.count} clientes deletados`);

    // 4. Deletar pacotes
    const packagesDeleted = await tx.package.deleteMany({ where: { serverId: id } });
    logger.debug(`  ✅ ${packagesDeleted.count} pacotes deletados`);

    // 5. Deletar bouquets (agora sem FK constraints)
    const bouquetsDeleted = await tx.bouquet.deleteMany({ where: { serverId: id } });
    logger.debug(`  ✅ ${bouquetsDeleted.count} bouquets deletados`);

    // 6. VODItem e VODImportSchedule
    const vodItemsDeleted = await tx.vODItem.deleteMany({ where: { serverId: id } }).catch(() => ({ count: 0 }));
    logger.debug(`  ✅ ${vodItemsDeleted.count} itens VOD deletados`);

    const schedulesDeleted = await tx.vODImportSchedule.deleteMany({ where: { serverId: id } }).catch(() => ({ count: 0 }));
    logger.debug(`  ✅ ${schedulesDeleted.count} agendamentos VOD deletados`);

    // 7. FootballConfig
    await tx.footballConfig.deleteMany({ where: { serverId: id } }).catch(() => {});

    // 8. Finalmente, deletar o servidor
    await tx.xuiServer.delete({ where: { id } });
  });

  logger.info(`Servidor XUI "${server.name}" removido com sucesso por ${req.user!.username}`);

  res.json({ message: 'Servidor removido com sucesso' });
});

/**
 * POST /api/settings/xui/test-connection
 * Testa conexão com servidor XUI
 */
export const testConnection = asyncHandler(async (req: Request, res: Response) => {
  const { baseUrl, serverType, accessCode, apiKey, apiUsername, apiPassword } = req.body;

  if (!baseUrl) {
    throw new AppError(400, 'URL é obrigatória');
  }

  if (serverType === 'XTREAMUI' && (!apiUsername || !apiPassword)) {
    throw new AppError(400, 'Usuário e senha são obrigatórios para Xtream UI');
  }

  if (serverType !== 'XTREAMUI' && (!accessCode || !apiKey)) {
    throw new AppError(400, 'Access Code e API Key são obrigatórios para XUI ONE');
  }

  try {
    // Config manual - não precisa descriptografar
    const client = new XUIClient({
      baseUrl,
      serverType: serverType || 'XUIONE',
      accessCode: accessCode || '',
      apiKey: apiKey || '',
      apiUsername: apiUsername || '',
      apiPassword: apiPassword || '',
      needsDecrypt: false,
    });
    const userInfo = await client.getUserInfo();
    
    // Buscar grupos de reseller disponíveis
    const groups = await client.getGroups();
    const resellerGroups = groups.filter(g => g.is_reseller === '1');

    res.json({
      success: true,
      message: 'Conexão estabelecida com sucesso!',
      data: {
        username: userInfo.username,
        credits: userInfo.credits,
        resellerGroups: resellerGroups.map(g => ({
          id: parseInt(g.group_id, 10),
          name: g.group_name,
        })),
      },
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: 'Falha na conexão',
      error: error.message,
    });
  }
});

/**
 * GET /api/settings/xui/:id/test
 * Testa conexão com servidor XUI
 */
export const testServerConnection = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  
  const server = await prisma.xuiServer.findUnique({
    where: { id }
  });
  
  if (!server) {
    throw new AppError(404, 'Servidor não encontrado');
  }
  
  try {
    // XUIClient faz descriptografia internamente
    const client = new XUIClient(server);
    
    // Testar conexão
    const userInfo = await client.getUserInfo();
    const packages = await client.getPackages();
    const lines = await client.getLines();
    const bouquets = await client.getBouquets();
    
    // Atualizar status no banco
    await prisma.xuiServer.update({
      where: { id },
      data: {
        status: 'ONLINE',
        lastCheck: new Date(),
      }
    });
    
    res.json({
      success: true,
      server: server.name,
      userInfo: {
        username: userInfo.username,
        credits: userInfo.credits,
      },
      stats: {
        packages: packages.length,
        lines: lines.length,
        bouquets: bouquets.length,
      }
    });
  } catch (error: any) {
    // Atualizar status como offline
    await prisma.xuiServer.update({
      where: { id },
      data: {
        status: 'OFFLINE',
        lastCheck: new Date(),
      }
    }).catch(() => {});
    
    res.status(500).json({
      success: false,
      error: error.message,
      details: 'Verifique URL, Access Code e API Key'
    });
  }
});

/**
 * POST /api/settings/xui/:id/create-reseller
 * Cria um usuário reseller no XUI (se não existir)
 */
export const createReseller = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const currentUser = req.user!;

  const server = await prisma.xuiServer.findUnique({ where: { id } });
  if (!server) {
    throw new AppError(404, 'Servidor não encontrado');
  }

  // Se já tem reseller configurado, retornar
  if (server.xuiResellerId) {
    return res.json({
      success: true,
      message: 'Reseller já configurado',
      reseller: {
        id: server.xuiResellerId,
        username: server.xuiResellerUsername,
      },
    });
  }

  try {
    const client = new XUIClient(server);
    
    // Obter info do usuário admin atual para usar como owner
    const adminInfo = await client.getUserInfo();
    
    // Username simples: painel-iptv
    // Se já existe, adiciona sufixo numérico
    let username = 'painel-iptv';
    let usernameExists = true;
    let suffix = 1;
    
    while (usernameExists && suffix <= 10) {
      try {
        const users = await client.getUsers();
        const existing = users.find(u => u.username === username);
        if (!existing) {
          usernameExists = false;
        } else {
          username = `painel-iptv-${suffix}`;
          suffix++;
        }
      } catch {
        // Se falhar ao buscar, tenta criar mesmo assim
        usernameExists = false;
      }
    }
    
    const password = Math.random().toString(36).slice(-12) + Math.random().toString(36).slice(-12);
    
    logger.info(`[CreateReseller] Criando reseller: ${username} com owner_id: ${adminInfo.user_id}`);
    
    // Criar reseller no XUI
    // IMPORTANTE: owner_id deve ser o ID do usuário admin (não o user_id do getUserInfo)
    // O getUserInfo retorna user_id, que é o ID correto do admin
    const resellerResult = await client.createUser({
      username,
      password,
      email: currentUser.email || undefined,
      member_group_id: 2, // Reseller group
      credits: 100000,
      owner_id: adminInfo.user_id, // ID do admin (usuário da API Key)
    });

    // Buscar API key do reseller criado
    let resellerApiKey: string | null = null;
    try {
      const resellerInfo = await client.getUser(resellerResult.user_id);
      if (resellerInfo && resellerInfo.api_key) {
        resellerApiKey = resellerInfo.api_key;
        logger.info('[CreateReseller] API key do reseller obtida');
      }
    } catch (error: any) {
      logger.warn('[CreateReseller] Não foi possível obter API key do reseller:', error.message);
    }

    // Salvar reseller no banco (com API key se disponível)
    await prisma.xuiServer.update({
      where: { id },
      data: {
        xuiResellerId: resellerResult.user_id,
        xuiResellerUsername: resellerResult.username,
        xuiResellerApiKey: resellerApiKey ? encrypt(resellerApiKey) : null,
      },
    });

    logger.info(`[CreateReseller] Reseller criado: ID ${resellerResult.user_id}, Username: ${resellerResult.username}`);

    res.json({
      success: true,
      message: 'Reseller criado com sucesso',
      reseller: {
        id: resellerResult.user_id,
        username: resellerResult.username,
        // Não retornar senha por segurança
      },
    });
  } catch (error: any) {
    logger.error('[CreateReseller] Erro:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Falha ao criar reseller',
    });
  }
});

/**
 * POST /api/settings/xui/:id/sync
 * Sincroniza pacotes e bouquets do servidor XUI
 */
export const syncServer = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const server = await prisma.xuiServer.findUnique({ where: { id } });
  if (!server) {
    throw new AppError(404, 'Servidor não encontrado');
  }

  // Helper para processar pacotes (funciona tanto com API quanto com DB)
  function processPackage(pkg: any) {
    const isTrial = pkg.is_trial === 1 || pkg.is_trial === '1' || String(pkg.is_trial) === '1';
    const rawDuration = isTrial ? pkg.trial_duration : pkg.official_duration;
    const rawCredits = isTrial ? pkg.trial_credits : pkg.official_credits;
    const rawDurationIn = isTrial ? pkg.trial_duration_in : pkg.official_duration_in;
    
    const duration = parseInt(String(rawDuration || 0), 10) || 0;
    const credits = parseInt(String(rawCredits || 0), 10) || 0;
    
    const validUnits = ['HOURS', 'DAYS', 'MONTHS', 'YEARS'];
    let durationUnit = String(rawDurationIn || 'days').toUpperCase();
    if (!validUnits.includes(durationUnit)) durationUnit = 'DAYS';
    
    // Bouquets
    let bouquets = '[]';
    const bouquetSource = pkg.bouquets || pkg.groups;
    if (bouquetSource) {
      if (typeof bouquetSource === 'string') {
        try { JSON.parse(bouquetSource); bouquets = bouquetSource; } catch { bouquets = '[]'; }
      } else if (Array.isArray(bouquetSource)) {
        bouquets = JSON.stringify(bouquetSource);
      }
    }
    
    // Output formats
    let outputFormats = '[]';
    if (pkg.output_formats) {
      if (typeof pkg.output_formats === 'string') {
        try { JSON.parse(pkg.output_formats); outputFormats = pkg.output_formats; } catch { outputFormats = '[]'; }
      } else if (Array.isArray(pkg.output_formats)) {
        outputFormats = JSON.stringify(pkg.output_formats);
      }
    }
    
    return { isTrial, duration, durationUnit, credits, bouquets, outputFormats };
  }

  try {
    let packages: any[] = [];
    let bouquetsList: any[] = [];
    let syncMethod = 'API';

    // Tentar API primeiro
    try {
      const client = new XUIClient(server);
      packages = await client.getPackages();
      bouquetsList = await client.getBouquets();
    } catch (apiError: any) {
      logger.warn(`[Sync] API falhou para "${server.name}": ${apiError.message}`);
    }

    // Se API retornou vazio e servidor tem config de DB, usar DB direto
    if (packages.length === 0 && server.dbHost) {
      logger.info(`[Sync] API retornou 0 pacotes. Tentando sync via DB direto para "${server.name}"...`);
      syncMethod = 'DB';
      const dbClient = new XUIDBClient(server);
      try {
        packages = await dbClient.getPackagesFromDB();
        bouquetsList = await dbClient.getBouquetsFromDB();
        await dbClient.disconnect();
      } catch (dbError: any) {
        try { await dbClient.disconnect(); } catch {}
        throw new Error(`API e DB falharam. API: sem dados. DB: ${dbError.message}`);
      }
    }

    // Processar pacotes
    let packagesCount = 0;
    for (const pkg of packages) {
      const { isTrial, duration, durationUnit, credits, bouquets, outputFormats } = processPackage(pkg);
      
      logger.info(`Pacote ${pkg.package_name}: bouquets = ${bouquets}`);
      
      await prisma.package.upsert({
        where: {
          serverId_externalId: { serverId: id, externalId: String(pkg.id) },
        },
        create: {
          serverId: id,
          externalId: String(pkg.id),
          name: pkg.package_name || `Pacote ${pkg.id}`,
          duration, durationUnit, credits, isTrial, bouquets, outputFormats,
          connections: pkg.max_connections ? parseInt(String(pkg.max_connections), 10) || 1 : 1,
        },
        update: {
          name: pkg.package_name || `Pacote ${pkg.id}`,
          duration, durationUnit, credits, isTrial, bouquets, outputFormats,
        },
      });
      packagesCount++;
    }

    // Processar bouquets
    let bouquetsCount = 0;
    for (const bouquet of bouquetsList) {
      await prisma.bouquet.upsert({
        where: {
          serverId_externalId: { serverId: id, externalId: String(bouquet.id) },
        },
        create: {
          serverId: id,
          externalId: String(bouquet.id),
          name: bouquet.bouquet_name || `Bouquet ${bouquet.id}`,
        },
        update: {
          name: bouquet.bouquet_name || `Bouquet ${bouquet.id}`,
        },
      });
      bouquetsCount++;
    }

    // Atualizar status do servidor
    await prisma.xuiServer.update({
      where: { id },
      data: {
        lastSync: new Date(),
        lastCheck: new Date(),
        status: 'ONLINE',
      },
    });

    logger.info(`Servidor "${server.name}" sincronizado via ${syncMethod}: ${packagesCount} pacotes, ${bouquetsCount} bouquets`);

    res.json({
      success: true,
      message: `Sincronização concluída via ${syncMethod}`,
      synced: {
        packages: packagesCount,
        bouquets: bouquetsCount,
        method: syncMethod,
      },
    });
  } catch (error: any) {
    await prisma.xuiServer.update({
      where: { id },
      data: { 
        status: 'ERROR',
        lastCheck: new Date(),
      },
    });

    throw new AppError(500, `Erro na sincronização: ${error.message}`);
  }
});

/**
 * POST /api/settings/xui/:id/toggle
 * Ativa/desativa servidor
 */
export const toggleActive = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const server = await prisma.xuiServer.findUnique({ where: { id } });
  if (!server) {
    throw new AppError(404, 'Servidor não encontrado');
  }

  const updated = await prisma.xuiServer.update({
    where: { id },
    data: { isActive: !server.isActive },
  });

  res.json({
    data: updated,
    message: updated.isActive ? 'Servidor ativado' : 'Servidor desativado',
  });
});

// Exporta função de decrypt para uso em outros módulos
export { decrypt as decryptApiKey };
